from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.store import _VERIFICATIONS, save_store
from app.routers.auth import get_current_user

router = APIRouter(tags=["Verifications"])

VALID_ROLES = {"vendor", "organizer"}
VALID_REVIEW_STATUSES = {"verified", "rejected"}
EXPIRING_SOON_DAYS = 30
DEFAULT_VERIFICATION_DURATION_DAYS = 365


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = _safe_str(value)
    if not raw:
        return None

    try:
        normalized = raw.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _next_verification_id() -> int:
    ids: List[int] = []
    for key in _VERIFICATIONS.keys():
        try:
            ids.append(int(key))
        except Exception:
            continue
    return max(ids, default=0) + 1


def _normalize_documents(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    docs: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        doc = {
            "name": _safe_str(item.get("name") or item.get("label") or item.get("type")),
            "label": _safe_str(item.get("label") or item.get("name") or item.get("type")),
            "type": _safe_str(item.get("type") or item.get("document_type") or item.get("category")),
            "url": _safe_str(item.get("url") or item.get("file_url") or item.get("fileUrl")),
            "expiration_date": _safe_str(
                item.get("expiration_date")
                or item.get("expirationDate")
                or item.get("expires_at")
                or item.get("expiresAt")
            ),
            "uploaded_at": _safe_str(item.get("uploaded_at") or item.get("uploadedAt") or _now_iso()),
        }

        if doc["name"] or doc["url"] or doc["type"]:
            docs.append(doc)

    return docs


def _record_matches_identity(record: Dict[str, Any], email: str, role: str) -> bool:
    record_email = _safe_lower(record.get("email"))
    record_role = _safe_lower(record.get("role"))
    return bool(record_email and email and record_email == email and record_role == role)


def _find_latest_record(email: str, role: str = "") -> Optional[Dict[str, Any]]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)

    matches: List[Dict[str, Any]] = []
    for record in _VERIFICATIONS.values():
        if not isinstance(record, dict):
            continue
        if _safe_lower(record.get("email")) != normalized_email:
            continue
        if normalized_role and _safe_lower(record.get("role")) != normalized_role:
            continue
        matches.append(record)

    if not matches:
        return None

    matches.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)
    return matches[0]


def _compute_lifecycle_status(record: Optional[Dict[str, Any]]) -> str:
    if not record:
        return "unverified"

    status = _safe_lower(record.get("status")) or "pending"

    if status != "verified":
        return status

    expiration = _parse_datetime(record.get("expiration_date"))
    if not expiration:
        return "verified"

    now = _now()
    if expiration < now:
        return "expired"

    if expiration - now <= timedelta(days=EXPIRING_SOON_DAYS):
        return "expiring_soon"

    return "verified"


def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **record,
        "verification_status": _compute_lifecycle_status(record),
    }


def _verification_fee_for_role(role: str) -> int:
    return 49 if _safe_lower(role) == "organizer" else 25


