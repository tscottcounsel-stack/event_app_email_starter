from __future__ import annotations

import json
import os

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app import store as store_module
from app.routers.auth import get_current_user
from sqlalchemy import func, or_, text
from app.db import SessionLocal
from app.models.profile import Profile

router = APIRouter(tags=["Verifications"])

VALID_ROLES = {"vendor", "organizer"}
VALID_REVIEW_STATUSES = {"verified", "rejected"}
EXPIRING_SOON_DAYS = 30
DEFAULT_VERIFICATION_DURATION_DAYS = 365


def _verification_store() -> Dict[int, Dict[str, Any]]:
    """Return the durable verification store from app.store.

    Do not import _VERIFICATIONS directly. app.store.load_store() reassigns
    that dictionary, so a direct import can point at a stale object and cause
    submit/payment/admin reads to drift.
    """
    store_module.load_store()
    return store_module._VERIFICATIONS


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
    for key in _verification_store().keys():
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


def _first_media_url(value: Any) -> str:
    """Return the first usable media URL from a string/list/dict payload."""
    if isinstance(value, str):
        return _safe_str(value)
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and _safe_str(item):
                return _safe_str(item)
            if isinstance(item, dict):
                found = _safe_str(
                    item.get("url")
                    or item.get("secure_url")
                    or item.get("src")
                    or item.get("image_url")
                    or item.get("imageUrl")
                )
                if found:
                    return found
    if isinstance(value, dict):
        return _safe_str(
            value.get("url")
            or value.get("secure_url")
            or value.get("src")
            or value.get("image_url")
            or value.get("imageUrl")
        )
    return ""


def _profile_attr(row: Optional[Profile], *names: str) -> str:
    if row is None:
        return ""
    for name in names:
        try:
            value = getattr(row, name, None)
        except Exception:
            value = None
        found = _first_media_url(value)
        if found:
            return found
    return ""


def _profile_logo_url(data: Dict[str, Any], row: Optional[Profile] = None) -> str:
    """Resolve the same logo source used by public profile pages.

    Some profiles store the logo as a real column on the Profile row, while
    others store it inside the JSON data blob. Public verification pages should
    check both so the verified credential matches the public profile card.
    """
    if not isinstance(data, dict):
        data = {}

    direct = _safe_str(
        data.get("logo_url")
        or data.get("logoUrl")
        or data.get("logo_data_url")
        or data.get("logoDataUrl")
        or data.get("business_logo_url")
        or data.get("businessLogoUrl")
        or data.get("profile_image_url")
        or data.get("profileImageUrl")
        or data.get("avatar_url")
        or data.get("avatarUrl")
        or data.get("image_url")
        or data.get("imageUrl")
    )
    if direct:
        return direct

    row_direct = _profile_attr(
        row,
        "logo_url",
        "logoUrl",
        "logo_data_url",
        "logoDataUrl",
        "business_logo_url",
        "businessLogoUrl",
        "profile_image_url",
        "profileImageUrl",
        "avatar_url",
        "avatarUrl",
        "image_url",
        "imageUrl",
    )
    if row_direct:
        return row_direct

    for key in (
        "logo",
        "profile_image",
        "profileImage",
        "avatar",
        "images",
        "image_urls",
        "imageUrls",
        "media",
        "gallery",
        "photos",
        "photo_urls",
        "photoUrls",
    ):
        found = _first_media_url(data.get(key))
        if found:
            return found

    row_media = _profile_attr(row, "image_urls", "imageUrls", "images", "media", "gallery", "photos")
    if row_media:
        return row_media

    return ""


def _record_matches_identity(record: Dict[str, Any], email: str, role: str) -> bool:
    record_email = _safe_lower(record.get("email"))
    record_role = _safe_lower(record.get("role"))
    return bool(record_email and email and record_email == email and record_role == role)


def _find_latest_record(email: str, role: str = "") -> Optional[Dict[str, Any]]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)

    matches: List[Dict[str, Any]] = []
    for record in _verification_store().values():
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
        was_paid = _record_fee_paid(existing)
        if extra:
            merged_extra = dict(extra)
            if was_paid:
                # Starting/restarting a checkout must never erase a payment that
                # Stripe already confirmed. This protects the admin queue after
                # redirects, refreshes, and webhook retries.
                merged_extra.pop("fee_paid", None)
                merged_extra.pop("paid_at", None)
                if _safe_lower(merged_extra.get("payment_status")) == "unpaid":
                    merged_extra.pop("payment_status", None)
                if _safe_lower(merged_extra.get("verification_payment_status")) == "unpaid":
                    merged_extra.pop("verification_payment_status", None)
            existing.update(merged_extra)
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
    _verification_store()[verification_id] = record
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






