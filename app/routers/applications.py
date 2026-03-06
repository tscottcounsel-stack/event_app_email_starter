# app/routers/applications.py
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.routers.auth import get_current_user
from app.store import _APPLICATIONS, _EVENTS, next_application_id, save_store


def _stable_user_id_from_email(email: str) -> int:
    """Deterministic numeric id from email.

    Uses sha1(email) and takes first 12 hex chars as an int.
    This matches ids like 136766367973 for new1@example.com.
    """
    import hashlib

    e = (email or "").strip().lower()
    if not e:
        return 0
    h = hashlib.sha1(e.encode("utf-8")).hexdigest()
    return int(h[:12], 16)


router = APIRouter(tags=["Applications"])


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_iso_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        # assume timezone-aware or treat as UTC
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    try:
        # Python accepts 'Z' only if replaced
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def get_application_or_404(app_id: int) -> Dict[str, Any]:
    app = _APPLICATIONS.get(int(app_id))
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


def _norm_email(x: Any) -> str:
    return str(x or "").strip().lower()


def _set_status(app: Dict[str, Any], status: str):
    app["status"] = status
    if status == "submitted" and not app.get("submitted_at"):
        app["submitted_at"] = utc_now_iso()
    app["updated_at"] = utc_now_iso()


def _coerce_payment_status(x: Any) -> str:
    s = str(x or "").strip().lower()
    if s in ("unpaid", "pending", "paid", "expired"):
        return s
    if not s:
        return "unpaid"
    return "unpaid"


def _reservation_is_expired(app: Dict[str, Any]) -> bool:
    until = parse_iso_dt(app.get("booth_reserved_until"))
    if not until:
        return False
    return until <= utc_now()


def expire_reservations_if_needed() -> int:
    """
    Simplest Policy 2 expiration cleanup (no cron):
    If reservation deadline passed and not paid, we clear the hold and mark expired.
    Returns count of cleared reservations.
    """
    changed = 0
    now = utc_now()

    for a in _APPLICATIONS.values():
        pay = _coerce_payment_status(a.get("payment_status"))
        if pay == "paid":
            continue

        until = parse_iso_dt(a.get("booth_reserved_until"))
        if not until:
            continue

        if until <= now:
            # Expire hold, keep approval status (approved ≠ assigned)
            a["payment_status"] = "expired"
            a["booth_id"] = None
            a["booth_reserved_until"] = None
            a["updated_at"] = utc_now_iso()
            changed += 1

    if changed:
        save_store()

    return changed


