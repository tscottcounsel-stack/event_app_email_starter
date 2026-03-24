from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

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
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",")]
        return [part for part in parts if part]
    return []


def _user_vendor_key(user: Dict[str, Any]) -> str:
    user_id = user.get("id")
    if user_id is not None and str(user_id).strip():
        return str(user_id).strip()

    email = _safe_str(user.get("email")).lower()
    if email:
        return email

    raise HTTPException(status_code=400, detail="Unable to resolve vendor identity")


def _normalize_vendor_profile(
    source: Optional[Dict[str, Any]],
    *,
    vendor_id: Optional[str] = None,
    current_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    source = source or {}
    current_user = current_user or {}

    resolved_vendor_id = (
        vendor_id
        or _safe_str(source.get("vendor_id"))
        or _safe_str(source.get("vendorId"))
        or _safe_str(source.get("user_id"))
        or _safe_str(current_user.get("id"))
    )

    email = (
        _safe_str(source.get("email"))
        or _safe_str(source.get("vendor_email"))
        or _safe_str(source.get("contact_email"))
        or _safe_str(current_user.get("email"))
    )

    contact_name = (
        _safe_str(source.get("contact_name"))
        or _safe_str(source.get("contactName"))
        or _safe_str(source.get("owner_name"))
        or _safe_str(source.get("full_name"))
        or _safe_str(current_user.get("full_name"))
    )

    business_name = (
        _safe_str(source.get("business_name"))
        or _safe_str(source.get("businessName"))
        or _safe_str(source.get("vendor_business_name"))
        or _safe_str(source.get("company_name"))
        or _safe_str(source.get("name"))
    )

    profile = {
        "vendor_id": resolved_vendor_id or "",
        "business_name": business_name,
        "email": email,
        "phone": (
            _safe_str(source.get("phone"))
            or _safe_str(source.get("vendor_phone"))
            or _safe_str(source.get("contact_phone"))
        ),
        "description": (
            _safe_str(source.get("description"))
            or _safe_str(source.get("business_description"))
            or _safe_str(source.get("vendor_description"))
        ),
        "categories": (
            _safe_list_of_str(source.get("categories"))
            or _safe_list_of_str(source.get("vendor_categories"))
        ),
        "website": _safe_str(source.get("website"))
        or _safe_str(source.get("website_url")),
        "instagram": _safe_str(source.get("instagram"))
        or _safe_str(source.get("instagram_url")),
        "facebook": _safe_str(source.get("facebook"))
        or _safe_str(source.get("facebook_url")),
        "logo_url": _safe_str(source.get("logo_url"))
        or _safe_str(source.get("logoUrl")),
        "banner_url": _safe_str(source.get("banner_url"))
        or _safe_str(source.get("bannerUrl")),
        "contact_name": contact_name,
        "updated_at": _safe_str(source.get("updated_at")) or _now_iso(),
    }

    return profile


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
    logoUrl: str = ""
    bannerUrl: str = ""
    contactName: str = ""


@router.get("/_ping")
def vendors_ping() -> Dict[str, Any]:
    return {"ok": True}


@router.get("/me")
def get_my_vendor_profile(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    vendor_key = _user_vendor_key(user)
    existing = _VENDORS.get(vendor_key)

    if existing:
        return _normalize_vendor_profile(
            existing, vendor_id=vendor_key, current_user=user
        )

    return _normalize_vendor_profile({}, vendor_id=vendor_key, current_user=user)


@router.post("/me")
def save_my_vendor_profile(
    payload: VendorProfileUpsert,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    vendor_key = _user_vendor_key(user)
    existing = _VENDORS.get(vendor_key) or {}

    merged = dict(existing)
    merged.update(payload.model_dump())

    normalized = _normalize_vendor_profile(
        merged, vendor_id=vendor_key, current_user=user
    )
    _VENDORS[vendor_key] = normalized
    save_store()
    return normalized


@router.get("/{vendor_id}")
def get_vendor_profile(vendor_id: str) -> Dict[str, Any]:
    vendor_key = _safe_str(vendor_id)
    if not vendor_key:
        raise HTTPException(status_code=400, detail="Vendor id is required")

    existing = _VENDORS.get(vendor_key)
    if not existing:
        raise HTTPException(status_code=404, detail="Vendor not found")

    return _normalize_vendor_profile(existing, vendor_id=vendor_key)


@router.get("/public/{vendor_id}")
def get_public_vendor_profile(vendor_id: str) -> Dict[str, Any]:
    return get_vendor_profile(vendor_id)
