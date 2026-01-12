# app/routers/public_organizers.py
#
# Public organizer directory API
# - GET /public/organizers          -> list organizers for directories / public previews
# - GET /public/organizers/{id}     -> single organizer public profile
#
# Backing store: organizer_profiles table (joined to users to ensure organizer role).

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.database import SessionLocal

router = APIRouter(prefix="/public", tags=["public_organizers"])


class PublicOrganizer(BaseModel):
    profile_id: int = Field(..., description="organizer_profiles.id")
    user_id: int = Field(..., description="users.id for this organizer")
    business_name: Optional[str] = None
    public_email: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    organizer_story: Optional[str] = None
    # No DB column yet; reserved for future logo/media feature.
    public_logo_url: Optional[str] = None
    checklist_tags: list[str] = Field(default_factory=list)
    organizer_categories: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# GET /public/organizers  (list)
# ---------------------------------------------------------------------------


@router.get("/organizers", response_model=List[PublicOrganizer])
def list_public_organizers(
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
        description="Maximum number of organizers to return",
    ),
):
    """
    Public organizer directory.

    Returns organizers that:
    - Have an organizer_profiles row
    - Are attached to a user with role='organizer'
    - Have a non-empty business_name

    Optional filters:
    - q: fuzzy search over business_name, city, organizer_story
    - city: exact-ish city filter (ILIKE)
    """
    db = SessionLocal()
    try:
        where_clauses = [
            "u.role = 'organizer'",
            "op.business_name IS NOT NULL",
            "op.business_name <> ''",
        ]
        params: Dict[str, Any] = {"limit": limit}

        if q:
            where_clauses.append(
                "(op.business_name ILIKE :q OR op.city ILIKE :q OR op.organizer_story ILIKE :q)"
            )
            params["q"] = f"%{q}%"

        if city:
            where_clauses.append("op.city ILIKE :city")
            params["city"] = city

        where_sql = " AND ".join(where_clauses)

        # Cast to jsonb before COALESCE to avoid text/jsonb mismatch
        sql = text(
            f"""
            SELECT
                op.id AS profile_id,
                op.user_id AS user_id,
                op.business_name,
                op.public_email,
                op.city,
                op.phone,
                op.website,
                op.organizer_story,
                COALESCE(op.checklist_tags::jsonb, '[]'::jsonb) AS checklist_tags,
                COALESCE(op.organizer_categories::jsonb, '[]'::jsonb) AS organizer_categories
            FROM organizer_profiles AS op
            JOIN users AS u ON u.id = op.user_id
            WHERE {where_sql}
            ORDER BY op.business_name ASC
            LIMIT :limit
            """
        )

        rows = db.execute(sql, params).mappings().all()

        organizers: List[PublicOrganizer] = []
        for row in rows:
            organizers.append(
                PublicOrganizer(
                    profile_id=row["profile_id"],
                    user_id=row["user_id"],
                    business_name=row["business_name"],
                    public_email=row["public_email"],
                    city=row["city"],
                    phone=row["phone"],
                    website=row["website"],
                    organizer_story=row["organizer_story"],
                    public_logo_url=None,  # reserved for future column
                    checklist_tags=row["checklist_tags"] or [],
                    organizer_categories=row["organizer_categories"] or [],
                )
            )

        return organizers

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load public organizers: {type(e).__name__}: {e}",
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /public/organizers/{profile_id}  (detail)
# ---------------------------------------------------------------------------


@router.get("/organizers/{profile_id}", response_model=PublicOrganizer)
def get_public_organizer(profile_id: int):
    """
    Public detail view of a single organizer profile.

    Looks up organizer_profiles.id = profile_id, joined to users with role='organizer'.
    """
    db = SessionLocal()
    try:
        sql = text(
            """
            SELECT
                op.id AS profile_id,
                op.user_id AS user_id,
                op.business_name,
                op.public_email,
                op.city,
                op.phone,
                op.website,
                op.organizer_story,
                COALESCE(op.checklist_tags::jsonb, '[]'::jsonb) AS checklist_tags,
                COALESCE(op.organizer_categories::jsonb, '[]'::jsonb) AS organizer_categories
            FROM organizer_profiles AS op
            JOIN users AS u ON u.id = op.user_id
            WHERE u.role = 'organizer'
              AND op.id = :profile_id
            LIMIT 1
            """
        )

        row = db.execute(sql, {"profile_id": profile_id}).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Organizer not found")

        return PublicOrganizer(
            profile_id=row["profile_id"],
            user_id=row["user_id"],
            business_name=row["business_name"],
            public_email=row["public_email"],
            city=row["city"],
            phone=row["phone"],
            website=row["website"],
            organizer_story=row["organizer_story"],
            public_logo_url=None,
            checklist_tags=row["checklist_tags"] or [],
            organizer_categories=row["organizer_categories"] or [],
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load organizer: {type(e).__name__}: {e}",
        )
    finally:
        db.close()
