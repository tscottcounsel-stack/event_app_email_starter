from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user
from app.store import _VERIFICATIONS, save_store

try:
    import stripe
except Exception:
    stripe = None

router = APIRouter(tags=["Verifications"])

VALID_ROLES = {"vendor", "organizer"}
VALID_REVIEW_STATUSES = {"verified", "rejected"}
EXPIRING_SOON_DAYS = 30
DEFAULT_VERIFICATION_DURATION_DAYS = 365


DEFAULT_VERIFICATION_FEES = {
    "vendor": 25,
    "organizer": 49,
}


def _require_stripe() -> Any:
    if stripe is None:
        raise HTTPException(status_code=500, detail="Stripe SDK missing. Install stripe.")

    secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="STRIPE_SECRET_KEY is not set")

    stripe.api_key = secret
    return stripe


def _verification_fee_amount(role: str) -> int:
    normalized_role = _safe_lower(role)
    env_name = "STRIPE_VERIFICATION_FEE_ORGANIZER" if normalized_role == "organizer" else "STRIPE_VERIFICATION_FEE_VENDOR"
    raw = (os.getenv(env_name) or "").strip()
    try:
        value = float(raw) if raw else float(DEFAULT_VERIFICATION_FEES.get(normalized_role, 25))
    except Exception:
        value = float(DEFAULT_VERIFICATION_FEES.get(normalized_role, 25))
    return int(round(value))


def _checkout_session_value(session: Any, key: str, default: Any = None) -> Any:
    if isinstance(session, dict):
        return session.get(key, default)
    return getattr(session, key, default)


def _checkout_metadata(session: Any) -> Dict[str, Any]:
    metadata = _checkout_session_value(session, "metadata", {})
    if isinstance(metadata, dict):
        return metadata
    try:
        return dict(metadata or {})
    except Exception:
        return {}


def _find_record_entry(email: str, role: str) -> tuple[Any, Optional[Dict[str, Any]]]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)

    for verification_id, record in _VERIFICATIONS.items():
        if isinstance(record, dict) and _record_matches_identity(record, normalized_email, normalized_role):
            return verification_id, record

    return None, None


def _get_or_create_payment_record(email: str, role: str, *, fee_amount: int) -> Dict[str, Any]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)

    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email required")
    if normalized_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")

    verification_id, record = _find_record_entry(normalized_email, normalized_role)
    if isinstance(record, dict):
        record.setdefault("id", int(verification_id) if str(verification_id).isdigit() else verification_id)
        record.setdefault("email", normalized_email)
        record.setdefault("role", normalized_role)
        record.setdefault("status", "not_started")
        record.setdefault("payment_status", "unpaid")
        record.setdefault("fee_paid", False)
        record.setdefault("expires_at", record.get("expiration_date"))
        record.setdefault("last_verified_at", record.get("reviewed_at"))
        record["fee_amount"] = record.get("fee_amount") or fee_amount
        return record

    verification_id = _next_verification_id()
    record = {
        "id": verification_id,
        "email": normalized_email,
        "role": normalized_role,
        "status": "not_started",
        "submitted_at": None,
        "reviewed_at": None,
        "reviewed_by": None,
        "notes": "",
        "documents": [],
        "payment_status": "unpaid",
        "fee_paid": False,
        "fee_amount": fee_amount,
        "expiration_date": None,
        "expires_at": None,
        "last_verified_at": None,
        "created_at": _now_iso(),
    }
    _VERIFICATIONS[verification_id] = record
    return record


def mark_verification_paid(
    *,
    email: str,
    role: str,
    stripe_session_id: str = "",
    stripe_payment_intent_id: str = "",
    amount_paid: Any = None,
) -> Optional[Dict[str, Any]]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)
    if not normalized_email or normalized_role not in VALID_ROLES:
        return None

    fee_amount = _verification_fee_amount(normalized_role)
    record = _get_or_create_payment_record(normalized_email, normalized_role, fee_amount=fee_amount)

    record["payment_status"] = "paid"
    record["fee_paid"] = True
    record["paid_at"] = _now_iso()
    if stripe_session_id:
        record["stripe_checkout_session_id"] = stripe_session_id
    if stripe_payment_intent_id:
        record["stripe_payment_intent_id"] = stripe_payment_intent_id
    if amount_paid not in (None, ""):
        try:
            record["amount_paid"] = round(float(amount_paid) / 100, 2)
        except Exception:
            record["amount_paid"] = amount_paid

    save_store()
    return record


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


