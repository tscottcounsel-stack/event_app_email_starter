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




def _normalize_vendor_offerings(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw[:60]):
        if not isinstance(item, dict):
            continue

        name = _safe_str(item.get("name") or item.get("title") or item.get("itemName"))
        category = _safe_str(item.get("category") or item.get("type"))
        description = _safe_str(item.get("description") or item.get("body"))
        if not name and not category and not description:
            continue

        tags_raw = item.get("tags")
        tags = _safe_list_of_str(tags_raw) if not isinstance(tags_raw, str) else _safe_list_of_str(tags_raw)
        is_featured = _coerce_bool(item.get("isFeatured", item.get("is_featured", idx < 3)), idx < 3)
        is_available = _coerce_bool(item.get("isAvailable", item.get("is_available", True)), True)

        try:
            sort_order = int(item.get("sortOrder", item.get("sort_order", idx)))
        except Exception:
            sort_order = idx

        offering = {
            "id": _safe_str(item.get("id")) or f"offering_{idx + 1}",
            "name": name or "Untitled offering",
            "category": category,
            "description": description,
            "priceDisplay": _safe_str(item.get("priceDisplay") or item.get("price_display") or item.get("price") or item.get("priceRange")),
            "price_display": _safe_str(item.get("priceDisplay") or item.get("price_display") or item.get("price") or item.get("priceRange")),
            "imageUrl": _safe_str(item.get("imageUrl") or item.get("image_url") or item.get("photoUrl") or item.get("url")),
            "image_url": _safe_str(item.get("imageUrl") or item.get("image_url") or item.get("photoUrl") or item.get("url")),
            "tags": tags[:12],
            "isFeatured": is_featured,
            "is_featured": is_featured,
            "isAvailable": is_available,
            "is_available": is_available,
            "sortOrder": sort_order,
            "sort_order": sort_order,
        }
        normalized.append(offering)

    normalized.sort(key=lambda item: int(item.get("sortOrder") or item.get("sort_order") or 0))
    return normalized


def _normalize_vendor_menu_uploads(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw[:12]):
        if not isinstance(item, dict):
            continue

        url = _safe_str(item.get("url") or item.get("href") or item.get("secure_url"))
        if not url:
            continue

        title = _safe_str(item.get("title") or item.get("name")) or f"Menu / product list {idx + 1}"
        file_type = _safe_str(item.get("fileType") or item.get("file_type") or item.get("type"))
        uploaded_at = _safe_str(item.get("uploadedAt") or item.get("uploaded_at")) or _now_iso()

        normalized.append({
            "id": _safe_str(item.get("id")) or f"menu_{idx + 1}",
            "title": title,
            "url": url,
            "fileType": file_type,
            "file_type": file_type,
            "description": _safe_str(item.get("description") or item.get("note")),
            "uploadedAt": uploaded_at,
            "uploaded_at": uploaded_at,
        })

    return normalized



