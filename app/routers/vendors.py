from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.routers.auth import get_current_user
from app.store import _VENDORS, save_store

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
        return str(user_id)

    email = _safe_str(user.get("email")).lower()
    if email:
        return email

    raise HTTPException(status_code=400, detail="Unable to resolve vendor identity")


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
    _VENDORS[key] = updated
    save_store()
    return updated


@router.get("/public/{vendor_id}")
def get_vendor_profile(vendor_id: str):
    vendor = _VENDORS.get(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor
