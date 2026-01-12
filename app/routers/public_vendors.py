# app/routers/public_vendors.py
#
# Public vendor directory API
# - GET /public/vendors          -> list vendors for directories / public previews
# - GET /public/vendors/{id}     -> single vendor public profile
#
# Backing store: vendor_profiles table (joined to users to ensure vendor role).

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.database import SessionLocal

router = APIRouter(prefix="/public", tags=["public_vendors"])


class PublicVendor(BaseModel):
    profile_id: int = Field(..., description="vendor_profiles.id")
    user_id: int = Field(..., description="users.id for this vendor")
    business_name: Optional[str] = None
    public_email: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    vendor_story: Optional[str] = None
    public_logo_url: Optional[str] = None
    checklist_tags: list[str] = Field(default_factory=list)
    vendor_categories: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# GET /public/vendors  (list)
# ---------------------------------------------------------------------------


@router.get("/vendors", response_model=List[PublicVendor])
def list_public_vendors(
    q: Optional[str] = Query(
        default=None,
        description="Optional search string for business name / city / story",
    ),
    city: Optional[str] = Query(
        default=None,
        description="Optional city/area filter (case-insensitive match)",
    ),
    limit: int = Query(
        default=50,
        ge=1,
        le=200,
        description="Maximum number of vendors to return",
    ),
):
    """
    Public vendor directory.

    Returns vendors that:
    - Have a vendor_profiles row
    - Are attached to a user with role='vendor'
    - Have a non-empty business_name

    Optional filters:
    - q: fuzzy search over business_name, city, vendor_story
    - city: exact-ish city filter (ILIKE)
    """
    db = SessionLocal()
    try:
        where_clauses = [
            "u.role = 'vendor'",
            "vp.business_name IS NOT NULL",
            "vp.business_name <> ''",
        ]
        params: Dict[str, Any] = {"limit": limit}

        if q:
            where_clauses.append(
                "(vp.business_name ILIKE :q OR vp.city ILIKE :q OR vp.vendor_story ILIKE :q)"
            )
            params["q"] = f"%{q}%"

        if city:
            where_clauses.append("vp.city ILIKE :city")
            params["city"] = city

        where_sql = " AND ".join(where_clauses)

        sql = text(
            f"""
            SELECT
                vp.id AS profile_id,
                vp.user_id AS user_id,
                vp.business_name,
                vp.public_email,
                vp.city,
                vp.phone,
                vp.website,
                vp.vendor_story,
                vp.public_logo_url,
                COALESCE(vp.checklist_tags, '[]'::jsonb) AS checklist_tags,
                COALESCE(vp.vendor_categories, '[]'::jsonb) AS vendor_categories
            FROM vendor_profiles AS vp
            JOIN users AS u ON u.id = vp.user_id
            WHERE {where_sql}
            ORDER BY vp.business_name ASC
            LIMIT :limit
            """
        )

        rows = db.execute(sql, params).mappings().all()

        return [
            PublicVendor(
                profile_id=row["profile_id"],
                user_id=row["user_id"],
                business_name=row["business_name"],
                public_email=row["public_email"],
                city=row["city"],
                phone=row["phone"],
                website=row["website"],
                vendor_story=row["vendor_story"],
                public_logo_url=row["public_logo_url"],
                checklist_tags=row["checklist_tags"] or [],
                vendor_categories=row["vendor_categories"] or [],
            )
            for row in rows
        ]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load public vendors: {type(e).__name__}: {e}",
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /public/vendors/{profile_id}  (detail)
# ---------------------------------------------------------------------------


@router.get("/vendors/{profile_id}", response_model=PublicVendor)
def get_public_vendor(profile_id: int):
    """
    Public detail view of a single vendor profile.

    Looks up vendor_profiles.id = profile_id, joined to users with role='vendor'.
    """
    db = SessionLocal()
    try:
        sql = text(
            """
            SELECT
                vp.id AS profile_id,
                vp.user_id AS user_id,
                vp.business_name,
                vp.public_email,
                vp.city,
                vp.phone,
                vp.website,
                vp.vendor_story,
                vp.public_logo_url,
                COALESCE(vp.checklist_tags, '[]'::jsonb) AS checklist_tags,
                COALESCE(vp.vendor_categories, '[]'::jsonb) AS vendor_categories
            FROM vendor_profiles AS vp
            JOIN users AS u ON u.id = vp.user_id
            WHERE u.role = 'vendor'
              AND vp.id = :profile_id
            LIMIT 1
            """
        )

        row = db.execute(sql, {"profile_id": profile_id}).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Vendor not found")

        return PublicVendor(
            profile_id=row["profile_id"],
            user_id=row["user_id"],
            business_name=row["business_name"],
            public_email=row["public_email"],
            city=row["city"],
            phone=row["phone"],
            website=row["website"],
            vendor_story=row["vendor_story"],
            public_logo_url=row["public_logo_url"],
            checklist_tags=row["checklist_tags"] or [],
            vendor_categories=row["vendor_categories"] or [],
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load vendor: {type(e).__name__}: {e}",
        )
    finally:
        db.close()
