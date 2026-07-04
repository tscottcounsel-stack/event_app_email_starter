from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile

router = APIRouter(tags=["Public Safe Vendor Responses"])

DEFAULT_PAGE_LIMIT = 24
MAX_PAGE_LIMIT = 100

BLOCKED_PUBLIC_TOKENS = (
    "verification-documents",
    "verification_documents",
    "/verification/",
    "verification_document",
    "identity_verification",
    "government_id",
    "certificate_of_insurance",
    "insurance_certificate",
    "business_license",
    "sales_tax_permit",
    "w9_document",
    "s3.amazonaws.com",
    "amazonaws.com",
    "presigned",
    "x-amz-",
    "signed_url",
    "view-url",
)

PUBLIC_HIDDEN_STATUSES = {
    "deleted",
    "archived",
    "inactive",
    "removed",
    "hidden",
    "disabled",
    "suspended",
}


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _safe_lower(value) in {"1", "true", "yes", "y", "on", "verified", "approved", "active", "paid"}


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


def _safe_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [_safe_str(item) for item in value if _safe_str(item)]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _is_blocked_public_url(value: Any) -> bool:
    raw = _safe_lower(value)
    if not raw:
        return False
    return any(token in raw for token in BLOCKED_PUBLIC_TOKENS)


def _safe_public_url(value: Any) -> str:
    raw = _safe_str(value)
    if not raw or _is_blocked_public_url(raw):
        return ""
    return raw


def _safe_public_media_list(value: Any) -> List[str]:
    urls: List[str] = []

    if isinstance(value, str):
        candidate = _safe_public_url(value)
        return [candidate] if candidate else []

    if not isinstance(value, list):
        return []

    for item in value[:24]:
        candidate = ""
        if isinstance(item, str):
            candidate = _safe_public_url(item)
        elif isinstance(item, dict):
            candidate = _safe_public_url(
                item.get("url")
                or item.get("secure_url")
                or item.get("src")
                or item.get("image_url")
                or item.get("imageUrl")
                or item.get("video_url")
                or item.get("videoUrl")
            )
        if candidate and candidate not in urls:
            urls.append(candidate)

    return urls


