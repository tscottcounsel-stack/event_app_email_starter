from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from .vendor import VendorCreate, VendorRead, VendorUpdate


# â”€â”€ Vendors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class VendorCreate(BaseModel):
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None


class VendorRead(BaseModel):
    id: int
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# â”€â”€ Applications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_ALLOWED_STATUSES = {"pending", "submitted", "approved", "declined"}


class ApplicationCreate(BaseModel):
    event_id: int
    vendor_id: int
    desired_location: Optional[str] = None
    notes: Optional[str] = None


class ApplicationPatch(BaseModel):
    status: Optional[str] = None
    price_cents: Optional[int] = Field(default=None, ge=0)
    desired_location: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: Optional[str]):
        if v is None:
            return v
        if v not in _ALLOWED_STATUSES:
            raise ValueError(f"status must be one of {sorted(_ALLOWED_STATUSES)}")
        return v


class ApplicationRead(BaseModel):
    id: int
    event_id: int
    vendor_id: int
    price_cents: Optional[int] = None
    status: str
    desired_location: Optional[str] = None
    notes: Optional[str] = None
    payment_ref: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