def _booth_conflict(
    event_id: int, booth_id: str, exclude_app_id: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """
    Returns the conflicting application if booth is:
    - paid/occupied OR
    - reserved (unpaid/pending) and not expired
    """
    booth_id = str(booth_id or "").strip()
    if not booth_id:
        return None

    now = utc_now()

    for a in _APPLICATIONS.values():
        if exclude_app_id is not None and int(a.get("id") or 0) == int(exclude_app_id):
            continue
        if int(a.get("event_id") or 0) != int(event_id):
            continue
        if str(a.get("booth_id") or "").strip() != booth_id:
            continue

        pay = _coerce_payment_status(a.get("payment_status"))
        if pay == "paid":
            return a

        if pay in ("unpaid", "pending"):
            until = parse_iso_dt(a.get("booth_reserved_until"))
            if until and until > now:
                return a

    return None


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------


class ApplyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: Optional[str] = None  # accepted but ignored in Policy 2
    notes: Optional[str] = None
    checked: Optional[Dict[str, bool]] = None


class UploadedDocMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    size: int
    type: Optional[str] = None
    lastModified: Optional[int] = None


class ApplicationProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    checked: Optional[Dict[str, bool]] = None
    docs: Optional[Dict[str, List[UploadedDocMeta]]] = None
    documents: Optional[Dict[str, Any]] = None


class CheckoutCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    amount_cents: Optional[int] = None
    currency: str = "usd"
    description: Optional[str] = None


class ReserveBoothBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: str
    hold_hours: int = 48


class ExtendReservationBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    extend_hours: int = 48


class ChangeBoothBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: str


# -----------------------------------------------------------------------------
# Vendor: Apply (creates application)
# Policy 2: Approved ≠ assigned, so vendor cannot set booth_id during apply.
# -----------------------------------------------------------------------------


@router.post("/applications/events/{event_id}/apply")
def apply_to_event(
    event_id: int,
    request: Request,
    body: ApplyBody = Body(...),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    get_event_or_404(event_id)

    email = _norm_email(user.get("email"))
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")

    app_id = next_application_id()

    app: Dict[str, Any] = {
        "id": int(app_id),
        "event_id": int(event_id),
        "vendor_email": email,
        "vendor_id": (
            user.get("vendor_id")
            or user.get("id")
            or user.get("sub")
            or _stable_user_id_from_email(email)
        )
        or None,  # FIX_VENDOR_ID_EMAIL
        # Policy 2: ignore booth selection on apply
        "booth_id": None,
        "booth_reserved_until": None,
        "notes": body.notes or "",
        "checked": body.checked or {},
        "docs": {},
        "documents": {},
        "status": "draft",
        "submitted_at": None,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        # payments
        "payment_status": "unpaid",
        "paid_at": None,
    }

    _APPLICATIONS[int(app_id)] = app
    save_store()
    return {"ok": True, "application": app}


# -----------------------------------------------------------------------------
# Vendor: Update Progress (ownership enforced)
# -----------------------------------------------------------------------------


@router.put("/applications/{app_id}/progress")
def update_application_progress(
    app_id: int,
    payload: ApplicationProgressUpdate = Body(...),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    if payload.checked is not None:
        if not isinstance(payload.checked, dict):
            raise HTTPException(status_code=400, detail="checked must be an object")
        app["checked"] = {str(k): bool(v) for k, v in payload.checked.items()}

    incoming_docs: Any = (
        payload.documents if payload.documents is not None else payload.docs
    )
    if incoming_docs is not None:
        if not isinstance(incoming_docs, dict):
            raise HTTPException(
                status_code=400, detail="documents/docs must be an object"
            )

        normalized: Dict[str, List[Dict[str, Any]]] = {}
        for doc_id, metas in incoming_docs.items():
            if metas is None:
                continue

            meta_list: List[Any] = metas if isinstance(metas, list) else [metas]
            cleaned: List[Dict[str, Any]] = []

            for m in meta_list:
                if m is None:
                    continue

                if isinstance(m, UploadedDocMeta):
                    name = m.name
                    size = int(m.size)
                    mtype = m.type or ""
                    last_mod = int(m.lastModified or 0)
                elif isinstance(m, dict):
                    name = str(m.get("name") or "").strip()
                    if not name:
                        continue
                    size = int(m.get("size") or 0)
                    mtype = str(m.get("type") or "")
                    last_mod = int(m.get("lastModified") or 0)
                else:
                    continue

                if not name:
                    continue

                cleaned.append(
                    {
                        "name": name,
                        "size": size,
                        "type": mtype,
                        "lastModified": last_mod,
                    }
                )

            if cleaned:
                normalized[str(doc_id)] = cleaned

        # store under both keys for compatibility
        app["docs"] = normalized
        app["documents"] = normalized

    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "app_id": int(app_id), "updated_at": app["updated_at"]}


@router.put("/vendor/applications/{app_id}/progress")
def vendor_update_application_progress(
    app_id: int,
    payload: ApplicationProgressUpdate = Body(...),
    user: dict = Depends(get_current_user),
):
    return update_application_progress(app_id=app_id, payload=payload, user=user)


# -----------------------------------------------------------------------------
# Vendor: Read + List
# -----------------------------------------------------------------------------


@router.get("/vendor/applications/{app_id}")
def get_vendor_application(app_id: int, user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    d = app.get("documents") or app.get("docs") or {}
    app["documents"] = d
    app["docs"] = d
    return {"ok": True, "application": app}


@router.get("/vendor/applications")
def list_vendor_applications(user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    email = _norm_email(user.get("email"))
    apps = [
        a for a in _APPLICATIONS.values() if _norm_email(a.get("vendor_email")) == email
    ]

    for a in apps:
        d = a.get("documents") or a.get("docs") or {}
        a["documents"] = d
        a["docs"] = d

    return {"applications": apps}


# -----------------------------------------------------------------------------
# Vendor: Submit
# -----------------------------------------------------------------------------


@router.post("/vendor/applications/{app_id}/submit")
def vendor_submit_application(app_id: int, user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    _set_status(app, "submitted")
    save_store()
    return {"ok": True, "application": app}


# -----------------------------------------------------------------------------
# Organizer: List for event
# -----------------------------------------------------------------------------


@router.get("/organizer/events/{event_id}/applications")
def organizer_list_event_applications(event_id: int):
    expire_reservations_if_needed()
    apps = [
        a
        for a in _APPLICATIONS.values()
        if int(a.get("event_id") or 0) == int(event_id)
    ]
    for a in apps:
        d = a.get("documents") or a.get("docs") or {}
        a["documents"] = d
        a["docs"] = d
        a["payment_status"] = _coerce_payment_status(a.get("payment_status"))
    return {"applications": apps}


# -----------------------------------------------------------------------------
# Organizer: Get single application
# -----------------------------------------------------------------------------


@router.get("/organizer/events/{event_id}/applications/{app_id}")
def organizer_get_application(event_id: int, app_id: int):
    expire_reservations_if_needed()

    # Confirm event exists
    get_event_or_404(event_id)

    # Fetch application
    app = get_application_or_404(app_id)

    # Ensure it belongs to the event
    if int(app.get("event_id") or 0) != int(event_id):
        raise HTTPException(status_code=404, detail="Application not found")

    # Normalize documents
    d = app.get("documents") or app.get("docs") or {}
    app["documents"] = d
    app["docs"] = d

    # Normalize payment
    app["payment_status"] = _coerce_payment_status(app.get("payment_status"))

    return {"application": app}


# -----------------------------------------------------------------------------
# Organizer: Approve / Reject / Delete
# -----------------------------------------------------------------------------


@router.post("/organizer/applications/{app_id}/approve")
def organizer_approve_application(app_id: int):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    _set_status(app, "approved")

    # Do NOT assign booth here (Policy 2)
    if _coerce_payment_status(app.get("payment_status")) == "expired":
        # keep expired if they lost a hold; remain eligible
        pass
    elif not app.get("payment_status"):
        app["payment_status"] = "unpaid"

    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/reject")
def organizer_reject_application(app_id: int):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    _set_status(app, "rejected")

    # Rejection releases any hold
    app["payment_status"] = "expired"
    app["booth_id"] = None
    app["booth_reserved_until"] = None

    save_store()
    return {"ok": True, "application": app}


@router.delete("/organizer/applications/{app_id}")
def organizer_delete_application(app_id: int):
    expire_reservations_if_needed()
    get_application_or_404(app_id)
    _APPLICATIONS.pop(int(app_id), None)
    save_store()
    return {"ok": True, "deleted": int(app_id)}


# -----------------------------------------------------------------------------
# Organizer: Policy 2 reservation controls
# -----------------------------------------------------------------------------


@router.post("/organizer/applications/{app_id}/reserve-booth")
def organizer_reserve_booth(app_id: int, body: ReserveBoothBody = Body(...)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Only approved applications can reserve a booth."
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot reserve: already paid/occupied."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot reserve while payment is pending."
        )

    event_id = int(app.get("event_id") or 0)
    get_event_or_404(event_id)

    booth_id = str(body.booth_id or "").strip()
    if not booth_id:
        raise HTTPException(status_code=400, detail="booth_id is required")

    conflict = _booth_conflict(
        event_id=event_id, booth_id=booth_id, exclude_app_id=int(app_id)
    )
    if conflict:
        raise HTTPException(
            status_code=409, detail="Booth is not available (reserved or occupied)."
        )

    hold_hours = int(body.hold_hours or 48)
    hold_hours = max(1, min(168, hold_hours))  # 1h..7d guardrail

    app["booth_id"] = booth_id
    app["booth_reserved_until"] = (utc_now() + timedelta(hours=hold_hours)).isoformat()
    app["payment_status"] = "unpaid"
    app["updated_at"] = utc_now_iso()

    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/extend-reservation")
def organizer_extend_reservation(
    app_id: int, body: ExtendReservationBody = Body(default={})
):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Only approved applications can extend reservation."
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot extend after payment (occupied)."
        )
    if pay not in ("unpaid", "pending"):
        raise HTTPException(
            status_code=400, detail="Only unpaid/pending reservations can be extended."
        )

    if not app.get("booth_id") or not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No active reservation to extend.")

    if _reservation_is_expired(app):
        raise HTTPException(status_code=400, detail="Reservation already expired.")

    extend_hours = int(body.extend_hours or 48)
    extend_hours = max(1, min(168, extend_hours))

    until = parse_iso_dt(app.get("booth_reserved_until")) or utc_now()
    app["booth_reserved_until"] = (until + timedelta(hours=extend_hours)).isoformat()
    app["updated_at"] = utc_now_iso()

    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/change-booth")
def organizer_change_booth(app_id: int, body: ChangeBoothBody = Body(...)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Only approved applications can change booth."
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot change booth after payment."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot change booth while payment is pending."
        )
    if pay not in ("unpaid", "expired"):
        raise HTTPException(
            status_code=400, detail="Invalid payment_status for booth change."
        )

    # Must have an active reservation to change
    if not app.get("booth_id") or not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No active reservation to change.")

    if _reservation_is_expired(app):
        raise HTTPException(status_code=400, detail="Reservation expired.")

    event_id = int(app.get("event_id") or 0)
    get_event_or_404(event_id)

    new_booth_id = str(body.booth_id or "").strip()
    if not new_booth_id:
        raise HTTPException(status_code=400, detail="booth_id is required")

    conflict = _booth_conflict(
        event_id=event_id, booth_id=new_booth_id, exclude_app_id=int(app_id)
    )
    if conflict:
        raise HTTPException(
            status_code=409, detail="Booth is not available (reserved or occupied)."
        )

    app["booth_id"] = new_booth_id
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/release-reservation")
def organizer_release_reservation(app_id: int):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400,
            detail="Only approved applications can release reservation.",
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot release after payment (occupied)."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot release while payment is pending."
        )

    app["payment_status"] = "expired"
    app["booth_id"] = None
    app["booth_reserved_until"] = None
    app["updated_at"] = utc_now_iso()

    save_store()
    return {"ok": True, "application": app}


# -----------------------------------------------------------------------------
# Vendor: Pay Now (Stripe Checkout)
# -----------------------------------------------------------------------------


def _ensure_can_pay_now(app: Dict[str, Any]):
    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Application must be approved before payment."
        )
    if not app.get("booth_id"):
        raise HTTPException(
            status_code=400,
            detail="No booth reserved yet. Waiting for organizer assignment.",
        )
    if not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No reservation deadline set.")
    if _reservation_is_expired(app):
        raise HTTPException(
            status_code=400,
            detail="Reservation expired. Waiting for organizer to reassign.",
        )
    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(status_code=400, detail="Already paid.")
    return pay


@router.post("/vendor/applications/{app_id}/pay-now")
def vendor_pay_now(
    app_id: int,
    body: CheckoutCreateBody = Body(default={}),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    pay = _ensure_can_pay_now(app)

    # Determine amount (dev-safe default)
    amount_cents = int(body.amount_cents or app.get("amount_cents") or 0)
    if amount_cents <= 0:
        amount_cents = 50000  # $500.00 dev default

    success_url = (
        body.success_url or "http://localhost:5173/vendor/applications?payment=success"
    ).strip()
    cancel_url = (
        body.cancel_url or "http://localhost:5173/vendor/applications?payment=cancel"
    ).strip()
    desc = (body.description or f"Booth payment for application #{app_id}").strip()
    currency = (body.currency or "usd").strip().lower()

    # Create Stripe session
    try:
        import os

        import stripe  # type: ignore

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_SECRET_KEY not set")

        stripe.api_key = secret

        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=[
                {
                    "price_data": {
                        "currency": currency,
                        "product_data": {"name": desc},
                        "unit_amount": amount_cents,
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "application_id": str(app_id),
                "event_id": str(app.get("event_id") or ""),
                "vendor_email": str(app.get("vendor_email") or ""),
                "vendor_id": str(app.get("vendor_id") or ""),
                "booth_id": str(app.get("booth_id") or ""),
            },
        )

        # mark pending (optional but useful)
        app["payment_status"] = "pending"
        app["updated_at"] = utc_now_iso()
        save_store()

        return {"ok": True, "url": session.url, "session_id": session.id}
    except Exception as e:
        # If Stripe not installed or not configured, return mock response
        # (frontend can show a dev message)
        return {
            "ok": False,
            "mock": True,
            "detail": f"Stripe not configured: {str(e)}",
            "amount_cents": amount_cents,
        }


# Keep legacy route used by older frontend code
@router.post("/vendor/applications/{app_id}/checkout")
def vendor_create_checkout_session_legacy(
    app_id: int,
    body: CheckoutCreateBody = Body(default={}),
    user: dict = Depends(get_current_user),
):
    return vendor_pay_now(app_id=app_id, body=body, user=user)


# DEV helper: manual mark-paid
@router.post("/vendor/applications/{app_id}/mark-paid")
def vendor_mark_paid_dev_only(app_id: int, user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Application must be approved before payment."
        )
    if not app.get("booth_id") or not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No reserved booth to pay for.")
    if _reservation_is_expired(app):
        raise HTTPException(status_code=400, detail="Reservation expired.")

    app["payment_status"] = "paid"
    app["paid_at"] = utc_now_iso()
    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "application": app}


# -----------------------------------------------------------------------------
# Stripe webhook (success => paid)
# -----------------------------------------------------------------------------


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """
    Accepts Stripe webhook events.
    If STRIPE_WEBHOOK_SECRET is set, we verify signature. Otherwise we parse JSON directly.
    On checkout.session.completed => payment_status='paid'.
    """
    import os

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    evt = None
    webhook_secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()

    try:
        import stripe  # type: ignore

        if webhook_secret and sig:
            evt = stripe.Webhook.construct_event(
                payload=payload, sig_header=sig, secret=webhook_secret
            )
        else:
            evt = await request.json()
    except Exception:
        # fallback: try json
        try:
            evt = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook payload")

    etype = str(evt.get("type") or "").strip()
    data_obj = (evt.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        meta = data_obj.get("metadata") or {}
        app_id_raw = meta.get("application_id") or ""
        try:
            app_id = int(app_id_raw)
        except Exception:
            return {"ok": True, "ignored": True, "reason": "missing application_id"}

        expire_reservations_if_needed()
        app = _APPLICATIONS.get(int(app_id))
        if not app:
            return {"ok": True, "ignored": True, "reason": "application not found"}

        # Lock it
        app["payment_status"] = "paid"
        app["paid_at"] = utc_now_iso()
        app["updated_at"] = utc_now_iso()

        # Once paid, you may optionally clear reserved_until (record not required for logic)
        # app["booth_reserved_until"] = None

        save_store()
        return {"ok": True}

    # ignore other events
    return {"ok": True, "ignored": True, "type": etype}
