from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from app.store import _VENDORS, save_store

from app.routers.auth import get_current_user
from app.store import (
    _APPLICATIONS,
    _EVENTS,
    _REVIEWS,
    _VENDORS,
    next_review_id,
    save_store,
    upsert_vendor,
)
from app.routers.verifications import _find_latest_record
from app.models.profile import Profile
from app.db import get_db
from sqlalchemy.orm import Session

from app.store import find_latest_verification_by_email

router = APIRouter(prefix="/vendors", tags=["Vendors"])

DEFAULT_PAGE_LIMIT = 24
MAX_PAGE_LIMIT = 100


def _page_limit(value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = DEFAULT_PAGE_LIMIT
    return max(1, min(n, MAX_PAGE_LIMIT))


def _page_offset(value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = 0
    return max(0, n)


def _vendor_page_payload(items: List[Dict[str, Any]], limit: int, offset: int) -> Dict[str, Any]:
    safe_limit = _page_limit(limit)
    safe_offset = _page_offset(offset)
    total = len(items)
    page = items[safe_offset:safe_offset + safe_limit]
    return {
        "vendors": page,
        "items": page,
        "count": len(page),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + safe_limit < total,
    }


@router.post("/admin/set-premium")
def set_vendor_premium(
    payload: dict,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)

    email = (payload.get("email") or "").strip().lower()
    featured = bool(payload.get("featured", True))

    if not email:
        raise HTTPException(status_code=400, detail="Vendor email required")

    vendor = _load_vendor_from_db(db, email)

    if not isinstance(vendor, dict):
        raise HTTPException(status_code=404, detail="Vendor not found")

    # HARD RESET PREMIUM FLAGS
    if not featured:
        vendor["featured"] = False
        vendor["promoted"] = False
        vendor["premium"] = False
        vendor["is_premium"] = False

        vendor["visibility_tier"] = "standard"
        vendor["visibilityTier"] = "standard"

        vendor["subscription_plan"] = "free"
        vendor["subscriptionPlan"] = "free"
        vendor["plan"] = "free"

        vendor["subscription_status"] = "inactive"
        vendor["subscriptionStatus"] = "inactive"
        vendor["marketplace_tier"] = "verified" if vendor.get("verified") else "standard"
        vendor["marketplaceTier"] = vendor["marketplace_tier"]
        vendor["premium_placement"] = False
        vendor["premiumPlacement"] = False

    else:
        vendor["featured"] = True
        vendor["promoted"] = True
        vendor["premium"] = True
        vendor["is_premium"] = True

        vendor["visibility_tier"] = "premium"
        vendor["visibilityTier"] = "premium"

        vendor["subscription_plan"] = "premium"
        vendor["subscriptionPlan"] = "premium"
        vendor["plan"] = "premium"

        vendor["subscription_status"] = "active"
        vendor["subscriptionStatus"] = "active"
        vendor["marketplace_tier"] = "premium_verified"
        vendor["marketplaceTier"] = "premium_verified"
        vendor["premium_placement"] = True
        vendor["premiumPlacement"] = True

    _upsert_profile_row(
        db,
        email=email,
        role="vendor",
        data=vendor,
    )

    return {
        "ok": True,
        "email": email,
        "featured": featured,
    }

@router.get("/admin/force-verify-vendor")
def force_verify_vendor_help():
    return {
        "ok": False,
        "detail": "Use POST with JSON body {\"email\": \"vendor@example.com\"}. This admin route updates the stored vendor verification display fields.",
    }

@router.post("/admin/unverify-vendor")
def unverify_vendor(
    payload: dict,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)

    email = _safe_str(payload.get("email")).lower()

    if not email:
        raise HTTPException(status_code=400, detail="Vendor email required")

    vendor = _load_vendor_from_db(db, email)

    if not isinstance(vendor, dict):
        raise HTTPException(status_code=404, detail="Vendor not found")

    vendor["verified"] = False
    vendor["verification_status"] = "unverified"
    vendor["public_verification_status"] = "not_verified"
    vendor["public_verification_label"] = "Verification available"
    vendor["review_status"] = "pending"

    # Clear premium state too
    vendor["featured"] = False
    vendor["promoted"] = False
    vendor["visibility_tier"] = "standard"
    vendor["visibilityTier"] = "standard"
    vendor["subscription_plan"] = "free"
    vendor["subscriptionPlan"] = "free"
    vendor["plan"] = "free"
    vendor["subscription_status"] = "inactive"
    vendor["subscriptionStatus"] = "inactive"
    vendor["marketplace_tier"] = "standard"
    vendor["marketplaceTier"] = "standard"
    vendor["premium_placement"] = False
    vendor["premiumPlacement"] = False

    _upsert_profile_row(
        db,
        email=email,
        role="vendor",
        data=vendor,
    )
    updated = _load_vendor_from_db(db, email) or vendor

    return {
        "ok": True,
        "email": email,
        "vendor": _vendor_public_payload(email, updated),
    }
@router.post("/admin/force-verify-vendor")
def force_verify_vendor(payload: dict, user: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_admin(user)

    email = _safe_str(payload.get("email")).lower()
    if not email:
        raise HTTPException(status_code=400, detail="Vendor email required")

    vendor = _load_vendor_from_db(db, email)
    if not isinstance(vendor, dict) or not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    now = _now_iso()
    updated = {
        **vendor,
        "email": email,
        "vendor_id": vendor.get("vendor_id") or email,
        "verified": True,
        "verification_status": "verified",
        "public_verification_status": "verified",
        "public_verification_label": "Verified",
        "review_status": "approved",
        "verified_at": vendor.get("verified_at") or now,
        "last_verified_at": vendor.get("last_verified_at") or now,
        "updated_at": now,
    }

    _upsert_profile_row(db, email=email, role="vendor", data=updated)
    updated = _load_vendor_from_db(db, email) or updated

    return {
        "ok": True,
        "email": email,
        "vendor": _vendor_public_payload(email, updated),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()

def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _safe_list_of_str(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        return [part.strip() for part in raw.split(",") if part.strip()]

    return []


def _first_category(categories: Any, fallback: Any = "") -> str:
    values = _safe_list_of_str(categories)
    if values:
        return values[0]
    return _safe_str(fallback)


def _user_vendor_key(user: Dict[str, Any]) -> str:
    email = _safe_str(user.get("email")).lower()
    user_id = _safe_str(user.get("sub") or user.get("id"))

    if email:
        return email

    if user_id:
        return f"user_{user_id}"

    raise HTTPException(status_code=400, detail="Unable to resolve vendor identity")


def _normalize_vendor_key(vendor_id: Any) -> str:
    vendor_key = _safe_str(vendor_id).lower()
    if not vendor_key:
        raise HTTPException(status_code=400, detail="Vendor id is required")
    return vendor_key


def _normalize_categories(payload: Dict[str, Any]) -> List[str]:
    categories = _safe_list_of_str(payload.get("categories"))

    if not categories:
        categories = _safe_list_of_str(payload.get("vendor_categories"))

    if not categories:
        category = (
            payload.get("category")
            or payload.get("vendor_category")
            or payload.get("businessCategory")
            or payload.get("business_category")
            or payload.get("businessType")
            or payload.get("business_type")
            or ""
        )
        categories = _safe_list_of_str(category)

    return categories


def _map_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    categories = _normalize_categories(payload)
    primary_category = _first_category(categories)

    mapped = {
        "business_name": payload.get("businessName", ""),
        "email": payload.get("email", ""),
        "phone": payload.get("phone", ""),
        "description": payload.get("description", ""),
        "categories": categories,
        "vendor_categories": categories,
        "category": primary_category,
        "vendor_category": primary_category,
        "business_category": primary_category,
        "business_type": primary_category,
        "website": payload.get("website", ""),
        "instagram": payload.get("instagram", ""),
        "facebook": payload.get("facebook", ""),
        "city": payload.get("city", ""),
        "state": payload.get("state", ""),
        "country": payload.get("country", ""),
        "zip": payload.get("zip", ""),
        "logo_url": payload.get("logoUrl", ""),
        "banner_url": payload.get("bannerUrl", ""),
        "image_urls": payload.get("imageUrls", []),
        "video_urls": payload.get("videoUrls", []),
        "contact_name": payload.get("contactName", ""),
        "updated_at": _now_iso(),
    }

    return mapped



def _profile_row_to_vendor(row: Profile) -> Dict[str, Any]:
    data = dict(row.data or {})
    email = _safe_str(row.email).lower()

    vendor = {
        **data,
        "email": email,
        "vendor_id": data.get("vendor_id") or email,
        "business_name": data.get("business_name") or data.get("businessName") or row.business_name or "",
        "businessName": data.get("businessName") or row.business_name or "",
        "contact_name": data.get("contact_name") or data.get("contactName") or row.display_name or "",
        "city": data.get("city") or row.city or "",
        "state": data.get("state") or row.state or "",
        "categories": data.get("categories") or row.categories or [],
        "vendor_categories": data.get("vendor_categories") or data.get("categories") or row.categories or [],
        "verified": bool(row.verified),
        "verification_status": row.verification_status or data.get("verification_status") or "",
        "verificationStatus": row.verification_status or data.get("verificationStatus") or "",
        "public_verification_status": row.public_verification_status or data.get("public_verification_status") or "",
        "public_verification_label": row.public_verification_label or data.get("public_verification_label") or "",
        "review_status": row.review_status or data.get("review_status") or "",
        "reviewStatus": row.review_status or data.get("reviewStatus") or "",
        "visibility_tier": row.visibility_tier or data.get("visibility_tier") or "",
        "visibilityTier": row.visibility_tier or data.get("visibilityTier") or "",
        "plan": data.get("plan") or row.subscription_plan or "",
        "subscription_plan": row.subscription_plan or data.get("subscription_plan") or data.get("subscriptionPlan") or "",
        "subscription_status": row.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus") or "",
        "featured": bool(row.featured),
        "promoted": bool(row.promoted),
    }
    return vendor


def _upsert_profile_row(db: Session, *, email: str, role: str, data: Dict[str, Any]) -> Profile:
    email = _safe_str(email or data.get("email")).lower()
    role = _safe_str(role).lower()
    if not email or role not in {"organizer", "vendor"}:
        raise ValueError("Valid email and role are required")

    row = (
        db.query(Profile)
        .filter(Profile.email == email, Profile.role == role)
        .one_or_none()
    )

    if row is None:
        row = Profile(email=email, role=role)
        db.add(row)

    name = _safe_str(
        data.get("business_name")
        or data.get("businessName")
        or data.get("organizationName")
        or data.get("name")
    )
    display_name = _safe_str(data.get("contact_name") or data.get("contactName") or name)
    categories = data.get("categories") or data.get("vendor_categories") or []
    if not isinstance(categories, list):
        categories = [str(categories)] if categories else []

    verified = bool(data.get("verified") is True or data.get("is_verified") is True)
    verification_status = _safe_str(
        data.get("verification_status")
        or data.get("verificationStatus")
        or data.get("public_verification_status")
    ).lower()
    review_status = _safe_str(data.get("review_status") or data.get("reviewStatus")).lower()

    if verification_status in {"approved", "complete"}:
        verification_status = "verified"
    if review_status in {"approved", "verified"}:
        verification_status = "verified"
        verified = True
    if verified and not verification_status:
        verification_status = "verified"

    public_status = _safe_str(data.get("public_verification_status")).lower()
    public_label = _safe_str(data.get("public_verification_label"))

    if verification_status in {"verified", "expiring_soon"}:
        public_status = "verified"
        public_label = public_label or "Verified"
        verified = True
    elif not public_status:
        public_status = "renewal_pending" if verification_status in {"pending", "renewal_pending"} else "not_verified"
        public_label = "Renewal pending" if public_status == "renewal_pending" else "Not verified"

    existing_data = dict(row.data or {})
    merged_data = {**existing_data, **dict(data or {}), "email": email, "vendor_id": data.get("vendor_id") or existing_data.get("vendor_id") or email}

    row.business_name = name or row.business_name
    row.display_name = display_name or row.display_name
    row.city = _safe_str(data.get("city")) or row.city
    row.state = _safe_str(data.get("state")) or row.state
    row.categories = categories or row.categories or []
    row.data = merged_data
    # Profile truth: incoming pending/rejected states must be able to clear stale
    # verified flags from earlier tests or verification cycles.
    explicit_unverified = verification_status in {"pending", "submitted", "under_review", "rejected", "not_started", "unverified"} or public_status in {"renewal_pending", "not_verified", "unverified"} or review_status in {"pending", "submitted", "under_review", "rejected", "not_started"}
    row.verified = bool(verified and not explicit_unverified)
    row.verification_status = verification_status or row.verification_status
    row.public_verification_status = public_status or row.public_verification_status
    row.public_verification_label = public_label or row.public_verification_label
    row.review_status = review_status or row.review_status

    incoming_visibility_tier = _safe_str(data.get("visibility_tier") or data.get("visibilityTier"))
    incoming_subscription_plan = _safe_str(data.get("subscription_plan") or data.get("subscriptionPlan") or data.get("plan"))
    incoming_subscription_status = _safe_str(data.get("subscription_status") or data.get("subscriptionStatus"))

    # Allow admin tools to CLEAR stale premium/subscription values.
    # The old `incoming or row.old` behavior made "Remove Premium" impossible
    # because empty/standard/inactive values were ignored and old premium flags
    # stayed in Postgres.
    if any(key in data for key in ("visibility_tier", "visibilityTier")):
        row.visibility_tier = incoming_visibility_tier or None
    else:
        row.visibility_tier = row.visibility_tier

    if any(key in data for key in ("subscription_plan", "subscriptionPlan", "plan")):
        row.subscription_plan = incoming_subscription_plan or None
    else:
        row.subscription_plan = row.subscription_plan

    if any(key in data for key in ("subscription_status", "subscriptionStatus")):
        row.subscription_status = incoming_subscription_status or None
    else:
        row.subscription_status = row.subscription_status

    if "featured" in data:
        row.featured = bool(data.get("featured"))
    if "promoted" in data:
        row.promoted = bool(data.get("promoted"))

    db.commit()
    db.refresh(row)
    return row


def _load_vendor_from_db(db: Session, email: str) -> Dict[str, Any] | None:
    email = _safe_str(email).lower()
    if not email:
        return None
    row = (
        db.query(Profile)
        .filter(Profile.email == email, Profile.role == "vendor")
        .one_or_none()
    )
    return _profile_row_to_vendor(row) if row else None


def _load_all_vendors_from_db(db: Session) -> Dict[str, Dict[str, Any]]:
    rows = db.query(Profile).filter(Profile.role == "vendor").all()
    return {
        _safe_str(row.email).lower(): _profile_row_to_vendor(row)
        for row in rows
        if _safe_str(row.email)
    }


def _is_internal_or_demo_identity(email: Any, name: Any = "") -> bool:
    normalized_email = _safe_str(email).lower()
    normalized_name = _safe_str(name).lower()

    if not normalized_email and not normalized_name:
        return True

    if normalized_email in {"admin@example.com", "test1", "test@example.com"}:
        return True

    if normalized_email.endswith("@example.com"):
        return True

    if normalized_name in {"admin", "test", "test1"}:
        return True

    return False


def _is_public_marketplace_visible(row: Dict[str, Any]) -> bool:
    """Publish real vendor profiles in the public marketplace.

    Premium and verified vendors still rank higher on the frontend, but standard
    vendors with a completed public profile should also appear in /vendors.
    Hidden/deleted/inactive/test/demo profiles are filtered before this helper.
    """
    public_status = _safe_str(row.get("public_verification_status")).lower()
    verification_status = _safe_str(row.get("verification_status") or row.get("status")).lower()
    review_status = _safe_str(row.get("review_status")).lower()
    visibility_tier = _safe_str(row.get("visibility_tier") or row.get("visibilityTier")).lower()
    plan = _safe_str(row.get("subscription_plan") or row.get("plan")).lower()
    subscription_status = _safe_str(row.get("subscription_status")).lower()

    blocked_statuses = {"deleted", "archived", "inactive", "removed", "hidden", "disabled", "suspended"}
    if public_status in blocked_statuses or verification_status in blocked_statuses or review_status in blocked_statuses:
        return False

    is_verified = (
        row.get("verified") is True
        or public_status == "verified"
        or verification_status in {"verified", "approved", "complete", "expiring_soon"}
        or review_status in {"approved", "verified"}
    )

    has_premium_plan = any(token in plan for token in ["enterprise", "premium", "pro", "growth"])
    is_active_subscription = subscription_status in {"active", "trialing", "paid"}
    is_premium = (
        (visibility_tier == "premium" and is_active_subscription)
        or ((bool(row.get("featured")) or bool(row.get("promoted"))) and is_active_subscription)
        or (has_premium_plan and is_active_subscription)
    )

    # Standard vendors should still appear when they have enough real public
    # profile content. The frontend sorts premium/verified above standard.
    profile_markers = [
        row.get("business_name") or row.get("businessName") or row.get("name"),
        row.get("description") or row.get("business_description") or row.get("businessDescription"),
        row.get("logo_url") or row.get("logoUrl") or row.get("logo_data_url") or row.get("logoDataUrl"),
        row.get("banner_url") or row.get("bannerUrl"),
        row.get("city"),
        row.get("state"),
    ]
    has_public_profile = bool(_safe_str(profile_markers[0])) and any(_safe_str(value) for value in profile_markers[1:])

    return bool(is_verified or is_premium or has_public_profile)


def _parse_datetime(value: Any) -> datetime | None:
    raw = _safe_str(value)
    if not raw:
        return None

    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def compute_verification_status(profile: Dict[str, Any], verification: Dict[str, Any] | None = None) -> str:
    """Return vendor verification status without treating payment as approval.

    Mirrors the organizer side's profile-truth approach: explicit pending/rejected
    statuses beat old verified booleans, and fee_paid/payment_status only affects
    payment display, never verification approval.
    """
    source = verification if isinstance(verification, dict) and verification else profile
    now = datetime.utcnow()

    public_status = _safe_lower(source.get("public_verification_status") or source.get("publicVerificationStatus"))
    review_status = _safe_lower(source.get("review_status") or source.get("reviewStatus"))
    explicit_status = _safe_lower(
        source.get("verification_status")
        or source.get("verificationStatus")
        or source.get("status")
    )

    if explicit_status in {"pending", "submitted", "under_review"} or review_status in {"pending", "submitted", "under_review"} or public_status == "renewal_pending":
        return "pending"
    if explicit_status == "rejected" or review_status == "rejected" or public_status in {"not_verified", "unverified"}:
        return "rejected" if explicit_status == "rejected" or review_status == "rejected" else "unverified"

    verified = (
        source.get("verified") is True
        or source.get("is_verified") is True
        or public_status == "verified"
        or explicit_status in {"verified", "approved", "complete", "expiring_soon"}
        or review_status in {"approved", "verified"}
    )

    if verified:
        exp_date = _parse_datetime(source.get("expiration_date") or source.get("expirationDate") or source.get("expires_at") or source.get("expiresAt"))
        if exp_date:
            if exp_date < now:
                return "expired"
            if exp_date - now <= timedelta(days=30):
                return "expiring_soon"
        documents = source.get("documents") or source.get("verification_documents") or source.get("verificationDocuments") or []
        if isinstance(documents, dict):
            documents = list(documents.values())
        if isinstance(documents, list):
            for doc in documents:
                if not isinstance(doc, dict):
                    continue
                doc_exp = _parse_datetime(doc.get("expiration_date") or doc.get("expirationDate") or doc.get("expires_at") or doc.get("expiresAt"))
                if not doc_exp:
                    continue
                if doc_exp < now:
                    return "expired"
                if doc_exp - now <= timedelta(days=30):
                    return "expiring_soon"
        return "verified"

    if explicit_status in {"expired", "expiring_soon"}:
        return explicit_status
    return "unverified"

def _get_vendor_or_404(vendor_id: Any) -> Dict[str, Any]:
    # Legacy _VENDORS is migration-only. Runtime public/vendor truth lives in
    # Postgres Profile rows, so callers that need a vendor should load it with
    # _load_vendor_from_db(db, email).
    raise HTTPException(status_code=404, detail="Vendor not found")



def _compute_marketplace_tier(vendor: Dict[str, Any], *, verified: bool) -> str:
    """Canonical marketplace placement.

    Verification and premium placement are separate states:
    - verified: trust status
    - premium_verified: admin-selected marketplace placement for a verified profile

    Do not infer premium placement from subscription_plan, Stripe status,
    featured/promoted leftovers, or legacy _VENDORS flags. Those fields caused
    verified-but-not-premium vendors to be promoted incorrectly.
    """
    if not verified:
        return "standard"

    explicit = _safe_lower(
        vendor.get("marketplace_tier")
        or vendor.get("marketplaceTier")
        or vendor.get("public_marketplace_tier")
        or vendor.get("publicMarketplaceTier")
    )
    if explicit in {"premium_verified", "premium", "featured"}:
        return "premium_verified"

    if vendor.get("premium_placement") is True or vendor.get("premiumPlacement") is True:
        return "premium_verified"

    if _safe_lower(vendor.get("visibility_tier") or vendor.get("visibilityTier")) == "premium" and (
        vendor.get("premium_active") is True
        or vendor.get("premiumActive") is True
    ):
        return "premium_verified"

    return "verified"

def _vendor_public_payload(vendor_key: str, vendor: Dict[str, Any]) -> Dict[str, Any]:
    categories = _safe_list_of_str(
        vendor.get("categories")
        or vendor.get("vendor_categories")
        or vendor.get("category")
        or vendor.get("vendor_category")
    )
    primary_category = _first_category(
        categories,
        vendor.get("category")
        or vendor.get("vendor_category")
        or vendor.get("business_category")
        or vendor.get("business_type")
        or "",
    )

    payload = {
        **vendor,
        "vendor_id": vendor_key,
        "categories": categories,
        "vendor_categories": categories,
        "category": primary_category,
        "vendor_category": primary_category,
        "business_category": primary_category,
        "business_type": primary_category,
    }
    # Profiles are the source of truth for public verification display.
    # Legacy store verification rows may still exist from early testing, but they
    # must not downgrade a verified Profile row to unverified/not submitted.
    # Document/renewal lifecycle data can still be attached below for display.
    verification = None
    try:
        legacy_record = (
            _find_latest_record(vendor.get("email") or vendor_key, "vendor")
            or find_latest_verification_by_email(vendor.get("email") or vendor_key, "vendor")
        )
        if isinstance(legacy_record, dict):
            legacy_status = _safe_lower(
                legacy_record.get("verification_status")
                or legacy_record.get("public_verification_status")
                or legacy_record.get("status")
            )
            profile_status = _safe_lower(
                vendor.get("verification_status")
                or vendor.get("public_verification_status")
                or vendor.get("review_status")
            )
            profile_verified = (
                vendor.get("verified") is True
                or profile_status in {"verified", "approved", "complete", "expiring_soon"}
            )
            # Only let legacy rows drive status when Profile has no verified
            # truth yet. This keeps old not_started/unpaid rows from overriding
            # an approved Profile.
            if not profile_verified or legacy_status in {"expired", "expiring_soon", "needs_review", "needs_renewal", "renewal_pending"}:
                verification = legacy_record
    except Exception:
        verification = None

    verification_status = compute_verification_status(vendor, verification)
    payload["verification_status"] = verification_status
    payload["public_verification_status"] = "verified" if verification_status in {"verified", "expiring_soon"} else verification_status
    payload["public_verification_label"] = "Verified" if verification_status in {"verified", "expiring_soon"} else payload.get("public_verification_label", "Not verified")
    payload["verified"] = verification_status in {"verified", "expiring_soon"}

    # Canonical marketplace tier. Do not derive premium placement from Stripe,
    # subscription_plan, or stale featured/promoted booleans.
    marketplace_tier = _compute_marketplace_tier(vendor, verified=bool(payload["verified"]))
    if marketplace_tier == "premium_verified":
        visibility_tier = "premium"
    elif marketplace_tier == "verified":
        visibility_tier = "verified"
    else:
        visibility_tier = "standard"

    payload["marketplace_tier"] = marketplace_tier
    payload["marketplaceTier"] = marketplace_tier
    payload["premium_placement"] = marketplace_tier == "premium_verified"
    payload["premiumPlacement"] = payload["premium_placement"]

    # Keep subscription fields for billing display only; they do not control public placement.
    plan = _safe_str(vendor.get("plan") or vendor.get("subscription_plan") or vendor.get("subscriptionPlan")).lower()
    subscription_status = _safe_str(vendor.get("subscription_status") or vendor.get("subscriptionStatus")).lower()
    payload["plan"] = plan
    payload["subscription_plan"] = plan
    payload["subscriptionPlan"] = plan
    payload["subscription_status"] = subscription_status
    payload["subscriptionStatus"] = subscription_status
    payload["visibility_tier"] = visibility_tier
    payload["visibilityTier"] = visibility_tier
    payload["featured"] = marketplace_tier == "premium_verified"
    payload["promoted"] = marketplace_tier == "premium_verified"

    if verification:
        payload["verification_id"] = verification.get("id")
        payload["expiration_date"] = verification.get("expiration_date")
        payload["documents"] = verification.get("documents", payload.get("documents", []))

    return payload


def _sync_vendor_category_to_applications(vendor_key: str, vendor: Dict[str, Any]) -> None:
    categories = _safe_list_of_str(vendor.get("categories") or vendor.get("vendor_categories"))
    primary_category = _first_category(categories, vendor.get("category") or vendor.get("vendor_category") or "")

    if not primary_category and not categories:
        return

    changed = False
    vendor_email = _safe_str(vendor.get("email") or vendor_key).lower()
    vendor_id = _safe_str(vendor.get("vendor_id") or vendor_key).lower()

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue

        app_vendor_email = _safe_str(app.get("vendor_email")).lower()
        app_vendor_id = _safe_str(app.get("vendor_id")).lower()

        if vendor_key not in {app_vendor_email, app_vendor_id} and vendor_email not in {app_vendor_email, app_vendor_id} and vendor_id not in {app_vendor_email, app_vendor_id}:
            continue

        if categories and not _safe_list_of_str(app.get("vendor_categories")):
            app["vendor_categories"] = categories
            changed = True

        if primary_category and not _safe_str(app.get("vendor_category")):
            app["vendor_category"] = primary_category
            changed = True

        if primary_category and not _safe_str(app.get("category")):
            app["category"] = primary_category
            changed = True

        app["updated_at"] = app.get("updated_at") or _now_iso()

    if changed:
        save_store()


def _reviews_for_vendor(vendor_id: Any) -> List[Dict[str, Any]]:
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor_reviews = _REVIEWS.get(vendor_key, {})
    if not isinstance(vendor_reviews, dict):
        return []

    reviews = [dict(review) for review in vendor_reviews.values() if isinstance(review, dict)]
    reviews.sort(
        key=lambda review: (
            str(review.get("created_at") or ""),
            int(review.get("id") or 0),
        ),
        reverse=True,
    )
    return reviews


def _review_summary(vendor_id: Any) -> Dict[str, Any]:
    reviews = _reviews_for_vendor(vendor_id)
    count = len(reviews)
    rating = round(
        sum(float(review.get("rating") or 0) for review in reviews) / count,
        2,
    ) if count else 0.0

    return {
        "reviews": reviews,
        "rating": rating,
        "review_count": count,
    }


def _can_organizer_review_vendor(vendor_key: str, user: Dict[str, Any]) -> bool:
    user_email = _safe_str(user.get("email")).lower()
    user_id = _safe_str(user.get("organizer_id") or user.get("id") or user.get("sub"))

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue

        app_vendor_email = _safe_str(app.get("vendor_email")).lower()
        app_vendor_id = _safe_str(app.get("vendor_id")).lower()

        if vendor_key not in {app_vendor_email, app_vendor_id}:
            continue

        if _safe_str(app.get("payment_status")).lower() != "paid":
            continue

        try:
            event_id = int(app.get("event_id") or 0)
        except Exception:
            continue

        event = _EVENTS.get(event_id)
        if not isinstance(event, dict):
            continue

        organizer_email = _safe_str(
            event.get("organizer_email") or event.get("owner_email") or event.get("email")
        ).lower()
        organizer_id = _safe_str(
            event.get("organizer_id") or event.get("owner_id") or event.get("created_by")
        )

        if user_email and organizer_email and user_email == organizer_email:
            return True

        if user_id and organizer_id and user_id == organizer_id:
            return True

    return False


class VendorProfileUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")

    businessName: str = ""
    email: str = ""
    phone: str = ""
    description: str = ""
    categories: List[str] = Field(default_factory=list)
    category: str = ""
    vendor_category: str = ""
    vendor_categories: List[str] = Field(default_factory=list)
    businessCategory: str = ""
    business_category: str = ""
    businessType: str = ""
    business_type: str = ""
    website: str = ""
    instagram: str = ""
    facebook: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip: str = ""
    logoUrl: str = ""
    bannerUrl: str = ""
    imageUrls: List[str] = Field(default_factory=list)
    videoUrls: List[str] = Field(default_factory=list)
    contactName: str = ""


class VendorReviewCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rating: int = Field(ge=1, le=5)
    comment: str = ""
    reviewer_name: str = ""
    reviewer_display_name: str = ""


@router.get("/me")
def get_my_vendor_profile(user: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)):
    key = _user_vendor_key(user)
    vendor = _load_vendor_from_db(db, key) or {}
    if not vendor:
        _upsert_profile_row(db, email=key, role="vendor", data={
            "vendor_id": key,
            "email": key,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "verification_status": "unverified",
            "public_verification_status": "not_verified",
            "public_verification_label": "Not verified",
            "visibility_tier": "standard",
            "subscription_plan": "starter",
            "subscription_status": "inactive",
        })
        vendor = _load_vendor_from_db(db, key) or {"vendor_id": key, "email": key}
    return _vendor_public_payload(key, vendor)


@router.post("/me")
def save_my_vendor_profile(
    payload: VendorProfileUpsert,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = _user_vendor_key(user)
    existing = _load_vendor_from_db(db, key) or {}
    mapped = _map_payload(payload.model_dump())

    updated = {**existing, **mapped}
    updated["vendor_id"] = key
    updated["email"] = key

    categories = _safe_list_of_str(updated.get("categories") or updated.get("vendor_categories"))
    primary_category = _first_category(categories, updated.get("category") or updated.get("vendor_category") or "")

    updated["categories"] = categories
    updated["vendor_categories"] = categories
    updated["category"] = primary_category
    updated["vendor_category"] = primary_category
    updated["business_category"] = primary_category
    updated["business_type"] = primary_category
    updated["updated_at"] = _now_iso()

    _upsert_profile_row(db, email=key, role="vendor", data=updated)
    updated = _load_vendor_from_db(db, key) or updated
    _sync_vendor_category_to_applications(key, updated)

    return _vendor_public_payload(key, updated)

@router.get("/by-email/{email}")
def get_vendor_profile_by_email(email: str, db: Session = Depends(get_db)):
    vendor_key = _normalize_vendor_key(email)
    vendor = _load_vendor_from_db(db, vendor_key)
    if not isinstance(vendor, dict) or not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _vendor_public_payload(vendor_key, vendor)


@router.get("/public/{vendor_id}")
def get_vendor_profile(vendor_id: str, db: Session = Depends(get_db)):
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _load_vendor_from_db(db, vendor_key)
    if not isinstance(vendor, dict) or not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _vendor_public_payload(vendor_key, vendor)


@router.get("/{vendor_id}/reviews")
def get_vendor_reviews(vendor_id: str, db: Session = Depends(get_db)):
    vendor_key = _normalize_vendor_key(vendor_id)
    if not _load_vendor_from_db(db, vendor_key):
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _review_summary(vendor_id)


@router.post("/{vendor_id}/reviews")
def create_vendor_review(
    vendor_id: str,
    payload: VendorReviewCreate,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vendor_key = _normalize_vendor_key(vendor_id)
    if not _load_vendor_from_db(db, vendor_key):
        raise HTTPException(status_code=404, detail="Vendor not found")

    reviewer_key = _user_vendor_key(user)
    if reviewer_key == vendor_key:
        raise HTTPException(status_code=400, detail="You cannot review your own vendor profile.")

    user_role = _safe_str(user.get("role")).lower()
    if user_role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Only organizers or admins can leave reviews.")

    if user_role != "admin" and not _can_organizer_review_vendor(vendor_key, user):
        raise HTTPException(
            status_code=403,
            detail="You can only review vendors after a completed (paid) event.",
        )

    vendor_reviews = _REVIEWS.setdefault(vendor_key, {})
    review_id = next_review_id(vendor_key)

    review = {
        "id": review_id,
        "vendor_id": vendor_key,
        "rating": int(payload.rating),
        "comment": _safe_str(payload.comment),
        "reviewer_name": _safe_str(payload.reviewer_name) or _safe_str(user.get("full_name")) or _safe_str(user.get("name")),
        "reviewer_display_name": _safe_str(payload.reviewer_display_name),
        "organizer_name": _safe_str(user.get("full_name")) or _safe_str(user.get("name")),
        "author_name": _safe_str(user.get("full_name")) or _safe_str(user.get("name")),
        "organizer_email": _safe_str(user.get("email")),
        "created_at": _now_iso(),
    }

    vendor_reviews[review_id] = review
    save_store()

    return {
        "ok": True,
        "review": review,
        **_review_summary(vendor_key),
    }

@router.post("/admin/backfill-categories")
def backfill_categories():
    updated = 0

    for app in _APPLICATIONS.values():
        vendor_email = (app.get("vendor_email") or "").lower()
        vendor = _VENDORS.get(vendor_email)

        if not vendor:
            continue

        categories = vendor.get("categories") or []
        primary = categories[0] if categories else ""

        if primary:
            if not app.get("vendor_category"):
                app["vendor_category"] = primary
                updated += 1

            if not app.get("vendor_categories"):
                app["vendor_categories"] = categories

            if not app.get("category"):
                app["category"] = primary

    save_store()

    return {"updated": updated}


@router.get("/admin/public-vendors-status")
def public_vendors_status(user: Dict[str, Any] = Depends(get_current_user)):
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    return {
        "ok": True,
        "count": len(_VENDORS),
        "vendor_keys": sorted([str(key) for key in _VENDORS.keys()]),
    }


@router.post("/admin/wipe-public-vendors")
def wipe_public_vendors(user: Dict[str, Any] = Depends(get_current_user)):
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    removed_count = len(_VENDORS)
    removed_keys = sorted([str(key) for key in _VENDORS.keys()])

    _VENDORS.clear()
    _REVIEWS.clear()
    save_store()

    return {
        "ok": True,
        "removed_count": removed_count,
        "removed_keys": removed_keys,
        "remaining_count": len(_VENDORS),
    }


@router.post("/admin/dedupe-public-vendors")
def dedupe_public_vendors(user: Dict[str, Any] = Depends(get_current_user)):
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    seen: Dict[str, str] = {}
    removed_keys: List[str] = []

    for vendor_key, vendor in list(_VENDORS.items()):
        key = str(vendor_key or "").strip().lower()
        if not key:
            removed_keys.append(str(vendor_key))
            _VENDORS.pop(vendor_key, None)
            continue

        if not isinstance(vendor, dict):
            removed_keys.append(key)
            _VENDORS.pop(vendor_key, None)
            _REVIEWS.pop(key, None)
            continue

        email_identity = _safe_str(vendor.get("email") or key).lower()
        business_identity = _safe_str(vendor.get("business_name") or vendor.get("businessName")).lower()
        phone_identity = _safe_str(vendor.get("phone")).lower()
        identity = email_identity or f"name:{business_identity}|phone:{phone_identity}"

        if identity in seen:
            keep_key = seen[identity]
            keep_vendor = _VENDORS.get(keep_key, {})

            current_score = len([v for v in vendor.values() if v not in (None, "", [], {})])
            keep_score = len([v for v in keep_vendor.values() if v not in (None, "", [], {})]) if isinstance(keep_vendor, dict) else 0
            current_updated = _safe_str(vendor.get("updated_at"))
            keep_updated = _safe_str(keep_vendor.get("updated_at")) if isinstance(keep_vendor, dict) else ""
            should_replace_keep = current_score > keep_score or (current_score == keep_score and current_updated > keep_updated)

            if should_replace_keep:
                _VENDORS[key] = vendor
                _VENDORS.pop(keep_key, None)
                if keep_key in _REVIEWS and key not in _REVIEWS:
                    _REVIEWS[key] = _REVIEWS.pop(keep_key)
                else:
                    _REVIEWS.pop(keep_key, None)
                seen[identity] = key
                removed_keys.append(keep_key)
            else:
                _VENDORS.pop(vendor_key, None)
                _REVIEWS.pop(key, None)
                removed_keys.append(key)
        else:
            normalized_key = email_identity or key
            if normalized_key != key:
                _VENDORS[normalized_key] = vendor
                _VENDORS.pop(vendor_key, None)
                if key in _REVIEWS and normalized_key not in _REVIEWS:
                    _REVIEWS[normalized_key] = _REVIEWS.pop(key)
                seen[identity] = normalized_key
            else:
                seen[identity] = key

    save_store()

    return {
        "ok": True,
        "removed_count": len(removed_keys),
        "removed_keys": removed_keys,
        "remaining_count": len(_VENDORS),
    }

@router.get("/public")
def get_public_vendors(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    results = []
    vendors = _load_all_vendors_from_db(db)

    hidden_statuses = {
        "deleted",
        "archived",
        "inactive",
        "removed",
        "hidden",
        "disabled",
        "suspended",
    }

    for vendor_key, vendor in vendors.items():
        if not isinstance(vendor, dict):
            continue

        status_values = {
            _safe_str(vendor.get("verification_status")).lower(),
            _safe_str(vendor.get("public_verification_status")).lower(),
            _safe_str(vendor.get("status")).lower(),
            _safe_str(vendor.get("review_status")).lower(),
            _safe_str(vendor.get("account_status")).lower(),
            _safe_str(vendor.get("visibility_status")).lower(),
        }

        if status_values.intersection(hidden_statuses):
            continue

        if (
            vendor.get("deleted") is True
            or vendor.get("is_deleted") is True
            or vendor.get("archived") is True
            or vendor.get("hidden") is True
            or vendor.get("is_active") is False
        ):
            continue

        payload = _vendor_public_payload(vendor_key, vendor)

        # Only show vendors with enough real public profile data AND earned marketplace visibility.
        # Auto-created signup shells, standard pending users, deleted profiles, and demo/test accounts stay hidden.
        if (
            _safe_str(payload.get("business_name"))
            and not _is_internal_or_demo_identity(payload.get("email") or vendor_key, payload.get("business_name"))
            and _is_public_marketplace_visible(payload)
        ):
            results.append(payload)

    tier_rank = {"premium": 0, "verified": 1, "standard": 2}
    results.sort(
        key=lambda item: (
            tier_rank.get(_safe_str(item.get("visibility_tier") or item.get("visibilityTier")).lower(), 2),
            not bool(item.get("verified")),
            _safe_str(item.get("business_name") or item.get("email")).lower(),
        )
    )
    return _vendor_page_payload(results, limit, offset)


@router.post("/admin/migrate-profiles-to-db")
def migrate_vendor_profiles_to_db(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    migrated = 0

    for vendor_key, vendor in _VENDORS.items():
        if not isinstance(vendor, dict):
            continue
        email = _safe_str(vendor.get("email") or vendor_key).lower()
        if not email:
            continue
        vendor["email"] = email
        vendor["vendor_id"] = vendor.get("vendor_id") or email
        _upsert_profile_row(db, email=email, role="vendor", data=vendor)
        migrated += 1

    return {"ok": True, "migrated": migrated}

@router.post("/debug/seed-vendors")
def seed_vendors():
    # Debug-only seed. Do not overwrite real or existing vendor data.
    if "test1" not in _VENDORS:
        upsert_vendor("test1", {
            "vendor_id": "test1",
            "email": "test1",
            "business_name": "Atlanta Food Truck Co",
            "city": "Atlanta",
            "state": "GA",
            "categories": ["Food"],
            "description": "Top rated street food vendor",
            "verified": True,
            "public_verification_status": "verified",
            "rating": 4.8,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })

    return {"ok": True, "seeded": "test1", "count": len(_VENDORS)}
