# app/routers/applications.py
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict

from app.store import (
    _APPLICATIONS,
    _EVENTS,
    _REQUIREMENTS,
    next_application_id,
    save_store,
)

router = APIRouter(tags=["Applications"])

# NOTE:
# In main.py you mount something like:
#   app.mount("/uploads", StaticFiles(directory=...), name="uploads")
# This router writes into app/uploads so URLs /uploads/<filename> work.
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- Time / Helpers ----------------


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def get_app_or_404(application_id: int) -> Dict[str, Any]:
    app = _APPLICATIONS.get(int(application_id))
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Ensure required keys exist for older records
    if not isinstance(app.get("checked"), dict):
        app["checked"] = {}
    if not isinstance(app.get("documents"), dict):
        app["documents"] = {}

    return app


def _safe_filename(name: str) -> str:
    name = (name or "").strip() or "file"
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"[^a-zA-Z0-9._-]+", "_", name)
    return name[:120]


def _identity_from_headers(request: Request) -> Tuple[Optional[str], Optional[str]]:
    """
    Dev-friendly identity:
      - x-user-email
      - x-user-id
    """
    email = request.headers.get("x-user-email")
    uid = request.headers.get("x-user-id")
    email = (email or "").strip().lower() or None
    uid = (uid or "").strip() or None
    return email, uid


def _require_vendor_identity(request: Request) -> Tuple[str, Optional[str]]:
    """
    Vendor endpoints should not return or modify data without identity.
    """
    email, uid = _identity_from_headers(request)
    if not email and not uid:
        raise HTTPException(
            status_code=401,
            detail="Missing vendor identity (x-user-email or x-user-id)",
        )
    return email or "", uid


def _vendor_owns_app(app: Dict[str, Any], email: str, uid: Optional[str]) -> bool:
    """
    Ownership rules:
      - if app has vendor_email -> must match
      - else if app has vendor_id -> must match
      - else deny (legacy safety)
    """
    app_email = (app.get("vendor_email") or "").strip().lower()
    app_uid = app.get("vendor_id") or ""
    if app_email:
        return app_email == (email or "").strip().lower()
    if app_uid:
        return bool(uid) and str(app_uid) == str(uid)
    return False