def _normalize_video_urls(*values: Any) -> List[str]:
    urls: List[str] = []
    for value in values:
        if isinstance(value, list):
            urls.extend([_safe_str(item) for item in value if _safe_str(item)])
        elif isinstance(value, str):
            raw = value.strip()
            if not raw:
                continue
            if "," in raw:
                urls.extend([part.strip() for part in raw.split(",") if part.strip()])
            else:
                urls.append(raw)

    seen = set()
    clean: List[str] = []
    for url in urls:
        key = url.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        clean.append(url)
    return clean[:6]

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
    offerings = _normalize_vendor_offerings(payload.get("offerings") or payload.get("vendor_offerings") or [])
    menu_uploads = _normalize_vendor_menu_uploads(payload.get("menuUploads") or payload.get("menu_uploads") or [])

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
        "tiktok": payload.get("tiktok", ""),
        "youtube": payload.get("youtube", ""),
        "city": payload.get("city", ""),
        "state": payload.get("state", ""),
        "country": payload.get("country", ""),
        "zip": payload.get("zip", ""),
        "logo_url": payload.get("logoUrl", ""),
        "banner_url": payload.get("bannerUrl", ""),
        "image_urls": payload.get("imageUrls", []),
        "video_urls": _normalize_video_urls(payload.get("videoUrls"), payload.get("video_urls"), payload.get("videos")),
        "videoUrls": _normalize_video_urls(payload.get("videoUrls"), payload.get("video_urls"), payload.get("videos")),
        "offerings": offerings,
        "vendor_offerings": offerings,
        "menuUploads": menu_uploads,
        "menu_uploads": menu_uploads,
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
        "offerings": _normalize_vendor_offerings(data.get("offerings") or data.get("vendor_offerings") or []),
        "vendor_offerings": _normalize_vendor_offerings(data.get("offerings") or data.get("vendor_offerings") or []),
        "menuUploads": _normalize_vendor_menu_uploads(data.get("menuUploads") or data.get("menu_uploads") or []),
        "menu_uploads": _normalize_vendor_menu_uploads(data.get("menuUploads") or data.get("menu_uploads") or []),
        "video_urls": _normalize_video_urls(data.get("video_urls"), data.get("videoUrls"), data.get("videos")),
        "videoUrls": _normalize_video_urls(data.get("video_urls"), data.get("videoUrls"), data.get("videos")),
        "videos": _normalize_video_urls(data.get("video_urls"), data.get("videoUrls"), data.get("videos")),
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





def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    raw = _safe_str(value).lower()
    if raw in {"1", "true", "yes", "y", "on", "published", "public"}:
        return True
    if raw in {"0", "false", "no", "n", "off", "hidden", "private"}:
        return False
    return default


def _normalize_external_events(raw: Any, *, include_unpublished: bool = False) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue

        title = _safe_str(item.get("title") or item.get("name") or item.get("event_name") or item.get("eventName"))
        if not title:
            continue

        published = _coerce_bool(item.get("published"), True)
        if not include_unpublished and not published:
            continue

        event_id = _safe_str(item.get("id") or item.get("external_event_id") or item.get("externalEventId"))
        if not event_id:
            event_id = f"external_{idx + 1}"

        normalized.append({
            "id": event_id,
            "source": "external",
            "source_label": "Listed by vendor",
            "title": title[:140],
            "start_date": _safe_str(item.get("start_date") or item.get("startDate") or item.get("starts_at") or item.get("startsAt")),
            "end_date": _safe_str(item.get("end_date") or item.get("endDate") or item.get("ends_at") or item.get("endsAt")),
            "venue_name": _safe_str(item.get("venue_name") or item.get("venueName") or item.get("venue")),
            "city": _safe_str(item.get("city")),
            "state": _safe_str(item.get("state")),
            "booth_note": _safe_str(item.get("booth_note") or item.get("boothNote") or item.get("booth") or item.get("location_note") or item.get("locationNote")),
            "event_url": _safe_str(item.get("event_url") or item.get("eventUrl") or item.get("website") or item.get("url")),
            "maps_url": _safe_str(item.get("maps_url") or item.get("mapsUrl") or item.get("google_maps_url") or item.get("googleMapsUrl")),
            "published": published,
        })

    normalized.sort(
        key=lambda item: (_parse_datetime(item.get("start_date")) or datetime.max, _safe_str(item.get("title")).lower())
    )
    return normalized


def _event_lookup(event_id: Any) -> Dict[str, Any] | None:
    if event_id is None:
        return None

    candidates: List[Any] = [event_id, _safe_str(event_id)]
    try:
        candidates.append(int(event_id))
    except Exception:
        pass

    for key in candidates:
        event = _EVENTS.get(key) if hasattr(_EVENTS, "get") else None
        if isinstance(event, dict):
            return event
    return None


