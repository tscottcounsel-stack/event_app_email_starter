# app/routers/organizer_events.py
from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.auth import require_organizer
from app.db import get_db
from app.models import Event

router = APIRouter(prefix="/organizer", tags=["organizer-events"])


# ---------------------------
# Schemas
# ---------------------------


class OrganizerEventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    date: Union[datetime, date]
    location: Optional[str] = None
    city: Optional[str] = None
    kind: str = "general"
    business_only: bool = False
    badge_required: bool = False
    max_vendor_slots: int = 0

    @field_validator("date", mode="before")
    @classmethod
    def normalize_date(cls, v: Any):
        if isinstance(v, date) and not isinstance(v, datetime):
            return datetime.combine(v, datetime.min.time())
        return v


class OrganizerEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[Union[datetime, date]] = None
    location: Optional[str] = None
    city: Optional[str] = None
    kind: Optional[str] = None
    business_only: Optional[bool] = None
    badge_required: Optional[bool] = None
    max_vendor_slots: Optional[int] = None

    @field_validator("date", mode="before")
    @classmethod
    def normalize_date(cls, v: Any):
        if isinstance(v, date) and not isinstance(v, datetime):
            return datetime.combine(v, datetime.min.time())
        return v


class OrganizerEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: Optional[str] = None
    date: datetime
    location: Optional[str] = None
    city: Optional[str] = None
    kind: str
    business_only: bool
    badge_required: bool
    max_vendor_slots: int = 0

    @field_validator("max_vendor_slots", mode="before")
    @classmethod
    def coerce_max_slots(cls, v):
        # DB may contain NULLs from older seed data
        return 0 if v is None else v

    @field_validator("date", mode="before")
    @classmethod
    def coerce_date(cls, v: Any) -> Any:
        """
        Fix legacy/non-ISO strings coming back from DB/driver like:
          '2025-11-20 13:11:21.002566-05'
        Pydantic expects ISO 8601. We normalize to:
          '2025-11-20T13:11:21.002566-05:00'
        """
        if isinstance(v, datetime):
            return v

        if isinstance(v, date) and not isinstance(v, datetime):
            return datetime.combine(v, datetime.min.time())

        if isinstance(v, str):
            s = v.strip()

            # Replace first space with 'T' if needed
            if " " in s and "T" not in s:
                s = s.replace(" ", "T", 1)

            # Normalize timezone endings:
            #  -05      -> -05:00
            #  -0500    -> -05:00
            #  +0330    -> +03:30
            if len(s) >= 3 and (s[-3] in ["+", "-"] and s[-2:].isdigit()):
                s = s + ":00"
            elif len(s) >= 5 and (s[-5] in ["+", "-"] and s[-4:].isdigit()):
                s = s[:-2] + ":" + s[-2:]

            return datetime.fromisoformat(s)

        return v


# ---------------------------
# Routes
# ---------------------------


@router.get("/events", response_model=List[OrganizerEventOut])
def list_organizer_events(
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    # organizer.organizer_id is organizer_profiles.id
    return (
        db.query(Event)
        .filter(Event.organizer_id == organizer.organizer_id)
        .order_by(Event.date.desc())
        .all()
    )


@router.post(
    "/events", response_model=OrganizerEventOut, status_code=status.HTTP_201_CREATED
)
def create_organizer_event(
    payload: OrganizerEventCreate,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    e = Event(
        title=payload.title,
        description=payload.description,
        date=payload.date,
        location=payload.location,
        city=payload.city,
        kind=payload.kind or "general",
        business_only=payload.business_only,
        badge_required=payload.badge_required,
        max_vendor_slots=payload.max_vendor_slots,
        organizer_id=organizer.organizer_id,
    )

    try:
        db.add(e)
        db.commit()
        db.refresh(e)
    except Exception as ex:
        db.rollback()
        print("[organizer_events] create failed:", repr(ex))
        raise HTTPException(500, detail="Failed to create event")

    return e


@router.get("/events/{event_id}", response_model=OrganizerEventOut)
def get_organizer_event(
    event_id: int,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    e = (
        db.query(Event)
        .filter(Event.id == event_id, Event.organizer_id == organizer.organizer_id)
        .first()
    )
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    return e


@router.patch("/events/{event_id}", response_model=OrganizerEventOut)
def update_organizer_event(
    event_id: int,
    payload: OrganizerEventUpdate,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    e = (
        db.query(Event)
        .filter(Event.id == event_id, Event.organizer_id == organizer.organizer_id)
        .first()
    )
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(e, field, value)

    try:
        db.commit()
        db.refresh(e)
    except Exception as ex:
        db.rollback()
        print("[organizer_events] update failed:", repr(ex))
        raise HTTPException(500, detail="Failed to update event")

    return e


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organizer_event(
    event_id: int,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    e = (
        db.query(Event)
        .filter(Event.id == event_id, Event.organizer_id == organizer.organizer_id)
        .first()
    )
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    try:
        db.delete(e)
        db.commit()
    except Exception as ex:
        db.rollback()
        print("[organizer_events] delete failed:", repr(ex))
        raise HTTPException(500, detail="Failed to delete event")

    return None
