# app/schemas/events.py
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class EventBase(BaseModel):
    """
    Shared fields (response-safe).
    """

    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    date: str

    # keep these here so response objects can include them
    kind: str = "general"
    business_only: bool = False
    badge_required: bool = False

    max_vendor_slots: Optional[int] = None

    # Capacity fields (present in model; UI contract may not use yet)
    total_vendor_capacity: Optional[int] = None
    category_vendor_capacity: Optional[List[dict]] = None


class EventCreate(BaseModel):
    """
    Organizer event create payload.

    Keep it simple and aligned with DB:
    - title required
    - date required (DB column is NOT NULL)
    - kind defaults to 'general'
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1)
    date: str = Field(
        ..., min_length=1, description="YYYY-MM-DD (stored as string/VARCHAR)"
    )
    description: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None

    max_vendor_slots: Optional[int] = None

    # Optional “extended” fields if you create events with these later
    kind: str = Field(default="general")
    business_only: bool = Field(default=False)
    badge_required: bool = Field(default=False)

    total_vendor_capacity: Optional[int] = None
    category_vendor_capacity: Optional[List[dict]] = None


class EventUpdate(BaseModel):
    """
    PATCH semantics: only fields provided are updated.

    Locked contract fields:
      - title
      - description
      - location
      - date

    Back-compat aliases (DIAGRAM_CONTRACT addendum):
      - name -> title
      - venue -> location
      - start_date -> date
    """

    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    date: Optional[str] = None

    # accepted aliases (mapped in router)
    name: Optional[str] = None
    venue: Optional[str] = None
    start_date: Optional[str] = None


class EventPublic(EventBase):
    """
    Response model.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    organizer_id: int
    created_at: datetime
    updated_at: datetime