def _record_fee_paid(record: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(record, dict):
        return False
    return bool(
        record.get("fee_paid") is True
        or _safe_lower(record.get("payment_status")) == "paid"
        or _safe_lower(record.get("verification_payment_status")) == "paid"
        or bool(record.get("paid_at"))
    )


def _ensure_identity_record(email: str, role: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    existing = _find_latest_record(email, role)
    if existing:
        if extra:
            existing.update(extra)
        existing.setdefault("email", email)
        existing.setdefault("role", role)
        existing.setdefault("fee_amount", _verification_fee_for_role(role))
        return existing

    verification_id = _next_verification_id()
    record: Dict[str, Any] = {
        "id": verification_id,
        "email": email,
        "role": role,
        "status": "not_started",
        "verification_status": "not_verified",
        "payment_status": "unpaid",
        "fee_paid": False,
        "fee_amount": _verification_fee_for_role(role),
        "submitted_at": None,
        "reviewed_at": None,
        "documents": [],
        "created_at": _now_iso(),
    }
    if extra:
        record.update(extra)
    _VERIFICATIONS[verification_id] = record
    return record


def _current_identity(current_user: Dict[str, Any]) -> tuple[str, str]:
    email = _safe_lower(
        current_user.get("email")
        or current_user.get("sub")
        or current_user.get("username")
    )
    role = _safe_lower(
        current_user.get("role")
        or current_user.get("user_role")
        or current_user.get("account_type")
        or "vendor"
    )
    if role not in VALID_ROLES:
        role = "vendor"
    if not email:
        raise HTTPException(status_code=401, detail="Unable to identify current user.")
    return email, role


def _private_record(record: Optional[Dict[str, Any]], email: str, role: str) -> Dict[str, Any]:
    if not record:
        return {
            "email": email,
            "role": role,
            "status": "not_started",
            "verification_status": "not_verified",
            "review_status": "",
            "fee_paid": False,
            "payment_status": "unpaid",
            "fee_amount": _verification_fee_for_role(role),
            "documents": [],
        }

    payload = _public_record(record)
    paid = _record_fee_paid(record)
    payload.update({
        "fee_paid": paid,
        "payment_status": "paid" if paid else _safe_lower(record.get("payment_status")) or "unpaid",
        "verification_payment_status": "paid" if paid else _safe_lower(record.get("verification_payment_status")) or _safe_lower(record.get("payment_status")) or "unpaid",
        "fee_amount": record.get("fee_amount") or _verification_fee_for_role(role),
        "email": _safe_lower(record.get("email")) or email,
        "role": _safe_lower(record.get("role")) or role,
        "documents": _normalize_documents(record.get("documents")) if isinstance(record.get("documents"), list) else [],
    })
    return payload




@router.get("/verification/me")
def get_my_verification(current_user: dict = Depends(get_current_user)):
    email, role = _current_identity(current_user)
    record = _find_latest_record(email, role)
    return {
        "ok": True,
        "email": email,
        "role": role,
        "verification": _private_record(record, email, role),
    }


@router.get("/verification/current")
def get_current_verification(current_user: dict = Depends(get_current_user)):
    # Backward-compatible alias used by older frontend builds.
    return get_my_verification(current_user)


@router.post("/verification/create-checkout")
def create_verification_checkout(payload: Dict[str, Any], current_user: dict = Depends(get_current_user)):
    email, role = _current_identity(current_user)
    fee_amount = _verification_fee_for_role(role)

    record = _ensure_identity_record(
        email,
        role,
        {
            "business_name": _safe_str(payload.get("business_name")),
            "notes": _safe_str(payload.get("notes")),
            "fee_amount": fee_amount,
            "payment_status": "unpaid",
            "fee_paid": False,
            "updated_at": _now_iso(),
        },
    )
    save_store()

    success_url = _safe_str(payload.get("success_url"))
    cancel_url = _safe_str(payload.get("cancel_url"))
    if not success_url or not cancel_url:
        raise HTTPException(status_code=400, detail="success_url and cancel_url are required.")

    try:
        import os
        import stripe

        secret = _safe_str(os.getenv("STRIPE_SECRET_KEY"))
        if not secret:
            raise RuntimeError("Stripe is not configured.")
        stripe.api_key = secret

        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            customer_email=email,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": int(fee_amount * 100),
                        "product_data": {
                            "name": "VendCore Verification",
                            "description": f"{role.title()} verification fee",
                        },
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "email": email,
                "role": role,
                "verification_id": str(record.get("id") or ""),
                "purpose": "verification",
            },
        )
        record["checkout_session_id"] = str(session.get("id") if isinstance(session, dict) else session.id)
        save_store()
        return {"ok": True, "url": session.get("url") if isinstance(session, dict) else session.url, "verification": _private_record(record, email, role)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Unable to start payment.")


@router.post("/verification/confirm-payment")
def confirm_verification_payment(payload: Dict[str, Any], current_user: dict = Depends(get_current_user)):
    email, role = _current_identity(current_user)
    session_id = _safe_str(payload.get("session_id"))
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required.")

    paid = False
    amount_total = None
    try:
        import os
        import stripe

        secret = _safe_str(os.getenv("STRIPE_SECRET_KEY"))
        if secret:
            stripe.api_key = secret
            session = stripe.checkout.Session.retrieve(session_id)
            payment_status = _safe_lower(session.get("payment_status") if isinstance(session, dict) else getattr(session, "payment_status", ""))
            status = _safe_lower(session.get("status") if isinstance(session, dict) else getattr(session, "status", ""))
            amount_total = session.get("amount_total") if isinstance(session, dict) else getattr(session, "amount_total", None)
            paid = payment_status == "paid" or status == "complete"
    except Exception:
        # If Stripe lookup fails, do not fabricate payment success.
        paid = False

    if not paid:
        raise HTTPException(status_code=400, detail="Payment has not been confirmed by Stripe yet.")

    record = _ensure_identity_record(
        email,
        role,
        {
            "payment_status": "paid",
            "verification_payment_status": "paid",
            "fee_paid": True,
            "paid_at": _now_iso(),
            "checkout_session_id": session_id,
            "fee_amount": round(float(amount_total or (_verification_fee_for_role(role) * 100)) / 100.0, 2),
            "updated_at": _now_iso(),
        },
    )
    save_store()

    return {
        "ok": True,
        "verification": _private_record(record, email, role),
    }

@router.post("/verification/submit")
def submit_verification(payload: Dict[str, Any]):
    email = _safe_lower(payload.get("email"))
    role = _safe_lower(payload.get("role"))

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")

    existing = None
    for verification_id, record in _VERIFICATIONS.items():
        if isinstance(record, dict) and _record_matches_identity(record, email, role):
            existing = (verification_id, record)
            break

    documents = _normalize_documents(payload.get("documents"))
    submitted_at = _now_iso()

    if existing:
        verification_id, record = existing
        record.update(
            {
                "id": int(verification_id),
                "email": email,
                "role": role,
                "status": "pending",
                "submitted_at": submitted_at,
                "reviewed_at": None,
                "reviewed_by": None,
                "notes": _safe_str(payload.get("notes") or record.get("notes")),
                "documents": documents,
                "payment_status": _safe_str(payload.get("payment_status") or record.get("payment_status") or "unpaid"),
                "fee_amount": payload.get("fee_amount", record.get("fee_amount", 0)),
                "expiration_date": payload.get("expiration_date") or record.get("expiration_date"),
            }
        )
        saved = record
    else:
        verification_id = _next_verification_id()
        saved = {
            "id": verification_id,
            "email": email,
            "role": role,
            "status": "pending",
            "submitted_at": submitted_at,
            "reviewed_at": None,
            "reviewed_by": None,
            "notes": _safe_str(payload.get("notes")),
            "documents": documents,
            "payment_status": _safe_str(payload.get("payment_status") or "unpaid"),
            "fee_amount": payload.get("fee_amount", 0),
            "expiration_date": payload.get("expiration_date"),
        }
        _VERIFICATIONS[verification_id] = saved

    save_store()

    return {
        "ok": True,
        "verification": _public_record(saved),
    }


@router.get("/verification/status")
def get_verification_status(email: str, role: str = ""):
    record = _find_latest_record(email, role)
    return {
        "ok": True,
        "email": _safe_lower(email),
        "role": _safe_lower(role),
        "verification_status": _compute_lifecycle_status(record),
        "verification": _public_record(record) if record else None,
    }


@router.get("/admin/verifications")
def get_admin_verifications():
    records = [
        _public_record(record)
        for record in _VERIFICATIONS.values()
        if isinstance(record, dict)
    ]
    records.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)

    return {
        "ok": True,
        "verifications": records,
        "count": len(records),
    }


@router.post("/admin/verify/{verification_id}")
def review_verification(verification_id: int, payload: Dict[str, Any]):
    record = _VERIFICATIONS.get(verification_id)

    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    status = _safe_lower(payload.get("status"))

    if status not in VALID_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be verified or rejected")

    record["status"] = status
    record["reviewed_at"] = _now_iso()
    record["reviewed_by"] = _safe_str(payload.get("reviewed_by") or payload.get("reviewedBy"))
    record["notes"] = _safe_str(payload.get("notes"))

    if status == "verified":
        provided_expiration = _safe_str(payload.get("expiration_date") or payload.get("expirationDate"))
        record["expiration_date"] = provided_expiration or (
            _now() + timedelta(days=DEFAULT_VERIFICATION_DURATION_DAYS)
        ).isoformat()

    save_store()

    return {
        "ok": True,
        "verification": _public_record(record),
    }


@router.delete("/admin/verifications/{verification_id}")
def delete_verification(verification_id: int):
    if verification_id not in _VERIFICATIONS:
        raise HTTPException(status_code=404, detail="Verification not found")

    removed = _VERIFICATIONS.pop(verification_id)
    save_store()

    return {
        "ok": True,
        "deleted": removed,
    }