def _normalize_app_for_output(app: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stable output shape for UI:
      - checked: dict[str,bool]
      - documents: dict[str,dict]
    """
    out = dict(app)

    checked = out.get("checked")
    if not isinstance(checked, dict):
        out["checked"] = {}
    else:
        out["checked"] = {str(k): bool(v) for k, v in checked.items()}

    docs = out.get("documents")
    if not isinstance(docs, dict):
        out["documents"] = {}
    else:
        norm_docs: Dict[str, Any] = {}
        for k, v in docs.items():
            kk = str(k)
            norm_docs[kk] = v if isinstance(v, dict) else {"value": v}
        out["documents"] = norm_docs

    # make these predictable
    if "payment_status" not in out:
        out["payment_status"] = "unpaid"
    if "status" not in out:
        out["status"] = "draft"

    return out


def _is_active_application(app: Dict[str, Any]) -> bool:
    """
    "Active" for duplicate enforcement:
      - not archived
      - status != rejected
    """
    if bool(app.get("archived", False)):
        return False
    status = (app.get("status") or "").strip().lower()
    if status == "rejected":
        return False
    return True


def _find_duplicate_application(
    *,
    event_id: int,
    booth_id: str,
    vendor_email: str,
    vendor_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    """
    Returns the most recent active duplicate application for this vendor+event+booth, if any.
    """
    booth_norm = (booth_id or "").strip()
    if not booth_norm:
        return None

    candidates = []
    for a in _APPLICATIONS.values():
        if int(a.get("event_id", -1)) != int(event_id):
            continue
        if (a.get("booth_id") or "").strip() != booth_norm:
            continue
        if not _vendor_owns_app(a, email=vendor_email, uid=vendor_id):
            continue
        if not _is_active_application(a):
            continue
        candidates.append(a)

    if not candidates:
        return None

    def _key(x: Dict[str, Any]) -> str:
        return str(x.get("updated_at") or x.get("submitted_at") or "")

    candidates.sort(key=_key, reverse=True)
    return candidates[0]


def _format_redirect_url(template: str, application_id: int, event_id: int) -> str:
    """
    Supports both tokens:
      - {APPLICATION_ID}
      - {EVENT_ID}
    """
    return (
        (template or "")
        .replace("{APPLICATION_ID}", str(application_id))
        .replace("{EVENT_ID}", str(event_id))
    )


def _resolve_amount_cents_from_requirements(
    *,
    event_id: int,
    booth_category_id: Optional[str],
) -> Optional[int]:
    """
    Look up price for the selected booth category from requirements.

    We support booth_categories entries shaped like:
      { id, base_price_cents } OR { id, base_price } (dollars)
    """
    if not booth_category_id:
        return None

    slot = _REQUIREMENTS.get(int(event_id))
    if not isinstance(slot, dict):
        return None
    req = slot.get("requirements")
    if not isinstance(req, dict):
        return None

    cats = req.get("booth_categories")
    if not isinstance(cats, list):
        return None

    want = str(booth_category_id).strip()
    if not want:
        return None

    for c in cats:
        if not isinstance(c, dict):
            continue
        if str(c.get("id") or "").strip() != want:
            continue

        # prefer cents
        try:
            cents = int(c.get("base_price_cents") or 0)
            if cents > 0:
                return cents
        except Exception:
            pass

        # fallback: dollars -> cents
        try:
            dollars = float(c.get("base_price") or 0)
            if dollars > 0:
                return int(round(dollars * 100))
        except Exception:
            pass

    return None


def _resolve_checkout_amount_cents(app: Dict[str, Any]) -> int:
    """
    Amount resolution order:
      1) if application already has amount_cents -> reuse
      2) else if requirements has booth_categories price for app.booth_category_id -> use it
      3) else if requirements has payment_settings.default_amount_cents -> use it
      4) else env STRIPE_DEFAULT_AMOUNT_CENTS (default 2500)
    """
    # 1) reuse app amount if already set
    try:
        existing = int(app.get("amount_cents") or 0)
        if existing > 0:
            return existing
    except Exception:
        pass

    event_id = int(app.get("event_id") or 0)

    # 2) per-category
    booth_category_id = app.get("booth_category_id")
    cents = _resolve_amount_cents_from_requirements(
        event_id=event_id,
        booth_category_id=(
            str(booth_category_id) if booth_category_id is not None else None
        ),
    )
    if cents and cents > 0:
        return int(cents)

    # 3) default_amount_cents
    slot = _REQUIREMENTS.get(event_id) if event_id else None
    if isinstance(slot, dict):
        req = slot.get("requirements")
        if isinstance(req, dict):
            ps = req.get("payment_settings")
            if isinstance(ps, dict):
                try:
                    v = int(ps.get("default_amount_cents") or 0)
                    if v > 0:
                        return v
                except Exception:
                    pass

    # 4) env fallback
    try:
        return int(os.getenv("STRIPE_DEFAULT_AMOUNT_CENTS", "2500"))
    except Exception:
        return 2500


# ---------------- Models ----------------


class ApplyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: Optional[str] = None

    # ✅ NEW: pass category id from the booth selection so Stripe can price correctly
    # This should match requirements.requirements.booth_categories[].id (stringified is fine).
    booth_category_id: Optional[str] = None

    checked: Optional[Dict[str, bool]] = None
    notes: Optional[str] = None
    vendor_profile: Optional[Dict[str, Any]] = None


class StatusBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: str


class ProgressBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    checked: Optional[Dict[str, bool]] = None
    notes: Optional[str] = None


# -------------------------------------------------------------------
# Vendor: submit application (created on booth selection)
# -------------------------------------------------------------------


@router.post("/applications/events/{event_id}/apply")
def apply_to_event(
    event_id: int, payload: ApplyBody, request: Request
) -> Dict[str, Any]:
    get_event_or_404(event_id)

    email, uid = _require_vendor_identity(request)

    booth_id = (payload.booth_id or "").strip()
    if not booth_id:
        raise HTTPException(status_code=400, detail="Missing booth_id")

    dup = _find_duplicate_application(
        event_id=int(event_id),
        booth_id=booth_id,
        vendor_email=email or "",
        vendor_id=uid,
    )
    if dup:
        raise HTTPException(
            status_code=409,
            detail={
                "ok": False,
                "code": "DUPLICATE_APPLICATION",
                "message": "An active application already exists for this booth.",
                "existing_application_id": int(dup.get("id")),
                "existing_app_ref": dup.get("app_ref"),
                "event_id": int(event_id),
                "booth_id": booth_id,
            },
        )

    app_id = int(next_application_id())
    app_ref = f"APP-{event_id}-{app_id}"

    vp = payload.vendor_profile if isinstance(payload.vendor_profile, dict) else None
    if vp is not None and not vp.get("email"):
        vp["email"] = email or ""

    app: Dict[str, Any] = {
        "id": app_id,
        "event_id": int(event_id),
        "booth_id": booth_id,
        "booth_category_id": (payload.booth_category_id or None),
        "app_ref": app_ref,
        "notes": payload.notes or "",
        "checked": payload.checked or {},
        "status": "submitted",
        "submitted_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "vendor_email": email or None,
        "vendor_id": uid,
        "documents": {},
        "vendor_profile": vp,
        # Stripe
        "payment_status": "unpaid",
    }

    _APPLICATIONS[app_id] = app

    ev = _EVENTS.get(int(event_id))
    if ev is not None:
        ev["updated_at"] = utc_now_iso()

    save_store()
    return {"ok": True, "application": _normalize_app_for_output(app)}


# -------------------------------------------------------------------
# Vendor: start Stripe Checkout
# NOTE: pay AFTER organizer approval (enforced here)
# -------------------------------------------------------------------


@router.post("/vendor/applications/{application_id}/checkout")
def vendor_start_checkout(application_id: int, request: Request) -> Dict[str, Any]:
    email, uid = _require_vendor_identity(request)
    app = get_app_or_404(application_id)

    if not _vendor_owns_app(app, email=email, uid=uid):
        raise HTTPException(status_code=403, detail="Not allowed")

    # ✅ Enforce pay-after-approval
    status = str(app.get("status") or "").strip().lower()
    if status != "approved":
        raise HTTPException(
            status_code=409, detail="Payment allowed only after organizer approval"
        )

    if str(app.get("payment_status") or "").strip().lower() == "paid":
        raise HTTPException(status_code=409, detail="Application already paid")

    try:
        import stripe  # type: ignore
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Stripe SDK not installed. Run: pip install stripe",
        )

    secret_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if not secret_key:
        raise HTTPException(status_code=500, detail="Missing STRIPE_SECRET_KEY env var")
    stripe.api_key = secret_key

    amount_cents = _resolve_checkout_amount_cents(app)
    currency = (os.getenv("STRIPE_CURRENCY", "usd") or "usd").lower()

    # Redirect back into the correct vendor React route
    success_tpl = os.getenv(
        "STRIPE_SUCCESS_URL",
        "http://localhost:5173/vendor/events/{EVENT_ID}/apply?appId={APPLICATION_ID}&paid=1",
    )
    cancel_tpl = os.getenv(
        "STRIPE_CANCEL_URL",
        "http://localhost:5173/vendor/events/{EVENT_ID}/apply?appId={APPLICATION_ID}&canceled=1",
    )

    eid = int(app.get("event_id") or 0)
    success_url = _format_redirect_url(success_tpl, int(application_id), eid)
    cancel_url = _format_redirect_url(cancel_tpl, int(application_id), eid)

    # Persist pending before contacting Stripe (so UI can reflect it if needed)
    app["payment_status"] = "pending"
    app["amount_cents"] = int(amount_cents)
    app["currency"] = currency
    app["updated_at"] = utc_now_iso()
    save_store()

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=success_url,
            cancel_url=cancel_url,
            payment_method_types=["card"],
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": currency,
                        "unit_amount": int(amount_cents),
                        "product_data": {
                            "name": f"VendorConnect Application #{int(application_id)}",
                            "description": f"Event {app.get('event_id')} • Booth {app.get('booth_id')}",
                        },
                    },
                }
            ],
            metadata={
                "application_id": str(int(application_id)),
                "event_id": str(int(app.get("event_id") or 0)),
                "booth_id": str(app.get("booth_id") or ""),
                "booth_category_id": str(app.get("booth_category_id") or ""),
                "vendor_email": (email or ""),
            },
        )
    except Exception as e:
        app["payment_status"] = "unpaid"
        app["updated_at"] = utc_now_iso()
        save_store()
        raise HTTPException(status_code=500, detail=f"Stripe error: {e}")

    app["stripe_checkout_session_id"] = session.get("id")
    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "url": session.get("url"), "session_id": session.get("id")}


# -------------------------------------------------------------------
# Organizer: list applications for an event
# -------------------------------------------------------------------


@router.get("/organizer/events/{event_id}/applications")
def list_event_applications(event_id: int) -> Dict[str, Any]:
    get_event_or_404(event_id)

    apps_raw = [
        a for a in _APPLICATIONS.values() if int(a.get("event_id", -1)) == int(event_id)
    ]

    apps_raw.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)
    apps = [_normalize_app_for_output(a) for a in apps_raw]

    return {"event_id": int(event_id), "applications": apps}


# -------------------------------------------------------------------
# Organizer: update application status (Approve/Reject)
# -------------------------------------------------------------------


@router.post("/organizer/applications/{application_id}/status")
def organizer_set_status(application_id: int, body: StatusBody) -> Dict[str, Any]:
    app = get_app_or_404(application_id)

    s = (body.status or "").strip().lower()
    if s not in ("approved", "rejected", "submitted", "draft"):
        raise HTTPException(status_code=400, detail="Invalid status")

    app["status"] = s
    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "application": _normalize_app_for_output(app)}


# -------------------------------------------------------------------
# Vendor: list MY applications only
# -------------------------------------------------------------------


@router.get("/vendor/applications")
def list_vendor_applications(request: Request) -> Dict[str, Any]:
    email, uid = _require_vendor_identity(request)

    apps_raw = [
        a for a in _APPLICATIONS.values() if _vendor_owns_app(a, email=email, uid=uid)
    ]

    apps_raw.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)
    apps = [_normalize_app_for_output(a) for a in apps_raw]

    return {"applications": apps}


# -------------------------------------------------------------------
# Vendor: get ONE application (by id)
# -------------------------------------------------------------------


@router.get("/vendor/applications/{application_id}")
def get_vendor_application(application_id: int, request: Request) -> Dict[str, Any]:
    email, uid = _require_vendor_identity(request)
    app = get_app_or_404(application_id)

    if not _vendor_owns_app(app, email=email, uid=uid):
        raise HTTPException(status_code=403, detail="Not allowed")

    return {"application": _normalize_app_for_output(app)}


# -------------------------------------------------------------------
# Vendor: save progress (checked + notes)
# -------------------------------------------------------------------


@router.put("/vendor/applications/{application_id}/progress")
def vendor_save_progress(
    application_id: int, body: ProgressBody, request: Request
) -> Dict[str, Any]:
    email, uid = _require_vendor_identity(request)
    app = get_app_or_404(application_id)

    if not _vendor_owns_app(app, email=email, uid=uid):
        raise HTTPException(status_code=403, detail="Not allowed")

    if body.checked is not None:
        if not isinstance(body.checked, dict):
            raise HTTPException(status_code=400, detail="checked must be an object")
        app["checked"] = body.checked

    if body.notes is not None:
        app["notes"] = body.notes

    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "application": _normalize_app_for_output(app)}


# -------------------------------------------------------------------
# Vendor: upload document
# -------------------------------------------------------------------


@router.post("/vendor/applications/{application_id}/documents/{doc_id}")
async def vendor_upload_document(
    application_id: int,
    doc_id: str,
    request: Request,
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    email, uid = _require_vendor_identity(request)
    app = get_app_or_404(application_id)

    if not _vendor_owns_app(app, email=email, uid=uid):
        raise HTTPException(status_code=403, detail="Not allowed")

    if not file:
        raise HTTPException(status_code=400, detail="Missing file")

    safe_doc_id = (doc_id or "").strip() or "doc"
    original_name = file.filename or "upload"
    safe_name = _safe_filename(original_name)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    out_name = (
        f"app{int(application_id)}_{_safe_filename(safe_doc_id)}_{ts}_{safe_name}"
    )
    out_path = UPLOAD_DIR / out_name

    data = await file.read()
    out_path.write_bytes(data)

    meta = {
        "doc_id": safe_doc_id,
        "original_name": original_name,
        "filename": out_name,
        "size": len(data),
        "content_type": file.content_type or "",
        "url": f"/uploads/{out_name}",
        "uploaded_at": utc_now_iso(),
    }

    docs = app.get("documents")
    if not isinstance(docs, dict):
        docs = {}
        app["documents"] = docs
    docs[str(safe_doc_id)] = meta

    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "doc": meta, "application_id": int(application_id)}


# -------------------------------------------------------------------
# Organizer: DELETE application
# -------------------------------------------------------------------


@router.delete("/organizer/applications/{application_id}")
def delete_application(application_id: int):
    application_id = int(application_id)

    if application_id not in _APPLICATIONS:
        raise HTTPException(status_code=404, detail="Application not found")

    del _APPLICATIONS[application_id]
    save_store()

    return {"ok": True}
