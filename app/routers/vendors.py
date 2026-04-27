from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.routers.auth import get_current_user
from app.store import _APPLICATIONS, _EVENTS, _REVIEWS, _VENDORS, next_review_id, save_store

router = APIRouter(prefix="/vendors", tags=["Vendors"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


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


def compute_verification_status(profile: Dict[str, Any]) -> str:
    """Return the public verification lifecycle status for a vendor profile."""
    now = datetime.utcnow()
    explicit_status = _safe_str(
        profile.get("verification_status")
        or profile.get("verificationStatus")
        or profile.get("status")
    ).lower()

    if explicit_status in {"expired", "expiring_soon", "verified", "pending", "rejected"}:
        return explicit_status

    documents = profile.get("documents") or profile.get("verification_documents") or profile.get("verificationDocuments") or []
    if isinstance(documents, dict):
        documents = list(documents.values())

    has_expiration = False
    if isinstance(documents, list):
        for doc in documents:
            if not isinstance(doc, dict):
                continue

            exp_date = _parse_datetime(
                doc.get("expiration_date")
                or doc.get("expirationDate")
                or doc.get("expires_at")
                or doc.get("expiresAt")
            )

            if not exp_date:
                continue

            has_expiration = True
            if exp_date < now:
                return "expired"
            if exp_date - now <= timedelta(days=30):
                return "expiring_soon"

    if bool(profile.get("verified")) or explicit_status in {"approved", "complete"}:
        if has_expiration:
            return "verified"

        # Temporary lifecycle proxy until upload flows persist real expiration_date values.
        updated = _parse_datetime(profile.get("updated_at") or profile.get("updatedAt"))
        if updated:
            age_days = (now - updated).days
            if age_days > 365:
                return "expired"
            if age_days >= 335:
                return "expiring_soon"

        return "verified"

    return "pending"


def _get_vendor_or_404(vendor_id: Any) -> Dict[str, Any]:
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _VENDORS.get(vendor_key)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


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
    payload["verification_status"] = compute_verification_status(vendor)
    payload["verified"] = payload["verification_status"] == "verified"

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
def get_my_vendor_profile(user: Dict[str, Any] = Depends(get_current_user)):
    key = _user_vendor_key(user)
    vendor = _VENDORS.get(key) or {}
    if not vendor:
        return {}
    return _vendor_public_payload(key, vendor)


@router.post("/me")
def save_my_vendor_profile(
    payload: VendorProfileUpsert,
    user: Dict[str, Any] = Depends(get_current_user),
):
    key = _user_vendor_key(user)
    existing = _VENDORS.get(key, {})
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

    _VENDORS[key] = updated
    save_store()
    _sync_vendor_category_to_applications(key, updated)

    return _vendor_public_payload(key, updated)


@router.get("/by-email/{email}")
def get_vendor_profile_by_email(email: str):
    vendor_key = _normalize_vendor_key(email)
    vendor = _get_vendor_or_404(vendor_key)
    return _vendor_public_payload(vendor_key, vendor)


@router.get("/public/{vendor_id}")
def get_vendor_profile(vendor_id: str):
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _get_vendor_or_404(vendor_key)
    return _vendor_public_payload(vendor_key, vendor)


@router.get("/{vendor_id}/reviews")
def get_vendor_reviews(vendor_id: str):
    _get_vendor_or_404(vendor_id)
    return _review_summary(vendor_id)


@router.post("/{vendor_id}/reviews")
def create_vendor_review(
    vendor_id: str,
    payload: VendorReviewCreate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    vendor_key = _normalize_vendor_key(vendor_id)
    _get_vendor_or_404(vendor_key)

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

@router.get("/public")
def get_public_vendors():
    results = []

    for vendor_key, vendor in _VENDORS.items():
        if not isinstance(vendor, dict):
            continue

        payload = _vendor_public_payload(vendor_key, vendor)

        # Only show vendors with at least basic profile data
        if payload.get("business_name") or payload.get("email"):
            results.append(payload)

    return results