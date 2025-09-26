from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# -----------------------
# Shared / Enums
# -----------------------

class ApplicationStatus(str, Enum):
    submitted = "submitted"   # DB default
    pending   = "pending"
    approved  = "approved"
    rejected  = "rejected"


# -----------------------
# Vendor
# -----------------------

class VendorBase(BaseModel):
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None


class VendorRead(VendorBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # Include these only if your table has them mapped on the model;
    # keep Optional to tolerate NULLs.
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# -----------------------
# Event
# -----------------------

class EventBase(BaseModel):
    title: str
    organizer_id: int                # FK to users.id
    date: datetime                   # timestamp without time zone
    location: str
    description: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: Optional[str] = None
    organizer_id: Optional[int] = None
    date: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None


class EventRead(EventBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# -----------------------
# Application
# -----------------------

class ApplicationBase(BaseModel):
    event_id: int
    vendor_id: int
    # Non-negative cents (e.g., 25000 == $250.00)
    price_cents: int = Field(ge=0)
    status: ApplicationStatus = ApplicationStatus.submitted
    notes: Optional[str] = None


class ApplicationCreate(ApplicationBase):
    pass


class ApplicationUpdate(BaseModel):
    price_cents: Optional[int] = Field(default=None, ge=0)
    status: Optional[ApplicationStatus] = None
    notes: Optional[str] = None


class ApplicationRead(ApplicationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


__all__ = [
    # Vendors
    "VendorCreate",
    "VendorUpdate",
    "VendorRead",
    # Events
    "EventCreate",
    "EventUpdate",
    "EventRead",
    # Applications
    "ApplicationCreate",
    "ApplicationUpdate",
    "ApplicationRead",
    "ApplicationStatus",
]