def _profile_row_to_verification_record(email: str, role: str) -> Optional[Dict[str, Any]]:
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        row = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == _safe_lower(email), Profile.role == _safe_lower(role))
            .order_by(Profile.updated_at.desc())
            .first()
        )
        if row is None:
            return None
        data = row.data if isinstance(row.data, dict) else {}
        status = _safe_lower(row.verification_status or data.get("verification_status") or data.get("status"))
        public_status = _safe_lower(row.public_verification_status or data.get("public_verification_status"))
        verified = bool(row.verified or status in {"verified", "approved", "complete", "expiring_soon"} or public_status == "verified")
        payment_status = _safe_lower(data.get("verification_payment_status") or data.get("payment_status"))
        return {
            "id": data.get("verification_id") or row.id,
            "email": _safe_lower(email),
            "role": _safe_lower(role),
            "status": "verified" if verified else (status or "not_started"),
            "verification_status": "verified" if verified else (public_status or status or "not_verified"),
            "review_status": row.review_status or data.get("review_status") or ("approved" if verified else ""),
            "fee_paid": payment_status == "paid" or bool(data.get("fee_paid")),
            "payment_status": payment_status or ("paid" if data.get("fee_paid") else "unpaid"),
            "fee_amount": data.get("fee_amount") or _verification_fee_for_role(role),
            "business_name": row.business_name or data.get("business_name") or data.get("businessName"),
            "tax_id_masked": data.get("tax_id_masked"),
            "submitted_at": data.get("submitted_at") or data.get("created_at") or row.created_at.isoformat() if getattr(row, "created_at", None) else None,
            "reviewed_at": data.get("reviewed_at") or data.get("last_verified_at"),
            "last_verified_at": data.get("last_verified_at") or data.get("reviewed_at"),
            "expires_at": data.get("expires_at") or data.get("expiration_date"),
            "expiration_date": data.get("expiration_date") or data.get("expires_at"),
            "documents": data.get("documents") if isinstance(data.get("documents"), list) else [],
        }
    except Exception:
        return None
    finally:
        db.close()


