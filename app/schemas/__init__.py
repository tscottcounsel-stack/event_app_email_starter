from __future__ import annotations
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict

# ── Vendor ─────────────────────────────────────────────────────────────────────
class VendorBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: Optional[str] = None

class VendorBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None

class VendorCreate(VendorBase):
    pass

class VendorUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: Optional[str] = None
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None

class VendorRead(VendorBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# ── Event ──────────────────────────────────────────────────────────────────────
class EventBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str
    organizer_id: int
    date: datetime
    location: str
    description: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None

class EventCreate(EventBase):
    pass

class EventUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    # all optional for PATCH
    title: Optional[str] = None
    organizer_id: Optional[int] = None
    date: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None

class EventRead(EventBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# ── Application ────────────────────────────────────────────────────────────────
class ApplicationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    event_id: int
    vendor_id: int
    price_cents: Optional[int] = None
    status: Optional[str] = "submitted"
    notes: Optional[str] = None

class ApplicationCreate(ApplicationBase):
    pass

class ApplicationUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    price_cents: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class ApplicationRead(ApplicationBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    vendor: Optional[VendorBrief] = None  # included in list/detail responses