def _first_public_media(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            found = _safe_public_url(value)
            if found:
                return found
        elif isinstance(value, list):
            found_list = _safe_public_media_list(value)
            if found_list:
                return found_list[0]
        elif isinstance(value, dict):
            found = _safe_public_url(
                value.get("url")
                or value.get("secure_url")
                or value.get("src")
                or value.get("image_url")
                or value.get("imageUrl")
            )
            if found:
                return found
    return ""


def _profile_data(row: Profile) -> Dict[str, Any]:
    return dict(row.data or {}) if isinstance(row.data, dict) else {}


def _categories(row: Profile, data: Dict[str, Any]) -> List[str]:
    values = _safe_list(data.get("categories") or data.get("vendor_categories") or data.get("category") or data.get("vendor_category"))
    if not values and isinstance(row.categories, list):
        values = _safe_list(row.categories)
    return values[:12]


def _is_verified(row: Profile, data: Dict[str, Any]) -> bool:
    status = _safe_lower(row.verification_status or data.get("verification_status") or data.get("verificationStatus"))
    public_status = _safe_lower(row.public_verification_status or data.get("public_verification_status") or data.get("publicVerificationStatus"))
    review_status = _safe_lower(row.review_status or data.get("review_status") or data.get("reviewStatus"))
    return bool(row.verified or data.get("verified") is True or data.get("is_verified") is True or status in {"verified", "approved", "complete", "expiring_soon"} or public_status == "verified" or review_status in {"approved", "verified"})


def _marketplace_state(row: Profile, data: Dict[str, Any], verified: bool) -> Dict[str, Any]:
    raw_visibility = _safe_lower(row.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier"))
    raw_plan = _safe_lower(row.subscription_plan or data.get("subscription_plan") or data.get("subscriptionPlan") or data.get("plan"))
    raw_subscription_status = _safe_lower(row.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus"))
    active_subscription = raw_subscription_status in {"active", "trialing", "paid"}
    premium_plan = any(token in raw_plan for token in ("premium", "pro", "growth", "enterprise"))
    premium = bool((raw_visibility == "premium" and active_subscription) or (premium_plan and active_subscription) or ((row.featured or row.promoted or data.get("featured") is True or data.get("promoted") is True) and active_subscription))

    if premium:
        tier = "premium"
    elif verified:
        tier = "verified"
    else:
        tier = "standard"

    label = row.public_verification_label or data.get("public_verification_label") or data.get("publicVerificationLabel") or ("Verified" if verified else "Not verified")

    return {
        "verified": verified,
        "is_verified": verified,
        "verification_status": "verified" if verified else "unverified",
        "verificationStatus": "verified" if verified else "unverified",
        "public_verification_status": "verified" if verified else "not_verified",
        "publicVerificationStatus": "verified" if verified else "not_verified",
        "public_verification_label": label,
        "publicVerificationLabel": label,
        "visibility_tier": tier,
        "visibilityTier": tier,
        "marketplace_tier": "premium_verified" if premium and verified else tier,
        "marketplaceTier": "premium_verified" if premium and verified else tier,
        "premium_placement": premium,
        "premiumPlacement": premium,
        "featured": premium,
        "promoted": premium,
    }


def _public_profile_payload(row: Profile) -> Dict[str, Any]:
    data = _profile_data(row)
    email = _safe_lower(row.email or data.get("email"))
    categories = _categories(row, data)
    business_name = _safe_str(
        row.business_name
        or data.get("business_name")
        or data.get("businessName")
        or data.get("company_name")
        or data.get("companyName")
        or data.get("name")
        or email
    )
    display_name = _safe_str(row.display_name or data.get("display_name") or data.get("displayName") or business_name)

    logo_url = _first_public_media(
        data.get("logo_url"),
        data.get("logoUrl"),
        data.get("logo_data_url"),
        data.get("logoDataUrl"),
        data.get("profile_image_url"),
        data.get("profileImageUrl"),
        data.get("avatar_url"),
        data.get("avatarUrl"),
        data.get("logo"),
        data.get("avatar"),
    )
    banner_url = _first_public_media(data.get("banner_url"), data.get("bannerUrl"), data.get("cover_url"), data.get("coverUrl"))
    image_urls = _safe_public_media_list(data.get("image_urls") or data.get("imageUrls") or data.get("images") or data.get("gallery") or [])
    video_urls = _safe_public_media_list(data.get("video_urls") or data.get("videoUrls") or data.get("videos") or [])

    verified = _is_verified(row, data)
    state = _marketplace_state(row, data, verified)

    payload = {
        "id": row.id,
        "vendor_id": email,
        "vendorId": email,
        "email": email,
        "role": "vendor",
        "name": business_name or display_name,
        "business_name": business_name,
        "businessName": business_name,
        "display_name": display_name,
        "displayName": display_name,
        "description": _safe_str(data.get("description") or data.get("business_description") or data.get("businessDescription")),
        "city": _safe_str(row.city or data.get("city")),
        "state": _safe_str(row.state or data.get("state")),
        "country": _safe_str(data.get("country") or "United States"),
        "zip": _safe_str(data.get("zip") or data.get("postal_code") or data.get("postalCode")),
        "phone": _safe_str(data.get("phone") or data.get("business_phone") or data.get("businessPhone") or data.get("contact_phone") or data.get("contactPhone")),
        "website": _safe_public_url(data.get("website")),
        "instagram": _safe_str(data.get("instagram")),
        "facebook": _safe_str(data.get("facebook")),
        "tiktok": _safe_str(data.get("tiktok")),
        "youtube": _safe_str(data.get("youtube")),
        "categories": categories,
        "vendor_categories": categories,
        "category": categories[0] if categories else _safe_str(data.get("category") or data.get("vendor_category") or data.get("business_type") or data.get("businessType")),
        "vendor_category": categories[0] if categories else _safe_str(data.get("vendor_category") or data.get("category") or data.get("business_type") or data.get("businessType")),
        "business_category": categories[0] if categories else _safe_str(data.get("business_category") or data.get("businessCategory") or data.get("category")),
        "business_type": categories[0] if categories else _safe_str(data.get("business_type") or data.get("businessType") or data.get("category")),
        "logo_url": logo_url,
        "logoUrl": logo_url,
        "banner_url": banner_url,
        "bannerUrl": banner_url,
        "image_urls": image_urls,
        "imageUrls": image_urls,
        "video_urls": video_urls,
        "videoUrls": video_urls,
        "offerings": [],
        "vendor_offerings": [],
        "menuUploads": [],
        "menu_uploads": [],
        **state,
    }

    # Defense-in-depth: never allow these keys in public responses.
    for private_key in (
        "documents",
        "document",
        "verification_id",
        "verificationId",
        "expiration_date",
        "expirationDate",
        "expires_at",
        "expiresAt",
        "uploaded_at",
        "uploadedAt",
        "signed_url",
        "signedUrl",
        "file_url",
        "fileUrl",
        "s3_key",
        "storage_key",
        "review_status",
        "reviewStatus",
        "subscription_plan",
        "subscriptionPlan",
        "subscription_status",
        "subscriptionStatus",
        "profile_complete",
        "profileComplete",
        "profile_complete_percent",
        "profileCompletePercent",
        "fee_paid",
        "payment_status",
        "stripe_session_id",
        "stripe_payment_intent_id",
        "tax_id",
        "tax_id_masked",
        "notes",
        "admin_notes",
    ):
        payload.pop(private_key, None)

    return payload


def _is_public_visible(payload: Dict[str, Any]) -> bool:
    if not _safe_str(payload.get("business_name") or payload.get("businessName") or payload.get("name")):
        return False
    if payload.get("verified") is True or payload.get("premium_placement") is True:
        return True
    return bool(
        _safe_str(payload.get("description"))
        or _safe_str(payload.get("logo_url") or payload.get("logoUrl"))
        or _safe_str(payload.get("city"))
        or _safe_str(payload.get("state"))
    )


def _profile_query(db: Session):
    return (
        db.query(Profile)
        .filter(Profile.role == "vendor")
        .filter(or_(Profile.verification_status.is_(None), func.lower(Profile.verification_status) != "deleted"))
    )


@router.get("/vendors/public")
def get_safe_public_vendors(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = _profile_query(db).all()
    results: List[Dict[str, Any]] = []

    for row in rows:
        data = _profile_data(row)
        status_values = {
            _safe_lower(row.verification_status),
            _safe_lower(row.public_verification_status),
            _safe_lower(row.review_status),
            _safe_lower(data.get("status")),
            _safe_lower(data.get("account_status")),
            _safe_lower(data.get("visibility_status")),
        }
        if status_values.intersection(PUBLIC_HIDDEN_STATUSES):
            continue
        if data.get("deleted") is True or data.get("is_deleted") is True or data.get("archived") is True or data.get("hidden") is True or data.get("is_active") is False:
            continue

        payload = _public_profile_payload(row)
        if _is_public_visible(payload):
            results.append(payload)

    tier_rank = {"premium_verified": 0, "premium": 0, "verified": 1, "standard": 2}
    results.sort(key=lambda item: (tier_rank.get(_safe_lower(item.get("marketplace_tier") or item.get("visibility_tier")), 2), _safe_str(item.get("business_name") or item.get("email")).lower()))

    safe_limit = _page_limit(limit)
    safe_offset = _page_offset(offset)
    page = results[safe_offset:safe_offset + safe_limit]
    return {
        "vendors": page,
        "items": page,
        "count": len(page),
        "total": len(results),
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + safe_limit < len(results),
    }


def _load_vendor_by_key(db: Session, vendor_id: str) -> Optional[Profile]:
    key = _safe_lower(vendor_id)
    if not key:
        return None
    return (
        db.query(Profile)
        .filter(Profile.role == "vendor")
        .filter(func.lower(Profile.email) == key)
        .filter(or_(Profile.verification_status.is_(None), func.lower(Profile.verification_status) != "deleted"))
        .order_by(Profile.id.desc())
        .first()
    )


@router.get("/vendors/public/{vendor_id}")
def get_safe_public_vendor_profile(vendor_id: str, db: Session = Depends(get_db)):
    row = _load_vendor_by_key(db, vendor_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _public_profile_payload(row)


@router.get("/vendors/by-email/{email}")
def get_safe_public_vendor_by_email(email: str, db: Session = Depends(get_db)):
    row = _load_vendor_by_key(db, email)
    if row is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _public_profile_payload(row)


def _public_doc_summaries(db: Session, *, email: str, role: str, profile_id: Any = None) -> List[Dict[str, Any]]:
    docs: List[Dict[str, Any]] = []
    try:
        clauses = ["(lower(owner_email) = :email AND lower(owner_role) = :role)"]
        params: Dict[str, Any] = {"email": _safe_lower(email), "role": _safe_lower(role), "limit": 50}
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
        seen: set[str] = set()
        for row in rows:
            label = _safe_str(row.get("label") or row.get("document_name") or row.get("display_name") or row.get("name") or row.get("requirement_name") or row.get("document_type") or "Reviewed document")
            doc_type = _safe_str(row.get("document_type") or row.get("type") or row.get("category") or "Document")
            status = _safe_str(row.get("public_status") or row.get("review_status") or row.get("status") or "Reviewed")
            key = f"{label}|{doc_type}".lower()
            if key in seen:
                continue
            seen.add(key)
            docs.append({
                "label": label or "Reviewed document",
                "name": label or "Reviewed document",
                "type": doc_type or "Document",
                "status": status or "Reviewed",
                "reviewed": _safe_lower(status) not in {"pending", "rejected", "missing"},
            })
    except Exception:
        return []
    return docs


@router.get("/verification/public/{role}/{email}")
def get_safe_public_verification(role: str, email: str, db: Session = Depends(get_db)):
    normalized_role = _safe_lower(role)
    normalized_email = _safe_lower(email)
    if normalized_role not in {"vendor", "organizer"} or not normalized_email:
        raise HTTPException(status_code=404, detail="Not Found")

    row = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == normalized_email, Profile.role == normalized_role)
        .filter(or_(Profile.verification_status.is_(None), func.lower(Profile.verification_status) != "deleted"))
        .order_by(Profile.id.desc())
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Not Found")

    if normalized_role == "vendor":
        profile = _public_profile_payload(row)
    else:
        data = _profile_data(row)
        verified = _is_verified(row, data)
        name = _safe_str(row.business_name or row.display_name or data.get("organizationName") or data.get("businessName") or data.get("name") or normalized_email)
        logo_url = _first_public_media(data.get("logo_url"), data.get("logoUrl"), data.get("logo"), data.get("avatar"))
        profile = {
            "id": row.id,
            "email": normalized_email,
            "role": normalized_role,
            "name": name,
            "business_name": name,
            "businessName": name,
            "display_name": _safe_str(row.display_name or name),
            "displayName": _safe_str(row.display_name or name),
            "city": _safe_str(row.city or data.get("city")),
            "state": _safe_str(row.state or data.get("state")),
            "country": _safe_str(data.get("country") or "United States"),
            "phone": _safe_str(data.get("phone") or data.get("contact_phone") or data.get("contactPhone")),
            "logo_url": logo_url,
            "logoUrl": logo_url,
            "verified": verified,
            "is_verified": verified,
            "verification_status": "verified" if verified else "unverified",
            "verificationStatus": "verified" if verified else "unverified",
            "public_verification_status": "verified" if verified else "not_verified",
            "publicVerificationStatus": "verified" if verified else "not_verified",
            "public_verification_label": row.public_verification_label or ("Verified Organizer" if verified else "Not verified"),
            "publicVerificationLabel": row.public_verification_label or ("Verified Organizer" if verified else "Not verified"),
        }

    docs = _public_doc_summaries(db, email=normalized_email, role=normalized_role, profile_id=getattr(row, "id", None))
    profile["documents"] = docs

    verification = {
        "status": profile.get("verification_status"),
        "verification_status": profile.get("verification_status"),
        "public_verification_status": profile.get("public_verification_status"),
        "public_verification_label": profile.get("public_verification_label"),
        "documents": docs,
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
        "documents": docs,
    }


@router.get("/verification/public/{email}")
def get_safe_public_vendor_verification_by_email(email: str, db: Session = Depends(get_db)):
    return get_safe_public_verification("vendor", email, db)
