from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user
from app.store import _VENDORS, save_store

router = APIRouter(prefix="/vendors", tags=["Vendors"])


def _normalize_vendor_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "vendor_id": data.get("vendor_id"),
        "business_name": data.get("businessName") or data.get("business_name") or "",
        "email": data.get("email") or "",
        "phone": data.get("phone") or "",
        "description": data.get("description") or "",
        "categories": data.get("categories") or [],
        "website": data.get("website") or "",
        "instagram": data.get("instagram") or "",
        "facebook": data.get("facebook") or "",
        "logo_url": data.get("logoUrl") or data.get("logo_url") or "",
        "banner_url": data.get("bannerUrl") or data.get("banner_url") or "",
        "contact_name": data.get("contactName") or data.get("contact_name") or "",
    }


@router.get("/me")
def get_my_vendor_profile(user=Depends(get_current_user)):
    vendor_id = str(user.get("id"))
    profile = _VENDORS.get(vendor_id)
    if not profile:
        return {}
    return profile


@router.post("/me")
def save_my_vendor_profile(payload: Dict[str, Any], user=Depends(get_current_user)):
    vendor_id = str(user.get("id"))

    normalized = _normalize_vendor_profile(payload)
    normalized["vendor_id"] = vendor_id

    _VENDORS[vendor_id] = normalized
    save_store()

    return normalized


@router.get("/{vendor_id}")
def get_vendor_profile(vendor_id: str):
    profile = _VENDORS.get(str(vendor_id))
    if not profile:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return profile
