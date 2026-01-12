# app/routers/organizer_event_invites.py
#
# Organizer event invites API
#
# - GET  /organizer/events/{event_id}/invites
#       List all invites for this event (for the logged-in organizer)
#
# - POST /organizer/events/{event_id}/invites
#       Create or update an invite for a contact
#
# Backing tables:
#   - events              (id, organizer_id, ...)
#   - organizer_contacts  (id, organizer_id, name, email, phone, company, notes, tags jsonb)
#   - event_invites       (id, event_id, contact_id, status, notes, created_at)
#
# Response shape mirrors the organizer contacts list:
#   { "value": [ ...EventInviteOut... ], "Count": <int> }

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.auth import AuthUser, get_current_user
from app.database import SessionLocal

router = APIRouter(prefix="/organizer", tags=["organizer_event_invites"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class EventInviteBase(BaseModel):
    status: str = Field(
        "invited",
        max_length=20,
        description="Invite status: invited, confirmed, declined, etc.",
    )
    notes: Optional[str] = Field(
        None,
        description="Optional notes about this invite (VIP, sponsor, etc.).",
    )


class EventInviteCreate(EventInviteBase):
    contact_id: int = Field(..., description="ID from organizer_contacts.id")


class EventInviteOut(EventInviteBase):
    id: int
    event_id: int
    contact_id: int
    created_at: Optional[datetime] = None

    # Denormalized contact info
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_company: Optional[str] = None
    contact_tags: List[str] = Field(default_factory=list)


class EventInviteList(BaseModel):
    value: List[EventInviteOut]
    Count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_invite(row: dict) -> EventInviteOut:
    """Convert a DB row to EventInviteOut."""
    # tags column from organizer_contacts is jsonb; normalize to list[str]
    raw_tags = row.get("contact_tags")
    if isinstance(raw_tags, list):
        tags_list = raw_tags
    elif raw_tags is None:
        tags_list = []
    else:
        # If DB returns it as a JSON string for any reason
        try:
            import json

            tags_parsed = json.loads(raw_tags)
            tags_list = tags_parsed if isinstance(tags_parsed, list) else []
        except Exception:
            tags_list = []

    return EventInviteOut(
        id=row["id"],
        event_id=row["event_id"],
        contact_id=row["contact_id"],
        status=row["status"],
        notes=row["notes"],
        created_at=row.get("created_at"),
        contact_name=row.get("contact_name"),
        contact_email=row.get("contact_email"),
        contact_phone=row.get("contact_phone"),
        contact_company=row.get("contact_company"),
        contact_tags=tags_list,
    )


def _ensure_event_belongs_to_organizer(db, event_id: int, organizer_id: int) -> None:
    """Raise 404 if the event doesn't exist or doesn't belong to this organizer."""
    sql = text(
        """
        SELECT id
        FROM events
        WHERE id = :event_id
          AND organizer_id = :oid
        """
    )
    row = (
        db.execute(sql, {"event_id": event_id, "oid": organizer_id}).mappings().first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found for this organizer.",
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get(
    "/events/{event_id}/invites",
    response_model=EventInviteList,
    summary="List invites for an event",
)
def list_event_invites(
    event_id: int,
    current_user: AuthUser = Depends(get_current_user),
):
    """
    Return all invites for this event for the logged-in organizer.

    For now we assume only organizers will call this endpoint.
    """
    db = SessionLocal()
    try:
        # Optional: enforce organizer-only access
        if getattr(current_user, "role", None) != "organizer":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organizer access required.",
            )

        _ensure_event_belongs_to_organizer(db, event_id, current_user.id)

        sql = text(
            """
            SELECT
                ei.id,
                ei.event_id,
                ei.contact_id,
                ei.status,
                ei.notes,
                ei.created_at,
                oc.name   AS contact_name,
                oc.email  AS contact_email,
                oc.phone  AS contact_phone,
                oc.company AS contact_company,
                oc.tags   AS contact_tags
            FROM event_invites AS ei
            JOIN organizer_contacts AS oc
              ON oc.id = ei.contact_id
            WHERE ei.event_id = :event_id
            ORDER BY ei.created_at DESC, ei.id DESC
            """
        )

        rows = db.execute(sql, {"event_id": event_id}).mappings().all()
        invites = [_row_to_invite(row) for row in rows]

        return EventInviteList(value=invites, Count=len(invites))

    finally:
        db.close()


@router.post(
    "/events/{event_id}/invites",
    response_model=EventInviteOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create or update an invite for a contact",
)
def create_or_update_event_invite(
    event_id: int,
    payload: EventInviteCreate,
    current_user: AuthUser = Depends(get_current_user),
):
    """
    Create an invite for a contact for this event.

    If an invite already exists for the same (event_id, contact_id),
    we update its status + notes instead of inserting a duplicate.
    """
    db = SessionLocal()
    try:
        # Organizer-only guard
        if getattr(current_user, "role", None) != "organizer":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organizer access required.",
            )

        # Ensure the event belongs to this organizer
        _ensure_event_belongs_to_organizer(db, event_id, current_user.id)

        # Ensure the contact belongs to this organizer as well
        contact_sql = text(
            """
            SELECT id
            FROM organizer_contacts
            WHERE id = :cid
              AND organizer_id = :oid
            """
        )
        contact_row = (
            db.execute(
                contact_sql,
                {"cid": payload.contact_id, "oid": current_user.id},
            )
            .mappings()
            .first()
        )
        if not contact_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Contact not found for this organizer.",
            )

        # Insert / update invite
        upsert_sql = text(
            """
            INSERT INTO event_invites (event_id, contact_id, status, notes)
            VALUES (:event_id, :contact_id, :status, :notes)
            ON CONFLICT (event_id, contact_id)
            DO UPDATE SET
                status = EXCLUDED.status,
                notes  = EXCLUDED.notes
            RETURNING
                id,
                event_id,
                contact_id,
                status,
                notes,
                created_at
            """
        )

        upsert_row = (
            db.execute(
                upsert_sql,
                {
                    "event_id": event_id,
                    "contact_id": payload.contact_id,
                    "status": payload.status,
                    "notes": payload.notes,
                },
            )
            .mappings()
            .first()
        )

        # Join back to contact for denormalized info
        join_sql = text(
            """
            SELECT
                ei.id,
                ei.event_id,
                ei.contact_id,
                ei.status,
                ei.notes,
                ei.created_at,
                oc.name   AS contact_name,
                oc.email  AS contact_email,
                oc.phone  AS contact_phone,
                oc.company AS contact_company,
                oc.tags   AS contact_tags
            FROM event_invites AS ei
            JOIN organizer_contacts AS oc
              ON oc.id = ei.contact_id
            WHERE ei.id = :invite_id
            """
        )
        final_row = (
            db.execute(join_sql, {"invite_id": upsert_row["id"]}).mappings().first()
        )

        db.commit()

        return _row_to_invite(final_row)

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create or update invite: {type(e).__name__}",
        )
    finally:
        db.close()
