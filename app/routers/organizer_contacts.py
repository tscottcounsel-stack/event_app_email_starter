# app/routers/organizer_contacts.py
#
# Organizer Contacts CRM (v1)
# - GET  /organizer/contacts           -> list contacts for current organizer
# - POST /organizer/contacts           -> add a single contact
# - POST /organizer/contacts/import    -> bulk import contacts
#
# Fields:
#   name, email, phone, company, notes, tags (jsonb array of strings)

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.auth import AuthUser, get_current_user
from app.database import get_db

router = APIRouter(prefix="/organizer", tags=["organizer_contacts"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class OrganizerContactBase(BaseModel):
    name: str = Field(..., description="Person or company contact name")
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = Field(
        default=None,
        description="Company / organization name, if different from contact name",
    )
    notes: Optional[str] = Field(
        default=None,
        description="How you met, what they sell, special requests, etc.",
    )
    tags: List[str] = Field(
        default_factory=list,
        description="Tags/categories (VIP, sponsor, food truck, etc.)",
    )


class OrganizerContactCreate(OrganizerContactBase):
    """Payload for creating/importing a contact."""

    pass


class OrganizerContactOut(OrganizerContactBase):
    id: int
    organizer_id: int


class OrganizerContactsImportRequest(BaseModel):
    """Bulk import payload."""

    contacts: List[OrganizerContactCreate]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def normalize_tags(raw) -> list[str]:
    """
    Accept either a list of strings or a comma-separated string.
    Return a clean list of non-empty, trimmed strings.
    """
    if raw is None:
        return []

    if isinstance(raw, str):
        items = raw.split(",")
    else:
        items = list(raw)

    cleaned: list[str] = []
    for item in items:
        if item is None:
            continue
        s = str(item).strip()
        if s:
            cleaned.append(s)
    return cleaned


# ---------------------------------------------------------------------------
# Shared INSERT with JSONB bindparam for tags
# ---------------------------------------------------------------------------

INSERT_CONTACT_SQL = text(
    """
        INSERT INTO organizer_contacts (
            organizer_id,
            name,
            email,
            phone,
            company,
            notes,
            tags
        )
        VALUES (
            :organizer_id,
            :name,
            :email,
            :phone,
            :company,
            :notes,
            :tags
        )
        RETURNING
            id,
            organizer_id,
            name,
            email,
            phone,
            company,
            notes,
            COALESCE(tags, '[]'::jsonb) AS tags
        """
).bindparams(
    bindparam("tags", type_=JSONB)  # tell SQLAlchemy/psycopg this is JSONB
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/contacts")
def list_organizer_contacts(
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List contacts for the current organizer.

    Response:
    {
      "value": [OrganizerContactOut, ...],
      "Count": <int>
    }
    """
    sql = text(
        """
        SELECT
            id,
            organizer_id,
            name,
            email,
            phone,
            company,
            notes,
            COALESCE(tags, '[]'::jsonb) AS tags
        FROM organizer_contacts
        WHERE organizer_id = :organizer_id
        ORDER BY id DESC
        """
    )

    try:
        rows = db.execute(sql, {"organizer_id": current_user.id}).mappings().all()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load organizer contacts: {exc.__class__.__name__}",
        ) from exc

    contacts: list[OrganizerContactOut] = []
    for row in rows:
        contacts.append(
            OrganizerContactOut(
                id=row["id"],
                organizer_id=row["organizer_id"],
                name=row["name"],
                email=row["email"],
                phone=row["phone"],
                company=row["company"],
                notes=row["notes"],
                tags=row["tags"] or [],
            )
        )

    return {"value": contacts, "Count": len(contacts)}


@router.post("/contacts", response_model=OrganizerContactOut)
def create_organizer_contact(
    payload: OrganizerContactCreate,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a single contact for the current organizer.
    """
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    clean_tags = normalize_tags(payload.tags)

    params = {
        "organizer_id": current_user.id,
        "name": payload.name.strip(),
        "email": payload.email,
        "phone": payload.phone,
        "company": payload.company,
        "notes": payload.notes,
        # JSONB bindparam will serialize this Python list correctly
        "tags": clean_tags,
    }

    try:
        row = db.execute(INSERT_CONTACT_SQL, params).mappings().one()
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create organizer contact: {exc.__class__.__name__}",
        ) from exc

    return OrganizerContactOut(
        id=row["id"],
        organizer_id=row["organizer_id"],
        name=row["name"],
        email=row["email"],
        phone=row["phone"],
        company=row["company"],
        notes=row["notes"],
        tags=row["tags"] or [],
    )


@router.post("/contacts/import")
def import_organizer_contacts(
    payload: OrganizerContactsImportRequest,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Bulk import multiple contacts for the current organizer.

    Accepts:
    {
      "contacts": [ OrganizerContactCreate, ... ]
    }

    Returns:
    {
      "value": [OrganizerContactOut, ...created],
      "Count": <int>
    }
    """
    if not payload.contacts:
        return {"value": [], "Count": 0}

    created: list[OrganizerContactOut] = []

    try:
        for contact in payload.contacts:
            if not contact.name or not contact.name.strip():
                # Skip nameless contacts quietly in import
                continue

            clean_tags = normalize_tags(contact.tags)

            params = {
                "organizer_id": current_user.id,
                "name": contact.name.strip(),
                "email": contact.email,
                "phone": contact.phone,
                "company": contact.company,
                "notes": contact.notes,
                "tags": clean_tags,
            }

            row = db.execute(INSERT_CONTACT_SQL, params).mappings().one()
            created.append(
                OrganizerContactOut(
                    id=row["id"],
                    organizer_id=row["organizer_id"],
                    name=row["name"],
                    email=row["email"],
                    phone=row["phone"],
                    company=row["company"],
                    notes=row["notes"],
                    tags=row["tags"] or [],
                )
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import organizer contacts: {exc.__class__.__name__}",
        ) from exc

    return {"value": created, "Count": len(created)}
