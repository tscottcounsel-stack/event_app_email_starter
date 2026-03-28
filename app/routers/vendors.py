from __future__ import annotations

from datetime import datetime, timezone
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
    return []


def _user_vendor_key(user: Dict[str, Any]) -> str:
    user_id = user.get("id")
    if user_id:
        return str(user_id).strip().lower()

    email = _safe_str(user.get("email")).lower()
    if email:
        return email

    raise HTTPException(status_code=400, detail="Unable to resolve vendor identity")


def _normalize_vendor_key(vendor_id: Any) -> str:
    vendor_key = _safe_str(vendor_id).lower()
    if not vendor_key:
        raise HTTPException(status_code=400, detail="Vendor id is required")
    return vendor_key


def _map_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "business_name": payload.get("businessName", ""),
        "email": payload.get("email", ""),
        "phone": payload.get("phone", ""),
        "description": payload.get("description", ""),
        "categories": payload.get("categories", []),
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


def _get_vendor_or_404(vendor_id: Any) -> Dict[str, Any]:
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _VENDORS.get(vendor_key)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


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
    return _VENDORS.get(key, {})


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
    _VENDORS[key] = updated
    save_store()
    return updated


@router.get("/public/{vendor_id}")
def get_vendor_profile(vendor_id: str):
    vendor_key = _normalize_vendor_key(vendor_id)
    vendor = _get_vendor_or_404(vendor_key)
    return {**vendor, "vendor_id": vendor_key}


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
