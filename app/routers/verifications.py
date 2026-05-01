from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.routers.auth import get_current_user
from app.store import _VERIFICATIONS, save_store
from app.db import get_db
from app.models.profile import Profile

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

# Required documents are role-specific. A user is only fully verified while all
# required documents exist and are unexpired. Verification expiration is the
# earliest required document expiration date, with one-year approval fallback
# only when no document expiration dates were supplied.
REQUIRED_DOCS = {
    "vendor": ["business_license", "government_id"],
    "organizer": ["business_license", "government_id"],
}

DOC_LABELS = {
    "business_license": "Business license / registration",
    "government_id": "Government ID / legitimacy document",
    "certificate_of_insurance": "Certificate of insurance",
    "w9_document": "W-9",
    "business_registration": "DBA / business registration",
    "sales_tax_permit": "Sales tax / resale permit",
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
        "submitted_at": _now_iso(),
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


def _document_status_summary(record: Dict[str, Any]) -> Dict[str, Any]:
    role = _safe_lower(record.get("role"))
    required = REQUIRED_DOCS.get(role, [])
    documents = record.get("documents") or record.get("verification_documents") or record.get("verificationDocuments") or []
    if isinstance(documents, dict):
        documents = list(documents.values())

    now = _now()
    found_types = set()
    missing_expiration_docs: List[str] = []
    expired_docs: List[Dict[str, Any]] = []
    expiring_soon_docs: List[Dict[str, Any]] = []
    active_docs: List[Dict[str, Any]] = []

    if isinstance(documents, list):
        for doc in documents:
            if not isinstance(doc, dict):
                continue
            doc_type = _safe_lower(doc.get("type") or doc.get("document_type") or doc.get("category"))
            if doc_type:
                found_types.add(doc_type)

            label = _safe_str(doc.get("label") or doc.get("name") or DOC_LABELS.get(doc_type, doc_type or "Document"))
            expiration = _parse_datetime(
                doc.get("expiration_date")
                or doc.get("expirationDate")
                or doc.get("expires_at")
                or doc.get("expiresAt")
            )

            item = {
                "type": doc_type,
                "label": label,
                "name": _safe_str(doc.get("name")),
                "expiration_date": expiration.isoformat() if expiration else None,
                "url": _safe_str(doc.get("url")),
            }

            if not expiration:
                missing_expiration_docs.append(doc_type or label)
                continue

            if expiration < now:
                expired_docs.append(item)
            elif expiration - now <= timedelta(days=EXPIRING_SOON_DAYS):
                expiring_soon_docs.append(item)
            else:
                active_docs.append(item)

    missing_docs = [doc_type for doc_type in required if doc_type not in found_types]
    return {
        "required_docs": required,
        "missing_docs": missing_docs,
        "missing_expiration_docs": missing_expiration_docs,
        "expired_docs": expired_docs,
        "expiring_soon_docs": expiring_soon_docs,
        "active_docs": active_docs,
        "all_required_present": not missing_docs,
        "all_required_unexpired": not missing_docs and not expired_docs and not missing_expiration_docs,
    }


def _record_expiration(record: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not isinstance(record, dict):
        return None

    # The verification is only as current as the earliest expiring document.
    # Keep document expiration as source of truth; admin-level expires_at is a
    # fallback for legacy records or records with non-expiring documents.
    return (
        _earliest_expiration_from_documents(record)
        or _parse_datetime(record.get("expires_at"))
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
    """Internal verification truth used by admin/review flows.

    A verified account remains verified only while every required document is
    present and unexpired. The overall verification expiration is the earliest
    expiring document date.
    """
    if not record:
        return "unverified"

    status = _safe_lower(record.get("status")) or "not_started"

    if status != "verified":
        return status

    doc_status = _document_status_summary(record)
    if doc_status.get("missing_docs") or doc_status.get("missing_expiration_docs"):
        return "needs_renewal"

    if doc_status.get("expired_docs"):
        return "expired"

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

    document_status = _document_status_summary(record)

    return {
        **record,
        "verification_status": lifecycle_status,
        "review_status": review_status,
        "expires_at": expiration.isoformat() if expiration else record.get("expires_at"),
        "expiration_date": expiration.isoformat() if expiration else record.get("expiration_date"),
        "last_verified_at": record.get("last_verified_at") or record.get("reviewed_at"),
        "expires_in_days": _expires_in_days(record),
        "is_expired": lifecycle_status == "expired",
        "is_expiring_soon": lifecycle_status == "expiring_soon",
        "document_status": document_status,
        **public_display,
    }


def _profile_name_from_record(record: Dict[str, Any]) -> str:
    return _safe_str(
        record.get("business_name")
        or record.get("organizationName")
        or record.get("businessName")
        or record.get("company_name")
        or record.get("name")
        or record.get("email")
    )


def _sync_profile_from_verification(db: Session, record: Dict[str, Any]) -> None:
    """Persist approved/rejected verification truth into the shared Profile table.

    This keeps admin approval from living only in the verification queue. Public
    vendor/organizer pages now read from Profile first, so approval must update
    the Profile row as well.
    """
    email = _safe_lower(record.get("email"))
    role = _safe_lower(record.get("role"))
    if not email or role not in VALID_ROLES:
        return

    public = _public_record(record)
    verified = public.get("public_verification_status") == "verified"
    row = (
        db.query(Profile)
        .filter(Profile.email == email, Profile.role == role)
        .one_or_none()
    )
    if row is None:
        row = Profile(email=email, role=role)
        db.add(row)

    existing_data = dict(row.data or {})
    merged_data = {
        **existing_data,
        "email": email,
        "role": role,
        "verified": verified,
        "is_verified": verified,
        "verification_status": public.get("verification_status"),
        "verificationStatus": public.get("verification_status"),
        "review_status": public.get("review_status"),
        "reviewStatus": public.get("review_status"),
        "public_verification_status": public.get("public_verification_status"),
        "public_verification_label": public.get("public_verification_label"),
        "expiration_date": public.get("expiration_date"),
        "expires_at": public.get("expires_at"),
        "last_verified_at": public.get("last_verified_at"),
        "documents": public.get("documents") or [],
        "updated_at": _now_iso(),
    }

    if role == "vendor":
        name = _safe_str(existing_data.get("business_name") or existing_data.get("businessName") or _profile_name_from_record(record))
        merged_data.setdefault("business_name", name)
        merged_data.setdefault("businessName", name)
        merged_data.setdefault("vendor_id", email)
    else:
        name = _safe_str(existing_data.get("organizationName") or existing_data.get("businessName") or _profile_name_from_record(record))
        merged_data.setdefault("organizationName", name)
        merged_data.setdefault("businessName", name)

    categories = merged_data.get("categories") or merged_data.get("vendor_categories") or []
    if not isinstance(categories, list):
        categories = [str(categories)] if categories else []

    row.business_name = _safe_str(
        merged_data.get("business_name")
        or merged_data.get("businessName")
        or merged_data.get("organizationName")
        or name
    )
    row.display_name = _safe_str(merged_data.get("contactName") or merged_data.get("contact_name") or row.business_name)
    row.city = _safe_str(merged_data.get("city"))
    row.state = _safe_str(merged_data.get("state"))
    row.categories = categories
    row.data = merged_data
    row.verified = bool(verified)
    row.verification_status = _safe_str(public.get("verification_status")) or None
    row.public_verification_status = _safe_str(public.get("public_verification_status")) or None
    row.public_verification_label = _safe_str(public.get("public_verification_label")) or None
    row.review_status = _safe_str(public.get("review_status")) or None

    # Keep subscription and premium fields already present in the row/data.
    row.visibility_tier = row.visibility_tier or _safe_str(merged_data.get("visibility_tier") or merged_data.get("visibilityTier")) or None
    row.subscription_plan = row.subscription_plan or _safe_str(merged_data.get("subscription_plan") or merged_data.get("subscriptionPlan") or merged_data.get("plan")) or None
    row.subscription_status = row.subscription_status or _safe_str(merged_data.get("subscription_status") or merged_data.get("subscriptionStatus")) or None
    row.featured = bool(row.featured or merged_data.get("featured"))
    row.promoted = bool(row.promoted or merged_data.get("promoted"))

    db.commit()


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
    document_check = _document_status_summary({"role": role, "documents": documents})
    if document_check.get("missing_docs"):
        labels = [DOC_LABELS.get(item, item) for item in document_check["missing_docs"]]
        raise HTTPException(status_code=400, detail="Missing required document(s): " + ", ".join(labels))
    if document_check.get("missing_expiration_docs"):
        labels = [DOC_LABELS.get(item, item) for item in document_check["missing_expiration_docs"]]
        raise HTTPException(status_code=400, detail="Expiration date required for: " + ", ".join(labels))
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



def _get_verification_record_by_id(verification_id: Any) -> tuple[Any, Optional[Dict[str, Any]]]:
    """Find verification records even when JSON reloads int keys as strings."""
    candidates = [verification_id, _safe_str(verification_id)]
    try:
        candidates.append(int(verification_id))
    except Exception:
        pass

    for key in candidates:
        if key in _VERIFICATIONS and isinstance(_VERIFICATIONS.get(key), dict):
            return key, _VERIFICATIONS[key]

    target = _safe_str(verification_id)
    for key, record in _VERIFICATIONS.items():
        if not isinstance(record, dict):
            continue
        if _safe_str(record.get("id")) == target or _safe_str(record.get("user_id")) == target:
            return key, record

    return None, None


@router.get("/admin/verifications")
def get_admin_verifications(db: Session = Depends(get_db)):
    """Return only actionable verification records.

    Postgres Profile is the durable source of truth. JSON verification records are
    kept only for submitted document/payment metadata. If Postgres already says an
    account is verified/approved, that user must not reappear in the pending queue
    after a Railway redeploy.
    """
    by_identity: Dict[str, Dict[str, Any]] = {}

    for raw_record in _VERIFICATIONS.values():
        if not isinstance(raw_record, dict):
            continue

        email = _safe_lower(raw_record.get("email"))
        role = _safe_lower(raw_record.get("role"))
        if not email or role not in VALID_ROLES:
            continue

        profile = (
            db.query(Profile)
            .filter(Profile.email == email, Profile.role == role)
            .one_or_none()
        )

        if profile is not None:
            profile_verification_status = _safe_lower(profile.verification_status)
            profile_public_status = _safe_lower(profile.public_verification_status)
            profile_review_status = _safe_lower(profile.review_status)

            # Hard stop: verified/approved profiles are already complete, so they
            # should never be returned as pending/actionable queue rows.
            if (
                bool(profile.verified)
                or profile_public_status == "verified"
                or profile_review_status == "approved"
                or profile_verification_status == "verified"
            ):
                continue

        public = _public_record(raw_record)

        if profile is not None:
            public["verified"] = bool(profile.verified)
            public["is_verified"] = bool(profile.verified)
            public["verification_status"] = profile_verification_status or public.get("verification_status")
            public["public_verification_status"] = profile_public_status or public.get("public_verification_status")
            public["public_verification_label"] = profile.public_verification_label or public.get("public_verification_label")
            public["review_status"] = profile_review_status or public.get("review_status")
            public["subscription_plan"] = profile.subscription_plan
            public["subscription_status"] = profile.subscription_status
            public["visibility_tier"] = profile.visibility_tier
            public["featured"] = bool(profile.featured)
            public["promoted"] = bool(profile.promoted)

            if profile_review_status == "rejected" or profile_verification_status == "rejected":
                public["status"] = "rejected"
            elif profile_verification_status in {"expired", "expiring_soon", "needs_renewal", "renewal_pending"}:
                public["status"] = profile_verification_status

        key = f"{role}:{email}"
        existing = by_identity.get(key)
        if existing is None:
            by_identity[key] = public
            continue

        # Keep the newest actionable row and merge document lists so uploads do not vanish.
        existing_time = _safe_str(existing.get("submitted_at") or existing.get("created_at") or "")
        public_time = _safe_str(public.get("submitted_at") or public.get("created_at") or "")
        keep = public if public_time >= existing_time else existing
        other = existing if keep is public else public

        keep_docs = keep.get("documents") if isinstance(keep.get("documents"), list) else []
        other_docs = other.get("documents") if isinstance(other.get("documents"), list) else []
        seen = set()
        merged_docs = []
        for doc in [*keep_docs, *other_docs]:
            if not isinstance(doc, dict):
                continue
            marker = _safe_str(doc.get("url") or doc.get("name") or doc.get("label") or doc.get("type"))
            if marker and marker in seen:
                continue
            if marker:
                seen.add(marker)
            merged_docs.append(doc)
        keep["documents"] = merged_docs
        by_identity[key] = keep

    records = list(by_identity.values())
    records.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)

    return {"ok": True, "verifications": records, "count": len(records)}


@router.post("/admin/verify/{verification_id}")
def review_verification(
    verification_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
):
    record_key, record = _get_verification_record_by_id(verification_id)

    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    status = _safe_lower(payload.get("status"))

    if status not in VALID_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be verified or rejected")

    reviewed_at = _now_iso()
    record["status"] = status
    record["reviewed_at"] = reviewed_at
    record["reviewed_by"] = _safe_str(payload.get("reviewed_by") or payload.get("reviewedBy"))
    record["notes"] = _safe_str(payload.get("notes"))

    if not record.get("submitted_at"):
        record["submitted_at"] = record.get("created_at") or reviewed_at

    if status == "verified":
        now = _now()
        provided_expiration = _safe_str(
            payload.get("expires_at")
            or payload.get("expiresAt")
            or payload.get("expiration_date")
            or payload.get("expirationDate")
        )
        expiration = (
            _parse_datetime(provided_expiration)
            or _earliest_expiration_from_documents(record)
            or (now + timedelta(days=DEFAULT_VERIFICATION_DURATION_DAYS))
        )
        record["verified"] = True
        record["is_verified"] = True
        record["verification_status"] = "verified"
        record["review_status"] = "approved"
        record["public_verification_status"] = "verified"
        record["public_verification_label"] = "Verified"
        record["last_verified_at"] = now.isoformat()
        record["expires_at"] = expiration.isoformat()
        record["expiration_date"] = expiration.isoformat()
        record["locked"] = True
        record["renewal_payment_status"] = None
        record["renewal_paid_at"] = None
    else:
        record["verified"] = False
        record["is_verified"] = False
        record["verification_status"] = "rejected"
        record["review_status"] = "rejected"
        record["public_verification_status"] = "not_verified"
        record["public_verification_label"] = "Not verified"
        record["locked"] = True

    reviewed_email = _safe_lower(record.get("email"))
    reviewed_role = _safe_lower(record.get("role"))

    if status == "verified" and reviewed_email and reviewed_role:
        # Once approved, Postgres Profile becomes the durable source of truth.
        # Remove duplicate JSON rows so stale pending records cannot return after redeploy.
        keys_to_delete = []
        for key, other in list(_VERIFICATIONS.items()):
            if not isinstance(other, dict):
                continue
            if _safe_lower(other.get("email")) == reviewed_email and _safe_lower(other.get("role")) == reviewed_role:
                keys_to_delete.append(key)
        for key in keys_to_delete:
            _VERIFICATIONS.pop(key, None)
    elif reviewed_email and reviewed_role:
        # For rejection, mirror rejection to duplicate rows.
        for other in _VERIFICATIONS.values():
            if not isinstance(other, dict) or other is record:
                continue
            if _safe_lower(other.get("email")) == reviewed_email and _safe_lower(other.get("role")) == reviewed_role:
                other["status"] = record.get("status")
                other["verified"] = record.get("verified")
                other["is_verified"] = record.get("is_verified")
                other["verification_status"] = record.get("verification_status")
                other["review_status"] = record.get("review_status")
                other["public_verification_status"] = record.get("public_verification_status")
                other["public_verification_label"] = record.get("public_verification_label")
                other["reviewed_at"] = record.get("reviewed_at")
                other["reviewed_by"] = record.get("reviewed_by")
                other["locked"] = True

    _sync_profile_from_verification(db, record)
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