def _earliest_expiration_from_documents(record: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not isinstance(record, dict):
        return None

    documents = record.get("documents") or record.get("verification_documents") or record.get("verificationDocuments") or []
    if isinstance(documents, dict):
        documents = list(documents.values())

    expirations: List[datetime] = []
    if isinstance(documents, list):
        for doc in documents:
            if not isinstance(doc, dict):
                continue
            exp = _parse_datetime(
                doc.get("expiration_date")
                or doc.get("expirationDate")
                or doc.get("expires_at")
                or doc.get("expiresAt")
            )
            if exp:
                expirations.append(exp)

    return min(expirations) if expirations else None


def _record_expiration(record: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not isinstance(record, dict):
        return None

    return (
        _parse_datetime(record.get("expires_at"))
        or _earliest_expiration_from_documents(record)
        or _parse_datetime(record.get("expiration_date"))
    )


def _expires_in_days(record: Optional[Dict[str, Any]]) -> Optional[int]:
    expiration = _record_expiration(record)
    if not expiration:
        return None

    delta = expiration - _now()
    seconds = delta.total_seconds()
    days = int(seconds // 86400)
    if seconds > 0 and seconds % 86400:
        days += 1
    return days


def _compute_lifecycle_status(record: Optional[Dict[str, Any]]) -> str:
    """Internal verification truth used by admin/review flows."""
    if not record:
        return "unverified"

    status = _safe_lower(record.get("status")) or "not_started"

    if status in {"expired", "needs_renewal"}:
        return status

    if status != "verified":
        return status

    expiration = _record_expiration(record)
    if not expiration:
        return "verified"

    now = _now()
    if expiration < now:
        return "expired"

    if expiration - now <= timedelta(days=EXPIRING_SOON_DAYS):
        return "expiring_soon"

    return "verified"


def _review_status(record: Optional[Dict[str, Any]]) -> str:
    if not isinstance(record, dict):
        return "none"

    explicit = _safe_lower(record.get("review_status") or record.get("reviewStatus"))
    if explicit:
        return explicit

    raw = _safe_lower(record.get("status"))
    if raw == "verified":
        return "approved"
    if raw == "pending":
        return "renewal_pending"
    if raw == "rejected":
        return "rejected"
    return raw or "none"


def _public_verification_display(record: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Reputation-safe public display. Keep raw lifecycle details internal/admin-only."""
    lifecycle_status = _compute_lifecycle_status(record)
    review_status = _review_status(record)

    if lifecycle_status in {"verified", "expiring_soon"}:
        return {
            "public_verification_status": "verified",
            "public_verification_label": "Verified",
        }

    if review_status in {"pending", "renewal_pending"}:
        return {
            "public_verification_status": "renewal_pending",
            "public_verification_label": "Renewal pending",
        }

    return {
        "public_verification_status": "not_verified",
        "public_verification_label": "Not verified",
    }


def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    lifecycle_status = _compute_lifecycle_status(record)
    review_status = _review_status(record)
    public_display = _public_verification_display(record)
    expiration = _record_expiration(record)

    return {
        **record,
        "verification_status": lifecycle_status,
        "review_status": review_status,
        "expires_at": record.get("expires_at") or (expiration.isoformat() if expiration else None),
        "last_verified_at": record.get("last_verified_at") or record.get("reviewed_at"),
        "expires_in_days": _expires_in_days(record),
        "is_expired": lifecycle_status == "expired",
        "is_expiring_soon": lifecycle_status == "expiring_soon",
        **public_display,
    }


@router.post("/verification/submit")
def submit_verification(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    email = _safe_lower(payload.get("email") or user.get("email"))
    role = _safe_lower(payload.get("role") or user.get("role"))

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
                "fee_paid": bool(record.get("fee_paid") or _safe_lower(payload.get("payment_status")) == "paid"),
                "paid_at": record.get("paid_at"),
                "stripe_checkout_session_id": record.get("stripe_checkout_session_id"),
                "stripe_payment_intent_id": record.get("stripe_payment_intent_id"),
                "fee_amount": payload.get("fee_amount", record.get("fee_amount", _verification_fee_amount(role))),
                "expiration_date": payload.get("expiration_date") or record.get("expiration_date"),
                "expires_at": record.get("expires_at"),
                "last_verified_at": record.get("last_verified_at"),
                "renewal_payment_status": record.get("renewal_payment_status"),
                "renewal_paid_at": record.get("renewal_paid_at"),
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
            "fee_paid": _safe_lower(payload.get("payment_status")) == "paid",
            "paid_at": _now_iso() if _safe_lower(payload.get("payment_status")) == "paid" else None,
            "fee_amount": payload.get("fee_amount", _verification_fee_amount(role)),
            "expiration_date": payload.get("expiration_date"),
            "expires_at": None,
            "last_verified_at": None,
        }
        _VERIFICATIONS[verification_id] = saved

    save_store()

    return {
        "ok": True,
        "verification": _public_record(saved),
    }




@router.get("/verification/me")
def get_my_verification(user: dict = Depends(get_current_user)):
    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))

    if role not in VALID_ROLES:
        raise HTTPException(status_code=403, detail="Verification is only available for vendor and organizer accounts")

    record = _find_latest_record(email, role)
    if not record:
        record = _get_or_create_payment_record(email, role, fee_amount=_verification_fee_amount(role))
        save_store()

    public = _public_record(record)

    return {
        "ok": True,
        "email": email,
        "role": role,
        "verification_status": public.get("verification_status"),
        "expires_at": public.get("expires_at"),
        "last_verified_at": public.get("last_verified_at"),
        "expires_in_days": public.get("expires_in_days"),
        "verification": public,
    }


@router.post("/verification/create-checkout")
def create_verification_checkout(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()

    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))

    if role not in VALID_ROLES:
        raise HTTPException(status_code=403, detail="Verification checkout is only available for vendor and organizer accounts")

    success_url = _safe_str(payload.get("success_url"))
    cancel_url = _safe_str(payload.get("cancel_url"))
    if not success_url or not cancel_url:
        raise HTTPException(status_code=400, detail="Missing success_url or cancel_url")

    fee_amount = _verification_fee_amount(role)
    record = _get_or_create_payment_record(email, role, fee_amount=fee_amount)

    lifecycle_status = _compute_lifecycle_status(record)
    renewal_requested = bool(payload.get("renewal") or payload.get("renewal_requested"))
    already_paid_current_verification = (
        (record.get("fee_paid") is True or _safe_lower(record.get("payment_status")) == "paid")
        and lifecycle_status not in {"expired", "expiring_soon", "needs_renewal"}
        and not renewal_requested
    )

    if already_paid_current_verification:
        return {"ok": True, "already_paid": True, "verification": _public_record(record)}

    if renewal_requested and _safe_lower(record.get("renewal_payment_status")) == "paid":
        return {"ok": True, "already_paid": True, "verification": _public_record(record)}

    try:
        session = stripe_sdk.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=str(user.get("id") or ""),
            customer_email=email or None,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": f"VendCore {role.title()} Verification Fee",
                        },
                        "unit_amount": int(fee_amount * 100),
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "payment_type": "verification_fee",
                "verification": "true",
                "verification_id": str(record.get("id") or ""),
                "user_id": str(user.get("id") or ""),
                "email": email,
                "role": role,
                "renewal": "true" if renewal_requested else "false",
            },
            payment_intent_data={
                "metadata": {
                    "payment_type": "verification_fee",
                    "verification": "true",
                    "verification_id": str(record.get("id") or ""),
                    "user_id": str(user.get("id") or ""),
                    "email": email,
                    "role": role,
                    "renewal": "true" if renewal_requested else "false",
                }
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe verification checkout failed: {exc}")

    record["stripe_checkout_session_id"] = str(_checkout_session_value(session, "id", "") or "")
    record["checkout_created_at"] = _now_iso()
    save_store()

    return {
        "ok": True,
        "url": _checkout_session_value(session, "url", None),
        "session_id": _checkout_session_value(session, "id", None),
        "verification": _public_record(record),
    }


@router.post("/verification/confirm-payment")
def confirm_verification_payment(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    """Manual fallback for checkout redirects. Webhooks are still the source of truth."""
    stripe_sdk = _require_stripe()

    session_id = _safe_str(payload.get("session_id"))
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to retrieve Stripe session: {exc}")

    metadata = _checkout_metadata(session)
    payment_type = _safe_lower(metadata.get("payment_type"))
    payment_status = _safe_lower(_checkout_session_value(session, "payment_status", ""))

    is_verification_payment = (
        payment_type == "verification_fee"
        or _safe_lower(metadata.get("verification")) == "true"
    )

    if not is_verification_payment:
        raise HTTPException(status_code=400, detail="Stripe session is not a verification payment")

    email = _safe_lower(metadata.get("email") or user.get("email"))
    role = _safe_lower(metadata.get("role") or user.get("role"))

    if email != _safe_lower(user.get("email")) or role != _safe_lower(user.get("role")):
        raise HTTPException(status_code=403, detail="Stripe session does not belong to this account")

    if payment_status != "paid":
        raise HTTPException(status_code=400, detail="Payment is not marked paid yet")

    record = mark_verification_paid(
        email=email,
        role=role,
        stripe_session_id=session_id,
        stripe_payment_intent_id=str(_checkout_session_value(session, "payment_intent", "") or ""),
        amount_paid=_checkout_session_value(session, "amount_total", None),
    )

    if record and _safe_lower(metadata.get("renewal")) == "true":
        record["renewal_payment_status"] = "paid"
        record["renewal_paid_at"] = _now_iso()
        save_store()

    return {"ok": True, "verification": _public_record(record)}


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
        now = _now()
        provided_expiration = _safe_str(
            payload.get("expires_at")
            or payload.get("expiresAt")
            or payload.get("expiration_date")
            or payload.get("expirationDate")
        )
        expiration = _parse_datetime(provided_expiration) or (
            now + timedelta(days=DEFAULT_VERIFICATION_DURATION_DAYS)
        )
        record["last_verified_at"] = now.isoformat()
        record["expires_at"] = expiration.isoformat()
        record["expiration_date"] = expiration.isoformat()
        record["renewal_payment_status"] = None
        record["renewal_paid_at"] = None

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