def _sync_verification_record_to_profile(record: Dict[str, Any]) -> None:
    if SessionLocal is None or not isinstance(record, dict):
        return
    email = _safe_lower(record.get("email"))
    role = _safe_lower(record.get("role"))
    if not email or role not in VALID_ROLES:
        return
    db = SessionLocal()
    try:
        row = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email, Profile.role == role)
            .one_or_none()
        )
        if row is None:
            row = Profile(email=email, role=role)
            db.add(row)
        data = row.data if isinstance(row.data, dict) else {}
        status = _compute_lifecycle_status(record)
        paid = _record_fee_paid(record)
        row.data = {
            **data,
            "email": email,
            "role": role,
            "verification_id": record.get("id"),
            "verification_status": status,
            "payment_status": "paid" if paid else _safe_lower(record.get("payment_status")) or "unpaid",
            "verification_payment_status": "paid" if paid else _safe_lower(record.get("verification_payment_status")) or "unpaid",
            "fee_paid": paid,
            "fee_amount": record.get("fee_amount") or _verification_fee_for_role(role),
            "submitted_at": record.get("submitted_at"),
            "reviewed_at": record.get("reviewed_at"),
            "last_verified_at": record.get("last_verified_at") or record.get("reviewed_at"),
            "expiration_date": record.get("expiration_date"),
            "expires_at": record.get("expires_at") or record.get("expiration_date"),
            "documents": record.get("documents") if isinstance(record.get("documents"), list) else data.get("documents", []),
        }
        verified = status in {"verified", "expiring_soon"}
        row.verified = verified
        row.verification_status = status
        row.public_verification_status = "verified" if verified else "not_verified"
        row.public_verification_label = "Verified" if verified else "Not verified"
        row.review_status = "approved" if verified else (_safe_lower(record.get("review_status")) or row.review_status)
        if record.get("business_name") and not row.business_name:
            row.business_name = _safe_str(record.get("business_name"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def mark_verification_paid(
    *,
    email: str,
    role: str = "vendor",
    stripe_session_id: str = "",
    stripe_payment_intent_id: str = "",
    amount_paid: Any = None,
    verification_id: Any = None,
) -> Dict[str, Any]:
    """Persist a Stripe-confirmed verification payment.

    Called by billing.py from Stripe webhooks and safe to call repeatedly. It
    updates the JSON verification store and mirrors the payment state into the
    Postgres Profile row used by admin/profile and public badges.
    """
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role) or "vendor"
    if normalized_role not in VALID_ROLES:
        normalized_role = "vendor"
    if not normalized_email:
        raise ValueError("Verification payment is missing email")

    record: Optional[Dict[str, Any]] = None
    clean_verification_id = _safe_str(verification_id)
    if clean_verification_id:
        try:
            candidate = _verification_store().get(int(clean_verification_id))
            if isinstance(candidate, dict):
                record = candidate
        except Exception:
            record = None

    if record is None:
        record = _ensure_identity_record(normalized_email, normalized_role)

    now = _now_iso()
    current_status = _safe_lower(record.get("status"))
    if current_status in {"", "not_started", "unpaid"}:
        record["status"] = "pending"

    record.update(
        {
            "email": normalized_email,
            "role": normalized_role,
            "payment_status": "paid",
            "verification_payment_status": "paid",
            "fee_paid": True,
            "paid_at": record.get("paid_at") or now,
            "updated_at": now,
            "fee_amount": round(float(amount_paid or (_verification_fee_for_role(normalized_role) * 100)) / 100.0, 2),
        }
    )

    if stripe_session_id:
        record["checkout_session_id"] = stripe_session_id
        record["stripe_session_id"] = stripe_session_id
    if stripe_payment_intent_id:
        record["stripe_payment_intent_id"] = stripe_payment_intent_id

    store_module.save_store()
    _sync_verification_record_to_profile(record)
    return record



def _profile_public_payload_from_row(row: Profile, *, email: str, role: str) -> Dict[str, Any]:
    data = row.data if isinstance(row.data, dict) else {}

    documents = []
    if isinstance(data.get("documents"), list):
        documents = _normalize_documents(data.get("documents"))

    verified = bool(
        row.verified
        or _safe_lower(row.verification_status) in {"verified", "approved", "complete", "expiring_soon"}
        or _safe_lower(row.public_verification_status) == "verified"
    )

    business_name = _safe_str(
        row.business_name
        or data.get("business_name")
        or data.get("businessName")
        or data.get("company_name")
        or data.get("companyName")
        or data.get("organization_name")
        or data.get("organizationName")
        or data.get("name")
    )

    display_name = _safe_str(
        row.display_name
        or data.get("display_name")
        or data.get("displayName")
        or data.get("contact_name")
        or data.get("contactName")
        or business_name
        or email
    )

    categories = data.get("categories") if isinstance(data.get("categories"), list) else []
    if not categories and isinstance(row.categories, list):
        categories = row.categories

    payload = {
        "id": row.id,
        "email": _safe_lower(email),
        "role": _safe_lower(role),
        "name": business_name or display_name or email,
        "business_name": business_name or display_name or email,
        "businessName": business_name or display_name or email,
        "display_name": display_name,
        "displayName": display_name,
        "city": _safe_str(row.city or data.get("city")),
        "state": _safe_str(row.state or data.get("state")),
        "country": _safe_str(data.get("country") or "United States"),
        "phone": _safe_str(
            data.get("phone")
            or data.get("contact_phone")
            or data.get("contactPhone")
            or data.get("business_phone")
            or data.get("businessPhone")
        ),
        "categories": categories,
        "category": categories[0] if categories else _safe_str(data.get("category") or data.get("vendor_category")),
        "logo_url": _profile_logo_url(data, row),
        "logoUrl": _profile_logo_url(data, row),
        "verified": verified,
        "verification_status": "verified" if verified else (_safe_lower(row.verification_status) or "unverified"),
        "verificationStatus": "verified" if verified else (_safe_lower(row.verification_status) or "unverified"),
        "public_verification_status": "verified" if verified else (_safe_lower(row.public_verification_status) or "not_verified"),
        "publicVerificationStatus": "verified" if verified else (_safe_lower(row.public_verification_status) or "not_verified"),
        "public_verification_label": row.public_verification_label or ("Verified Vendor" if role == "vendor" and verified else "Verified Organizer" if verified else "Not verified"),
        "publicVerificationLabel": row.public_verification_label or ("Verified Vendor" if role == "vendor" and verified else "Verified Organizer" if verified else "Not verified"),
        "review_status": row.review_status or data.get("review_status") or ("approved" if verified else ""),
        "reviewStatus": row.review_status or data.get("reviewStatus") or ("approved" if verified else ""),
        "visibility_tier": row.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier") or "standard",
        "visibilityTier": row.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier") or "standard",
        "subscription_plan": row.subscription_plan or data.get("subscription_plan") or data.get("subscriptionPlan"),
        "subscription_status": row.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus"),
        "last_verified_at": data.get("last_verified_at") or data.get("reviewed_at") or data.get("verified_at"),
        "lastVerifiedAt": data.get("lastVerifiedAt") or data.get("last_verified_at") or data.get("reviewed_at") or data.get("verified_at"),
        "documents": documents,
    }
    return payload


def _load_public_profile_row(db: Any, *, email: str, role: str) -> Optional[Profile]:
    return (
        db.query(Profile)
        .filter(func.lower(Profile.email) == _safe_lower(email), Profile.role == _safe_lower(role))
        .filter(or_(Profile.verification_status.is_(None), func.lower(Profile.verification_status) != "deleted"))
        .order_by(Profile.id.desc())
        .first()
    )


def _load_public_verification_documents(db: Any, *, email: str, role: str, profile_id: Any = None) -> List[Dict[str, Any]]:
    """Best-effort read from the current verification_documents table.

    The table has changed over time, so this uses raw SQL and mapping access
    instead of requiring a dedicated ORM model. Public output intentionally
    excludes file URLs and expiration dates.
    """
    documents: List[Dict[str, Any]] = []
    try:
        clauses = ["(lower(owner_email) = :email AND lower(owner_role) = :role)"]
        params: Dict[str, Any] = {"email": _safe_lower(email), "role": _safe_lower(role), "limit": 100}
        if profile_id not in (None, ""):
            clauses.append("owner_profile_id = :profile_id")
            params["profile_id"] = profile_id

        rows = db.execute(
            text(
                f"""
                SELECT *
                FROM verification_documents
                WHERE {' OR '.join(clauses)}
                ORDER BY id DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()

        seen = set()
        for row in rows:
            doc_type = _safe_str(
                row.get("document_type")
                or row.get("type")
                or row.get("category")
                or row.get("requirement_name")
                or row.get("name")
                or row.get("label")
                or "Document"
            )
            label = _safe_str(
                row.get("label")
                or row.get("document_name")
                or row.get("name")
                or row.get("requirement_name")
                or doc_type
            )
            status = _safe_str(
                row.get("public_status")
                or row.get("review_status")
                or row.get("status")
                or row.get("approval_status")
                or "Reviewed"
            )
            key = f"{label}|{doc_type}".lower()
            if key in seen:
                continue
            seen.add(key)
            documents.append({
                "label": label or "Reviewed document",
                "name": label or "Reviewed document",
                "type": doc_type or "Document",
                "status": status or "Reviewed",
                "reviewed": _safe_lower(status) not in {"pending", "rejected", "missing"},
            })
    except Exception as exc:
        print("⚠️ Public verification documents lookup skipped:", str(exc))
    return documents


@router.get("/verification/public/{role}/{email}")
def get_public_verification(role: str, email: str):
    normalized_role = _safe_lower(role)
    normalized_email = _safe_lower(email)
    if normalized_role not in VALID_ROLES or not normalized_email:
        raise HTTPException(status_code=404, detail="Not Found")
    if SessionLocal is None:
        raise HTTPException(status_code=500, detail="Database unavailable")

    db = SessionLocal()
    try:
        row = _load_public_profile_row(db, email=normalized_email, role=normalized_role)
        if row is None:
            raise HTTPException(status_code=404, detail="Not Found")

        profile = _profile_public_payload_from_row(row, email=normalized_email, role=normalized_role)
        db_documents = _load_public_verification_documents(
            db,
            email=normalized_email,
            role=normalized_role,
            profile_id=getattr(row, "id", None),
        )
        if db_documents:
            profile["documents"] = db_documents

        verification = {
            **profile,
            "status": profile.get("verification_status"),
            "verification_status": profile.get("verification_status"),
            "public_verification_status": profile.get("public_verification_status"),
            "review_status": profile.get("review_status"),
            "documents": profile.get("documents") or [],
        }

        return {
            "ok": True,
            "email": normalized_email,
            "role": normalized_role,
            "profile": profile,
            "vendor": profile if normalized_role == "vendor" else None,
            "organizer": profile if normalized_role == "organizer" else None,
            "verification": verification,
            "verified": profile.get("verified") is True,
            "verification_status": profile.get("verification_status"),
            "public_verification_status": profile.get("public_verification_status"),
            "public_verification_label": profile.get("public_verification_label"),
            "review_status": profile.get("review_status"),
            "documents": profile.get("documents") or [],
        }
    finally:
        db.close()


@router.get("/verification/public/{email}")
def get_public_vendor_verification_by_email(email: str):
    return get_public_verification("vendor", email)


@router.get("/verification/public/{role}/{email}/trust-history")
def get_public_verification_trust_history(role: str, email: str):
    normalized_role = _safe_lower(role)
    normalized_email = _safe_lower(email)
    if normalized_role not in VALID_ROLES or not normalized_email:
        raise HTTPException(status_code=404, detail="Not Found")
    if SessionLocal is None:
        return {"ok": True, "records": [], "summary": {"confirmed_count": 0, "flagged_count": 0, "organizer_count": 0, "event_count": 0}}

    db = SessionLocal()
    try:
        records: List[Dict[str, Any]] = []
        if normalized_role == "vendor":
            try:
                rows = db.execute(
                    text(
                        """
                        SELECT *
                        FROM vendor_trust_history
                        WHERE lower(vendor_email) = :email
                        ORDER BY COALESCE(confirmed_at, created_at) DESC NULLS LAST, id DESC
                        LIMIT 25
                        """
                    ),
                    {"email": normalized_email},
                ).mappings().all()
                records = [dict(row) for row in rows]
            except Exception as exc:
                print("⚠️ Public trust history lookup skipped:", str(exc))

        flagged_count = sum(1 for row in records if _safe_lower(row.get("trust_status")) == "flagged")
        confirmed_records = [row for row in records if _safe_lower(row.get("trust_status")) != "flagged"]
        organizer_count = len({ _safe_lower(row.get("organizer_email")) for row in confirmed_records if _safe_lower(row.get("organizer_email")) })
        event_count = len({ _safe_str(row.get("event_id") or row.get("event_name")) for row in confirmed_records if _safe_str(row.get("event_id") or row.get("event_name")) })

        return {
            "ok": True,
            "records": records,
            "summary": {
                "confirmed_count": len(confirmed_records),
                "flagged_count": flagged_count,
                "organizer_count": organizer_count,
                "event_count": event_count,
            },
        }
    finally:
        db.close()


@router.get("/verification/me")
def get_my_verification(current_user: dict = Depends(get_current_user)):
    email, role = _current_identity(current_user)
    record = _find_latest_record(email, role) or _profile_row_to_verification_record(email, role)
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
    store_module.save_store()

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
                "payment_type": "verification_fee",
                "verification": "true",
            },
        )
        record["checkout_session_id"] = str(session.get("id") if isinstance(session, dict) else session.id)
        store_module.save_store()
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
    store_module.save_store()
    _sync_verification_record_to_profile(record)

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
    for verification_id, record in _verification_store().items():
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
        _verification_store()[verification_id] = saved

    store_module.save_store()
    _sync_verification_record_to_profile(saved)

    return {
        "ok": True,
        "verification": _public_record(saved),
    }


@router.post("/verification/cancel")
def cancel_my_verification(payload: Optional[Dict[str, Any]] = None, current_user: dict = Depends(get_current_user)):
    """Allow the signed-in user to withdraw/cancel their public verification.

    This does not issue a refund or delete historical records. It removes the
    public verified state, keeps the payment/document history for support/admin
    review, and mirrors the canceled state into the Profile row used by public
    pages and directories.
    """
    email, role = _current_identity(current_user)
    payload = payload or {}
    record = _find_latest_record(email, role) or _ensure_identity_record(email, role)

    now = _now_iso()
    record.update(
        {
            "email": email,
            "role": role,
            "status": "cancelled",
            "verification_status": "cancelled",
            "public_verification_status": "not_verified",
            "publicVerificationStatus": "not_verified",
            "review_status": "cancelled",
            "reviewStatus": "cancelled",
            "cancelled_at": now,
            "canceled_at": now,
            "cancel_reason": _safe_str(payload.get("reason") or payload.get("cancel_reason") or "Cancelled by user"),
            "updated_at": now,
        }
    )
    store_module.save_store()
    _sync_verification_record_to_profile(record)

    return {
        "ok": True,
        "message": "Verification has been cancelled for this account.",
        "verification": _private_record(record, email, role),
    }


@router.post("/verification/reactivate")
def reactivate_my_verification(payload: Optional[Dict[str, Any]] = None, current_user: dict = Depends(get_current_user)):
    email, role = _current_identity(current_user)
    record = _find_latest_record(email, role) or _ensure_identity_record(email, role)
    paid = _record_fee_paid(record)
    docs = _normalize_documents(record.get("documents")) if isinstance(record.get("documents"), list) else []
    next_status = "pending" if paid or docs else "not_started"
    now = _now_iso()

    record.update(
        {
            "email": email,
            "role": role,
            "status": next_status,
            "verification_status": "pending" if next_status == "pending" else "not_verified",
            "public_verification_status": "pending" if next_status == "pending" else "not_verified",
            "publicVerificationStatus": "pending" if next_status == "pending" else "not_verified",
            "review_status": "pending" if next_status == "pending" else "not_started",
            "reviewStatus": "pending" if next_status == "pending" else "not_started",
            "cancelled_at": None,
            "canceled_at": None,
            "updated_at": now,
        }
    )
    store_module.save_store()
    _sync_verification_record_to_profile(record)

    return {
        "ok": True,
        "message": "Verification has been reactivated. Finish any required documents if prompted.",
        "verification": _private_record(record, email, role),
    }


@router.get("/verification/status")
def get_verification_status(email: str, role: str = ""):
    normalized_role = _safe_lower(role) or "vendor"
    record = _find_latest_record(email, normalized_role) or _profile_row_to_verification_record(email, normalized_role)
    return {
        "ok": True,
        "email": _safe_lower(email),
        "role": normalized_role,
        "verification_status": _compute_lifecycle_status(record),
        "verification": _public_record(record) if record else None,
    }




def _require_admin_user(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if _safe_lower(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


AI_REVIEW_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "overall_status": {"type": "string", "enum": ["pass", "caution", "fail", "needs_review", "unavailable"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "summary": {"type": "string"},
        "recommended_action": {"type": "string", "enum": ["approve_ready", "human_review", "request_more_info", "reject"]},
        "business_name_detected": {"type": ["string", "null"]},
        "name_match": {"type": "string", "enum": ["match", "possible_match", "mismatch", "unknown"]},
        "missing_documents": {"type": "array", "items": {"type": "string"}},
        "issues": {"type": "array", "items": {"type": "string"}},
        "documents": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "submitted_label": {"type": ["string", "null"]},
                    "submitted_type": {"type": ["string", "null"]},
                    "detected_document_type": {"type": ["string", "null"]},
                    "readable": {"type": "boolean"},
                    "requirement_match": {"type": "string", "enum": ["match", "possible_match", "mismatch", "unknown"]},
                    "vendor_name_detected": {"type": ["string", "null"]},
                    "issuer_detected": {"type": ["string", "null"]},
                    "policy_or_license_number": {"type": ["string", "null"]},
                    "issue_date": {"type": ["string", "null"]},
                    "expiration_date": {"type": ["string", "null"]},
                    "is_expired": {"type": ["boolean", "null"]},
                    "status_on_document": {"type": ["string", "null"]},
                    "notes": {"type": "array", "items": {"type": "string"}}
                },
                "required": [
                    "submitted_label",
                    "submitted_type",
                    "detected_document_type",
                    "readable",
                    "requirement_match",
                    "vendor_name_detected",
                    "issuer_detected",
                    "policy_or_license_number",
                    "issue_date",
                    "expiration_date",
                    "is_expired",
                    "status_on_document",
                    "notes"
                ]
            }
        }
    },
    "required": [
        "overall_status",
        "confidence",
        "summary",
        "recommended_action",
        "business_name_detected",
        "name_match",
        "missing_documents",
        "issues",
        "documents"
    ]
}


def _ai_unavailable_result(reason: str, record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "overall_status": "unavailable",
        "confidence": 0,
        "summary": reason,
        "recommended_action": "human_review",
        "business_name_detected": None,
        "name_match": "unknown",
        "missing_documents": [],
        "issues": [reason],
        "documents": [],
        "model": _safe_str(os.getenv("OPENAI_VERIFICATION_MODEL") or "gpt-4.1-mini"),
        "reviewed_at": _now_iso(),
        "record_email": _safe_lower(record.get("email")),
        "record_role": _safe_lower(record.get("role")),
    }


def _document_mime_from_url(url: str) -> str:
    lowered = _safe_lower(url)
    if lowered.startswith("data:"):
        header = lowered.split(",", 1)[0]
        return header.replace("data:", "").split(";", 1)[0]
    if ".pdf" in lowered:
        return "application/pdf"
    if any(ext in lowered for ext in [".jpg", ".jpeg"]):
        return "image/jpeg"
    if ".png" in lowered:
        return "image/png"
    if ".webp" in lowered:
        return "image/webp"
    if ".txt" in lowered:
        return "text/plain"
    return ""


def _document_model_parts(record: Dict[str, Any]) -> List[Dict[str, Any]]:
    max_chars = int(os.getenv("OPENAI_VERIFICATION_MAX_FILE_CHARS", "8000000"))
    docs = _normalize_documents(record.get("documents"))
    parts: List[Dict[str, Any]] = []

    for index, doc in enumerate(docs[:10], start=1):
        label = _safe_str(doc.get("label") or doc.get("name") or f"Document {index}")
        doc_type = _safe_str(doc.get("type"))
        filename = _safe_str(doc.get("name") or label or f"document-{index}")
        expiration = _safe_str(doc.get("expiration_date"))
        url = _safe_str(doc.get("url"))
        mime = _document_mime_from_url(url)

        parts.append({
            "type": "input_text",
            "text": (
                f"Document {index} metadata:\n"
                f"Submitted label: {label}\n"
                f"Submitted type: {doc_type}\n"
                f"Filename: {filename}\n"
                f"Vendor-entered expiration date: {expiration or 'not provided'}\n"
                f"Detected MIME hint: {mime or 'unknown'}"
            ),
        })

        if not url:
            parts.append({"type": "input_text", "text": f"Document {index} has no readable URL/file data."})
            continue

        if len(url) > max_chars:
            parts.append({
                "type": "input_text",
                "text": f"Document {index} file data was too large for AI pre-check and must be reviewed manually.",
            })
            continue

        try:
            if mime.startswith("image/") or url.startswith("http"):
                # Images can be reviewed by URL or data URL.
                parts.append({"type": "input_image", "image_url": url})
            elif mime in {"application/pdf", "text/plain", "application/rtf"} or url.startswith("data:"):
                # Responses API supports file_data data URLs for PDFs and text-like files.
                parts.append({"type": "input_file", "filename": filename, "file_data": url})
            else:
                parts.append({
                    "type": "input_text",
                    "text": f"Document {index} MIME type was not supported for AI file input. Manual review required.",
                })
        except Exception:
            parts.append({
                "type": "input_text",
                "text": f"Document {index} could not be attached to AI input. Manual review required.",
            })

    return parts


def _json_from_ai_text(text_value: str) -> Dict[str, Any]:
    raw = _safe_str(text_value)
    if not raw:
        raise ValueError("AI returned no text")
    try:
        return json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start : end + 1])
        raise


def _run_openai_verification_review(record: Dict[str, Any]) -> Dict[str, Any]:
    api_key = _safe_str(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        return _ai_unavailable_result("OPENAI_API_KEY is not configured on the backend.", record)

    docs = _normalize_documents(record.get("documents"))
    if not docs:
        return _ai_unavailable_result("No submitted documents were found on this verification record.", record)

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return _ai_unavailable_result("The openai Python package is not installed. Add openai to requirements.txt and redeploy.", record)

    client = OpenAI(api_key=api_key)
    model = _safe_str(os.getenv("OPENAI_VERIFICATION_MODEL") or "gpt-4.1-mini")
    business_name = _safe_str(record.get("business_name"))
    role = _safe_lower(record.get("role"))
    vendor_category = _safe_str(record.get("vendor_category"))

    content: List[Dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                "You are VendCore's AI-assisted verification pre-reviewer. "
                "You help an admin check whether submitted business documents appear complete, readable, current, and relevant. "
                "You do not approve the account. You only provide a structured pre-check for a human admin. "
                "Do not claim a document is authentic unless the document itself proves it. "
                "Flag authenticity or authority checks as human_review when needed.\n\n"
                f"Verification record email: {_safe_lower(record.get('email'))}\n"
                f"Role: {role}\n"
                f"Submitted business name: {business_name or 'not provided'}\n"
                f"Vendor category: {vendor_category or 'not provided'}\n"
                f"Submitted document count: {len(docs)}\n\n"
                "Check for: document type, readable text, matching business/vendor name, issue date, expiration date, expired status, "
                "policy/license/permit number, issuing agency/company, and whether the submitted file appears to match its labeled requirement. "
                "Return only JSON that follows the provided schema."
            ),
        }
    ]
    content.extend(_document_model_parts(record))

    try:
        if hasattr(client, "responses"):
            response = client.responses.create(
                model=model,
                input=[{"role": "user", "content": content}],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "vendcore_verification_precheck",
                        "schema": AI_REVIEW_SCHEMA,
                        "strict": True,
                    }
                },
            )
            parsed = _json_from_ai_text(getattr(response, "output_text", ""))
        else:
            # Compatibility fallback for older SDKs that do not expose Responses API.
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": "Return only valid JSON matching the VendCore verification pre-check schema.",
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "task": "AI-assisted verification pre-check",
                            "record": {
                                "email": _safe_lower(record.get("email")),
                                "role": role,
                                "business_name": business_name,
                                "vendor_category": vendor_category,
                                "documents": docs,
                            },
                            "schema": AI_REVIEW_SCHEMA,
                        })[:120000],
                    },
                ],
                response_format={"type": "json_object"},
            )
            parsed = _json_from_ai_text(response.choices[0].message.content or "")
    except Exception as exc:
        return _ai_unavailable_result(f"AI pre-check failed: {exc}", record)

    parsed["model"] = model
    parsed["reviewed_at"] = _now_iso()
    parsed["record_email"] = _safe_lower(record.get("email"))
    parsed["record_role"] = _safe_lower(record.get("role"))
    parsed["human_final_approval_required"] = True
    return parsed


@router.post("/admin/verifications/{verification_id}/ai-review")
def ai_review_verification(verification_id: int, user: Dict[str, Any] = Depends(_require_admin_user)):
    record = _verification_store().get(verification_id)

    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    result = _run_openai_verification_review(record)
    record["ai_review"] = result
    record["ai_reviewed_at"] = result.get("reviewed_at") or _now_iso()
    record["ai_review_status"] = result.get("overall_status")
    store_module.save_store()

    return {
        "ok": result.get("overall_status") != "unavailable",
        "ai_review": result,
        "verification": _public_record(record),
    }

@router.get("/admin/verifications")
def get_admin_verifications(role: str = "all", status: str = "all"):
    requested_role = _safe_lower(role) or "all"
    requested_status = _safe_lower(status) or "all"

    records = [
        _public_record(record)
        for record in _verification_store().values()
        if isinstance(record, dict)
    ]

    if requested_role in VALID_ROLES:
        records = [record for record in records if _safe_lower(record.get("role")) == requested_role]

    if requested_status != "all":
        def matches_status(record: Dict[str, Any]) -> bool:
            lifecycle = _compute_lifecycle_status(record)
            raw_status = _safe_lower(record.get("status"))
            review_status = _safe_lower(record.get("review_status"))
            payment_paid = _record_fee_paid(record)
            if requested_status == "pending":
                return raw_status in {"pending", "submitted", "under_review", "in_review", "not_started"} or (payment_paid and raw_status not in {"verified", "rejected", "deleted", "archived", "removed"})
            return requested_status in {lifecycle, raw_status, review_status, _safe_lower(record.get("verification_status"))}

        records = [record for record in records if matches_status(record)]

    records.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("paid_at") or item.get("created_at") or ""), reverse=True)

    return {
        "ok": True,
        "verifications": records,
        "count": len(records),
    }


@router.post("/admin/verify/{verification_id}")
def review_verification(verification_id: int, payload: Dict[str, Any]):
    record = _verification_store().get(verification_id)

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

    store_module.save_store()
    _sync_verification_record_to_profile(record)

    return {
        "ok": True,
        "verification": _public_record(record),
    }


@router.delete("/admin/verifications/{verification_id}")
def delete_verification(verification_id: int):
    if verification_id not in _verification_store():
        raise HTTPException(status_code=404, detail="Verification not found")

    removed = _verification_store().pop(verification_id)
    store_module.save_store()

    return {
        "ok": True,
        "deleted": removed,
    }