def _vendor_vendcore_events(vendor_key: str) -> List[Dict[str, Any]]:
    vendor_key = _safe_str(vendor_key).lower()
    if not vendor_key:
        return []

    now = datetime.utcnow() - timedelta(hours=12)
    rows: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue

        app_vendor_email = _safe_str(app.get("vendor_email") or app.get("email")).lower()
        app_vendor_id = _safe_str(app.get("vendor_id") or app.get("vendorId")).lower()
        if vendor_key not in {app_vendor_email, app_vendor_id}:
            continue

        app_status = _safe_lower(app.get("status") or app.get("application_status") or app.get("applicationStatus"))
        payment_status = _safe_lower(app.get("payment_status") or app.get("paymentStatus"))
        if (
            app_status not in {"approved", "paid", "complete", "completed", "accepted"}
            and payment_status not in {"paid", "complete", "completed", "succeeded"}
        ):
            continue

        event_id = app.get("event_id") or app.get("eventId")
        event = _event_lookup(event_id)
        if not isinstance(event, dict):
            continue

        if event.get("archived") is True or event.get("deleted") is True:
            continue
        if event.get("published") is False:
            continue

        start_raw = _safe_str(event.get("start_date") or event.get("startDate") or event.get("start_datetime") or event.get("startDatetime"))
        end_raw = _safe_str(event.get("end_date") or event.get("endDate") or event.get("end_datetime") or event.get("endDatetime"))
        parsed_start = _parse_datetime(start_raw)
        parsed_end = _parse_datetime(end_raw) or parsed_start
        if parsed_end and parsed_end < now:
            continue

        key = f"vendcore:{event_id}:{app.get('id') or app.get('application_id') or app.get('applicationId') or ''}"
        if key in seen:
            continue
        seen.add(key)

        rows.append({
            "id": key,
            "source": "vendcore",
            "source_label": "VendCore event",
            "event_id": event_id,
            "application_id": app.get("id") or app.get("application_id") or app.get("applicationId"),
            "title": _safe_str(event.get("title") or event.get("name") or f"Event {event_id}"),
            "start_date": start_raw,
            "end_date": end_raw,
            "venue_name": _safe_str(event.get("venue_name") or event.get("venueName") or event.get("venue")),
            "city": _safe_str(event.get("city")),
            "state": _safe_str(event.get("state")),
            "booth_note": _safe_str(app.get("booth_id") or app.get("boothId") or app.get("booth_number") or app.get("boothNumber") or app.get("requested_booth_id")),
            "event_url": f"/events/{event_id}" if event_id not in (None, "") else "",
            "maps_url": _safe_str(event.get("google_maps_url") or event.get("googleMapsUrl") or event.get("googleMapsLink")),
            "published": True,
        })

    rows.sort(key=lambda item: (_parse_datetime(item.get("start_date")) or datetime.max, _safe_str(item.get("title")).lower()))
    return rows


def _external_events_from_vendor(vendor: Dict[str, Any], *, include_unpublished: bool = False) -> List[Dict[str, Any]]:
    raw_external = (
        vendor.get("external_events")
        or vendor.get("externalEvents")
        or []
    )
    return _normalize_external_events(raw_external, include_unpublished=include_unpublished)


def _vendor_schedule(vendor_key: str, vendor: Dict[str, Any], *, include_unpublished_external: bool = False) -> List[Dict[str, Any]]:
    external_events = _external_events_from_vendor(vendor, include_unpublished=include_unpublished_external)
    if include_unpublished_external:
        return external_events

    merged = [*_vendor_vendcore_events(vendor_key), *external_events]
    merged.sort(key=lambda item: (_parse_datetime(item.get("start_date")) or datetime.max, _safe_str(item.get("title")).lower()))
    return merged[:24]


def _vendor_payload_with_schedule(vendor_key: str, vendor: Dict[str, Any]) -> Dict[str, Any]:
    # Important: keep directory listing logic safe. The /vendors/public directory
    # still uses _vendor_public_payload directly. This wrapper is only for
    # individual vendor profile responses.
    payload = _vendor_public_payload(vendor_key, vendor)
    try:
        external_events = _external_events_from_vendor(vendor, include_unpublished=False)
        vendcore_events = _vendor_vendcore_events(vendor_key)
        upcoming_events = _vendor_schedule(vendor_key, vendor, include_unpublished_external=False)
    except Exception:
        external_events = []
        vendcore_events = []
        upcoming_events = []

    payload["external_events"] = external_events
    payload["externalEvents"] = external_events
    payload["vendcore_events"] = vendcore_events
    payload["vendcoreEvents"] = vendcore_events
    payload["upcoming_events"] = upcoming_events
    payload["upcomingEvents"] = upcoming_events
    return payload

def _is_paid_status(value: Any) -> bool:
    return _safe_lower(value) in {"paid", "succeeded", "complete", "completed"}


def _is_approved_status(value: Any) -> bool:
    return _safe_lower(value) in {"approved", "verified", "complete", "completed"}


def _profile_completion_percent(source: Dict[str, Any]) -> int:
    """Backend copy of public profile completeness used for marketplace tiering."""
    categories = _safe_list_of_str(source.get("categories") or source.get("vendor_categories"))
    image_urls = source.get("image_urls") or source.get("imageUrls") or source.get("images") or []
    if not isinstance(image_urls, list):
        image_urls = []

    checks = [
        bool(_safe_str(source.get("business_name") or source.get("businessName") or source.get("name"))),
        bool(_safe_str(source.get("description") or source.get("business_description") or source.get("businessDescription"))),
        bool(categories),
        bool(_safe_str(source.get("logo_url") or source.get("logoUrl") or source.get("logo_data_url") or source.get("logoDataUrl"))),
        bool(image_urls),
        bool(_safe_str(source.get("website"))),
        bool(_safe_str(source.get("instagram")) or _safe_str(source.get("facebook"))),
        bool(_safe_str(source.get("email"))),
        bool(_safe_str(source.get("phone"))),
        bool(_safe_str(source.get("contact_name") or source.get("contactName"))),
        bool(_safe_str(source.get("city"))),
        bool(_safe_str(source.get("state"))),
    ]
    return round((sum(1 for item in checks if item) / len(checks)) * 100)


