# app/routers/vendor_profile.py

from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.auth import AuthUser, get_current_user
from app.database import SessionLocal

router = APIRouter(prefix="/vendor", tags=["vendor_profile"])


# -------------------------
# Pydantic models
# -------------------------
class VendorProfile(BaseModel):
    business_name: Optional[str] = None
    contact_name: Optional[str] = None
    public_email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    city: Optional[str] = None
    vendor_story: Optional[str] = None
    checklist_tags: List[str] = []
    vendor_categories: List[str] = []


class VendorProfileUpdate(BaseModel):
    business_name: Optional[str] = None
    contact_name: Optional[str] = None
    public_email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    city: Optional[str] = None
    vendor_story: Optional[str] = None
    checklist_tags: Optional[List[str]] = None
    vendor_categories: Optional[List[str]] = None


EMPTY_VENDOR = VendorProfile()


# Pre-built INSERT ... ON CONFLICT statement with JSONB bind params
insert_sql = text(
    """
    INSERT INTO vendor_profiles (
        user_id,
        business_name,
        contact_name,
        public_email,
        phone,
        website,
        city,
        vendor_story,
        checklist_tags,
        vendor_categories
    )
    VALUES (
        :uid,
        :business_name,
        :contact_name,
        :public_email,
        :phone,
        :website,
        :city,
        :vendor_story,
        :checklist_tags,
        :vendor_categories
    )
    ON CONFLICT (user_id) DO UPDATE SET
        business_name     = EXCLUDED.business_name,
        contact_name      = EXCLUDED.contact_name,
        public_email      = EXCLUDED.public_email,
        phone             = EXCLUDED.phone,
        website           = EXCLUDED.website,
        city              = EXCLUDED.city,
        vendor_story      = EXCLUDED.vendor_story,
        checklist_tags    = EXCLUDED.checklist_tags,
        vendor_categories = EXCLUDED.vendor_categories
    """
).bindparams(
    bindparam("checklist_tags", type_=JSONB),
    bindparam("vendor_categories", type_=JSONB),
)


# -------------------------
# GET /vendor/profile
# -------------------------
@router.get("/profile", response_model=VendorProfile)
def get_vendor_profile(
    current_user: AuthUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        result = (
            db.execute(
                text(
                    """
                    SELECT
                        business_name,
                        contact_name,
                        public_email,
                        phone,
                        website,
                        city,
                        vendor_story,
                        COALESCE(checklist_tags, '[]'::jsonb) AS checklist_tags,
                        COALESCE(vendor_categories, '[]'::jsonb) AS vendor_categories
                    FROM vendor_profiles
                    WHERE user_id = :uid
                    LIMIT 1
                    """
                ),
                {"uid": current_user.id},
            )
            .mappings()
            .first()
        )

        if not result:
            return EMPTY_VENDOR

        return VendorProfile(
            business_name=result["business_name"],
            contact_name=result["contact_name"],
            public_email=result["public_email"],
            phone=result["phone"],
            website=result["website"],
            city=result["city"],
            vendor_story=result["vendor_story"],
            checklist_tags=result["checklist_tags"] or [],
            vendor_categories=result["vendor_categories"] or [],
        )
    finally:
        db.close()


# -------------------------
# PATCH /vendor/profile
# -------------------------
@router.patch("/profile", response_model=VendorProfile)
def update_vendor_profile(
    payload: VendorProfileUpdate,
    current_user: AuthUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        checklist = payload.checklist_tags or []
        categories = payload.vendor_categories or []

        db.execute(
            insert_sql,
            {
                "uid": current_user.id,
                "business_name": payload.business_name,
                "contact_name": payload.contact_name,
                "public_email": payload.public_email,
                "phone": payload.phone,
                "website": payload.website,
                "city": payload.city,
                "vendor_story": payload.vendor_story,
                "checklist_tags": checklist,
                "vendor_categories": categories,
            },
        )
        db.commit()
    finally:
        db.close()

    # Return canonical, freshly loaded profile
    return get_vendor_profile(current_user)
