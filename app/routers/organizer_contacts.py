# app/routers/organizer_contacts.py
#
# Organizer Contacts CRM (v1)
# - GET   /organizer/contacts           -> list contacts for current organizer
# - POST  /organizer/contacts           -> add a single contact
# - POST  /organizer/contacts/import    -> bulk import contacts
# - PATCH /organizer/contacts/{id}      -> update a contact (partial)
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


# -----------------------------
# Models
# -----------------------------
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
    pass


class OrganizerContactUpdate(BaseModel):
    """PATCH payload. Omitted fields are unchanged; provided null clears."""

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class OrganizerContactOut(OrganizerContactBase):
    id: int
    organizer_id: int


class OrganizerContactsImportRequest(BaseModel):
    contacts: List[OrganizerContactCreate]


# -----------------------------
# Helpers
# -----------------------------
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


# -----------------------------
# SQL Templates
# -----------------------------
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
).bindparams(bindparam("tags", type_=JSONB))


SELECT_CONTACTS_SQL = text(
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

SELECT_ONE_CONTACT_SQL = text(
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
    WHERE id = :id AND organizer_id = :organizer_id
    """
)


# -----------------------------
# Routes
# -----------------------------
@router.get("/contacts")
def list_organizer_contacts(
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        rows = (
            db.execute(
                SELECT_CONTACTS_SQL,
                {"organizer_id": current_user.id},
            )
            .mappings()
            .all()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load organizer contacts: {exc.__class__.__name__}",
        ) from exc

    contacts: list[OrganizerContactOut] = [
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
        for row in rows
    ]

    return {"value": contacts, "Count": len(contacts)}


@router.post("/contacts", response_model=OrganizerContactOut)
def create_organizer_contact(
    payload: OrganizerContactCreate,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")

    params = {
        "organizer_id": current_user.id,
        "name": payload.name.strip(),
        "email": payload.email,
        "phone": payload.phone,
        "company": payload.company,
        "notes": payload.notes,
        "tags": normalize_tags(payload.tags),
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


@router.patch("/contacts/{contact_id}", response_model=OrganizerContactOut)
def update_organizer_contact(
    contact_id: int,
    payload: OrganizerContactUpdate,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Pydantic v2 vs v1 compatibility
    if hasattr(payload, "model_dump"):
        data = payload.model_dump(exclude_unset=True)
    else:
        data = payload.dict(exclude_unset=True)

    # If empty PATCH, just return current row (handy for UI refresh)
    if not data:
        row = (
            db.execute(
                SELECT_ONE_CONTACT_SQL,
                {"id": contact_id, "organizer_id": current_user.id},
            )
            .mappings()
            .first()
        )

        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

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

    # Validate name if provided
    if "name" in data and (data["name"] is None or str(data["name"]).strip() == ""):
        raise HTTPException(status_code=422, detail="name cannot be blank")

    # Normalize tags if provided (allow clearing via null)
    if "tags" in data:
        raw = data["tags"]
        data["tags"] = normalize_tags(raw)  # will return [] if None or empty

    # Build dynamic SET clause
    set_clauses: list[str] = []
    params: dict = {"id": contact_id, "organizer_id": current_user.id}

    for k, v in data.items():
        set_clauses.append(f"{k} = :{k}")
        params[k] = v

    sql = text(
        f"""
        UPDATE organizer_contacts
        SET {", ".join(set_clauses)}
        WHERE id = :id AND organizer_id = :organizer_id
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
    )

    # ✅ Critical: If tags is being updated, force JSONB binding to prevent psycopg2 ProgrammingError
    if "tags" in params:
        sql = sql.bindparams(bindparam("tags", type_=JSONB))

    try:
        row = db.execute(sql, params).mappings().first()
        if not row:
            db.rollback()
            raise HTTPException(status_code=404, detail="Contact not found")
        db.commit()

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

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        # keep the message stable for the UI while still indicating the class
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update organizer contact: {exc.__class__.__name__}",
        ) from exc


@router.post("/contacts/import")
def import_organizer_contacts(
    payload: OrganizerContactsImportRequest,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.contacts:
        return {"value": [], "Count": 0}

    created: list[OrganizerContactOut] = []

    try:
        for contact in payload.contacts:
            if not contact.name or not contact.name.strip():
                continue

            params = {
                "organizer_id": current_user.id,
                "name": contact.name.strip(),
                "email": contact.email,
                "phone": contact.phone,
                "company": contact.company,
                "notes": contact.notes,
                "tags": normalize_tags(contact.tags),
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
