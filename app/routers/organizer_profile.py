# app/routers/organizer_profile.py
#
# Organizer profile API
# - GET   /organizer/profile  -> load current organizer profile (or empty defaults)
# - PATCH /organizer/profile  -> upsert organizer profile for the logged-in organizer
#
# Backing store: organizer_profiles table (one row per user_id)

from __future__ import annotations

import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import AuthUser, get_current_user
from app.database import get_db

router = APIRouter(prefix="/organizer", tags=["organizer-profile"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class OrganizerProfilePayload(BaseModel):
    business_name: Optional[str] = None
    contact_name: Optional[str] = None
    public_email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    city: Optional[str] = None
    organizer_story: Optional[str] = None
    checklist_tags: List[str] = Field(default_factory=list)
    organizer_categories: List[str] = Field(default_factory=list)
    # Placeholder for future logo wiring (no DB column yet)
    public_logo_url: Optional[str] = None


class OrganizerProfileOut(OrganizerProfilePayload):
    user_id: int
    id: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_list(value: Any) -> List[str]:
    """Normalize a jsonb value from Postgres into a list[str]."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed if v is not None]
            return []
        except Exception:
            return []
    return []


def _row_to_profile(row: Optional[dict], user_id: int) -> OrganizerProfileOut:
    """Turn a DB row (or None) into an OrganizerProfileOut."""
    if not row:
        return OrganizerProfileOut(
            id=None,
            user_id=user_id,
            business_name=None,
            contact_name=None,
            public_email=None,
            phone=None,
            website=None,
            city=None,
            organizer_story=None,
            checklist_tags=[],
            organizer_categories=[],
            public_logo_url=None,
        )

    return OrganizerProfileOut(
        id=row["id"],
        user_id=row["user_id"],
        business_name=row.get("business_name"),
        contact_name=row.get("contact_name"),
        public_email=row.get("public_email"),
        phone=row.get("phone"),
        website=row.get("website"),
        city=row.get("city"),
        organizer_story=row.get("organizer_story"),
        checklist_tags=_ensure_list(row.get("checklist_tags")),
        organizer_categories=_ensure_list(row.get("organizer_categories")),
        # Column doesn’t exist yet, so always None for now
        public_logo_url=None,
    )


def _require_organizer(user: AuthUser) -> AuthUser:
    if user.role != "organizer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer access required.",
        )
    return user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/profile", response_model=OrganizerProfileOut)
def get_organizer_profile(
    db: Session = Depends(get_db),
    current_user: AuthUser = Depends(get_current_user),
) -> OrganizerProfileOut:
    """
    Load the organizer profile for the current logged-in organizer.
    If none exists yet, return an empty shell.
    """
    user = _require_organizer(current_user)

    result = db.execute(
        text(
            """
            SELECT
                id,
                user_id,
                business_name,
                contact_name,
                public_email,
                phone,
                website,
                city,
                organizer_story,
                checklist_tags,
                organizer_categories
            FROM organizer_profiles
            WHERE user_id = :uid
            """
        ),
        {"uid": user.id},
    )

    row = result.mappings().first()
    return _row_to_profile(row, user.id)


@router.patch("/profile", response_model=OrganizerProfileOut)
def upsert_organizer_profile(
    payload: OrganizerProfilePayload,
    db: Session = Depends(get_db),
    current_user: AuthUser = Depends(get_current_user),
) -> OrganizerProfileOut:
    """
    Upsert the organizer profile for the logged-in organizer.

    Strategy:
      1) UPDATE ... WHERE user_id = :uid RETURNING ...
      2) If no row updated, INSERT ... RETURNING ...
    """
    user = _require_organizer(current_user)

    # Send real Python lists to jsonb columns; psycopg will adapt them.
    checklist_tags = payload.checklist_tags or []
    organizer_categories = payload.organizer_categories or []

    params = {
        "uid": user.id,
        "business_name": payload.business_name,
        "contact_name": payload.contact_name,
        "public_email": payload.public_email,
        "phone": payload.phone,
        "website": payload.website,
        "city": payload.city,
        "organizer_story": payload.organizer_story,
        "checklist_tags": checklist_tags,
        "organizer_categories": organizer_categories,
    }

    try:
        # First try UPDATE
        update_result = db.execute(
            text(
                """
                UPDATE organizer_profiles
                SET
                    business_name        = :business_name,
                    contact_name         = :contact_name,
                    public_email         = :public_email,
                    phone                = :phone,
                    website              = :website,
                    city                 = :city,
                    organizer_story      = :organizer_story,
                    checklist_tags       = :checklist_tags,
                    organizer_categories = :organizer_categories,
                    updated_at           = now()
                WHERE user_id = :uid
                RETURNING
                    id,
                    user_id,
                    business_name,
                    contact_name,
                    public_email,
                    phone,
                    website,
                    city,
                    organizer_story,
                    checklist_tags,
                    organizer_categories
                """
            ),
            params,
        )
        row = update_result.mappings().first()

        # If nothing updated, INSERT
        if not row:
            insert_result = db.execute(
                text(
                    """
                    INSERT INTO organizer_profiles (
                        user_id,
                        business_name,
                        contact_name,
                        public_email,
                        phone,
                        website,
                        city,
                        organizer_story,
                        checklist_tags,
                        organizer_categories
                    )
                    VALUES (
                        :uid,
                        :business_name,
                        :contact_name,
                        :public_email,
                        :phone,
                        :website,
                        :city,
                        :organizer_story,
                        :checklist_tags,
                        :organizer_categories
                    )
                    RETURNING
                        id,
                        user_id,
                        business_name,
                        contact_name,
                        public_email,
                        phone,
                        website,
                        city,
                        organizer_story,
                        checklist_tags,
                        organizer_categories
                    """
                ),
                params,
            )
            row = insert_result.mappings().first()

        db.commit()

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to save organizer profile: {type(e).__name__}: {e}",
        )

    return _row_to_profile(row, user.id)