def _canonical_vendor_state(vendor: Dict[str, Any], verification: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return one canonical public state for vendor verification + marketplace placement.

    This intentionally overwrites legacy fields later in the serializer so the
    frontend never has to choose between conflicting booleans/status strings.
    Public verification is based on admin review/payment truth. Expired document
    dates should trigger review workflows elsewhere, but they do not by
    themselves erase a previously approved public trust profile.
    """
    source = {**vendor}
    if isinstance(verification, dict):
        # Bring in document/review metadata without allowing old unverified flags
        # to erase an approved profile row.
        for key in ("documents", "expiration_date", "expires_at", "last_verified_at", "reviewed_at", "submitted_at"):
            if verification.get(key) not in (None, "", [], {}):
                source[key] = verification.get(key)

    review_status = _safe_lower(source.get("review_status") or source.get("reviewStatus"))
    status = _safe_lower(source.get("status"))
    verification_status_raw = _safe_lower(source.get("verification_status") or source.get("verificationStatus"))
    public_status_raw = _safe_lower(source.get("public_verification_status") or source.get("publicVerificationStatus"))
    payment_status = _safe_lower(source.get("payment_status") or source.get("verification_payment_status") or source.get("verificationPaymentStatus"))

    is_paid = (
        source.get("fee_paid") is True
        or bool(source.get("paid_at"))
        or _is_paid_status(payment_status)
    )

    is_rejected = review_status == "rejected" or status == "rejected" or verification_status_raw == "rejected"
    is_pending = review_status in {"pending", "submitted", "under_review"} or status in {"pending", "submitted", "under_review"}

    is_verified = False
    if not is_rejected:
        is_verified = (
            (_is_approved_status(review_status) and is_paid)
            or (_is_approved_status(status) and is_paid)
            or (vendor.get("verified") is True and is_paid)
            or (vendor.get("is_verified") is True and is_paid)
            or (public_status_raw == "verified" and is_paid)
            or (verification_status_raw in {"verified", "approved", "complete"} and is_paid)
        )

    if is_verified:
        verification_status = "verified"
        public_verification_status = "verified"
        public_verification_label = "Verified"
    elif is_rejected:
        verification_status = "rejected"
        public_verification_status = "not_verified"
        public_verification_label = "Not verified"
    elif is_pending:
        verification_status = "pending"
        public_verification_status = "pending"
        public_verification_label = "Review pending"
    else:
        verification_status = "unverified"
        public_verification_status = "not_verified"
        public_verification_label = "Not verified"

    plan = _safe_lower(source.get("subscription_plan") or source.get("subscriptionPlan") or source.get("plan"))
    subscription_status = _safe_lower(source.get("subscription_status") or source.get("subscriptionStatus"))
    has_active_subscription = subscription_status in {"active", "trialing", "paid"}
    has_premium_plan = any(token in plan for token in ["premium", "pro", "growth", "enterprise"])
    explicit_premium = (
        source.get("featured") is True
        or source.get("promoted") is True
        or source.get("premium") is True
        or source.get("is_premium") is True
        or source.get("premium_active") is True
        or source.get("premium_placement") is True
        or _safe_lower(source.get("visibility_tier") or source.get("visibilityTier")) == "premium"
        or _safe_lower(source.get("marketplace_tier") or source.get("marketplaceTier")) == "premium_verified"
    )

    completion = _profile_completion_percent(source)
    # Premium placement requires verified + active paid visibility + a usable public profile.
    # This keeps incomplete/test premium remnants (like Top Tech at 50%) out of the
    # Premium + Verified card section while allowing complete premium vendors to show there.
    is_premium_placement = bool(
        is_verified
        and has_active_subscription
        and (explicit_premium or has_premium_plan)
        and completion >= 80
    )

    if is_premium_placement:
        marketplace_tier = "premium_verified"
        visibility_tier = "premium"
    elif is_verified:
        marketplace_tier = "verified"
        visibility_tier = "verified"
    else:
        marketplace_tier = "standard"
        visibility_tier = "standard"

    return {
        "verified": is_verified,
        "is_verified": is_verified,
        "verification_status": verification_status,
        "verificationStatus": verification_status,
        "public_verification_status": public_verification_status,
        "publicVerificationStatus": public_verification_status,
        "public_verification_label": public_verification_label,
        "publicVerificationLabel": public_verification_label,
        "visibility_tier": visibility_tier,
        "visibilityTier": visibility_tier,
        "marketplace_tier": marketplace_tier,
        "marketplaceTier": marketplace_tier,
        "premium_placement": is_premium_placement,
        "premiumPlacement": is_premium_placement,
        "featured": is_premium_placement,
        "promoted": is_premium_placement,
        "profile_complete_percent": completion,
        "profileCompletePercent": completion,
        "subscription_plan": plan or "starter",
        "subscriptionPlan": plan or "starter",
        "subscription_status": subscription_status or "inactive",
        "subscriptionStatus": subscription_status or "inactive",
    }


def compute_verification_status(profile: Dict[str, Any], verification: Dict[str, Any] | None = None) -> str:
    return _canonical_vendor_state(profile, verification).get("verification_status", "unverified")


def _get_vendor_or_404(vendor_id: Any) -> Dict[str, Any]:
    # Legacy _VENDORS is migration-only. Runtime public/vendor truth lives in
    # Postgres Profile rows, so callers that need a vendor should load it with
    # _load_vendor_from_db(db, email).
    raise HTTPException(status_code=404, detail="Vendor not found")


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

    # Attach legacy/document data only as supplemental metadata. The canonical
    # state below will overwrite all conflicting public status fields.
    verification = None
    try:
        legacy_record = (
            _find_latest_record(vendor.get("email") or vendor_key, "vendor")
            or find_latest_verification_by_email(vendor.get("email") or vendor_key, "vendor")
        )
        if isinstance(legacy_record, dict):
            verification = legacy_record
    except Exception:
        verification = None

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

    if verification:
        payload["verification_id"] = verification.get("id")
        payload["expiration_date"] = verification.get("expiration_date") or payload.get("expiration_date")
        payload["documents"] = verification.get("documents", payload.get("documents", []))

    canonical = _canonical_vendor_state(payload, verification)
    payload.update(canonical)

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
    tiktok: str = ""
    youtube: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip: str = ""
    logoUrl: str = ""
    bannerUrl: str = ""
    imageUrls: List[str] = Field(default_factory=list)
    videoUrls: List[str] = Field(default_factory=list)
    video_urls: List[str] = Field(default_factory=list)
    videos: List[str] = Field(default_factory=list)
    offerings: List[Dict[str, Any]] = Field(default_factory=list)
    vendor_offerings: List[Dict[str, Any]] = Field(default_factory=list)
    menuUploads: List[Dict[str, Any]] = Field(default_factory=list)
    menu_uploads: List[Dict[str, Any]] = Field(default_factory=list)
    contactName: str = ""


class VendorReviewCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rating: int = Field(ge=1, le=5)
    comment: str = ""
    reviewer_name: str = ""
    reviewer_display_name: str = ""


class VendorExternalEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    title: str = ""
    start_date: str = ""
    startDate: str = ""
    end_date: str = ""
    endDate: str = ""
    venue_name: str = ""
    venueName: str = ""
    city: str = ""
    state: str = ""
    booth_note: str = ""
    boothNote: str = ""
    event_url: str = ""
    eventUrl: str = ""
    maps_url: str = ""
    mapsUrl: str = ""
    published: bool = True


class VendorExternalEventsSave(BaseModel):
    model_config = ConfigDict(extra="ignore")

    events: List[VendorExternalEvent] = Field(default_factory=list)


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
    return _vendor_payload_with_schedule(key, vendor)


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

    return _vendor_payload_with_schedule(key, updated)


@router.get("/me/external-events")
def get_my_external_events(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = _user_vendor_key(user)
    vendor = _load_vendor_from_db(db, key) or {"vendor_id": key, "email": key}
    events = _vendor_schedule(key, vendor, include_unpublished_external=True)
    return {"ok": True, "events": events, "external_events": events, "externalEvents": events}


@router.put("/me/external-events")
def save_my_external_events(
    payload: VendorExternalEventsSave,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = _user_vendor_key(user)
    existing = _load_vendor_from_db(db, key) or {"vendor_id": key, "email": key}
    raw_events = [event.model_dump() for event in payload.events]
    normalized_events = _normalize_external_events(raw_events, include_unpublished=True)

    updated = {
        **existing,
        "vendor_id": key,
        "email": key,
        "external_events": normalized_events,
        "externalEvents": normalized_events,
        "updated_at": _now_iso(),
    }

    _upsert_profile_row(db, email=key, role="vendor", data=updated)
    updated = _load_vendor_from_db(db, key) or updated
    public_payload = _vendor_payload_with_schedule(key, updated)
    return {
        "ok": True,
        "events": normalized_events,
        "external_events": normalized_events,
        "externalEvents": normalized_events,
        "upcoming_events": public_payload.get("upcoming_events", []),
        "upcomingEvents": public_payload.get("upcomingEvents", []),
    }


@router.get("/by-email/{email}")
def get_vendor_profile_by_email(email: str, db: Session = Depends(get_db)):
    vendor_key = _normalize_vendor_key(email)
    vendor = _load_vendor_from_db(db, vendor_key)
    if not isinstance(vendor, dict) or not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _vendor_payload_with_schedule(vendor_key, vendor)


@router.get("/public/{vendor_id}")
def get_vendor_profile(vendor_id: str, db: Session = Depends(get_db)):
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _load_vendor_from_db(db, vendor_key)
    if not isinstance(vendor, dict) or not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _vendor_payload_with_schedule(vendor_key, vendor)


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
