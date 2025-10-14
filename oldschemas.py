# backend/models/schemas.py

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr


# ==============================
# USER SCHEMAS
# ==============================
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: str  # "vendor" or "organizer"


class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ==============================
# TOKEN SCHEMA
# ==============================
class Token(BaseModel):
    access_token: str


# ==============================
# VENDOR PROFILE SCHEMAS
# ==============================
class VendorProfileBase(BaseModel):
    display_name: str
    company_name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    services: Optional[str] = None
    categories: Optional[str] = None
    rate_min: Optional[float] = None
    rate_max: Optional[float] = None
    bio: Optional[str] = None
    availability_notes: Optional[str] = None


class VendorProfileCreate(VendorProfileBase):
    pass


class VendorProfileOut(VendorProfileBase):
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)


# ==============================
# ORGANIZER PROFILE SCHEMAS
# ==============================
class OrganizerProfileBase(BaseModel):
    display_name: str
    organization_name: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    location: Optional[str] = None
    preferred_categories: Optional[str] = None
    bio: Optional[str] = None


class OrganizerProfileCreate(OrganizerProfileBase):
    pass


class OrganizerProfileOut(OrganizerProfileBase):
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)


# ==============================
# EVENT SCHEMAS
# ==============================
class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    date: datetime
    location: str
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None


class EventOut(EventCreate):
    id: int
    organizer_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ==============================
# APPLICATION SCHEMAS
# ==============================
class ApplicationCreate(BaseModel):
    event_id: int
    vendor_id: int  # ✅ required so we know which vendor applied
    message: Optional[str] = None


class ApplicationOut(BaseModel):
    id: int
    event_id: int
    vendor_id: int
    status: str
    message: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
