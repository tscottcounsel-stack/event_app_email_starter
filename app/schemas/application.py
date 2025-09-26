from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, conint, constr


class ApplicationBase(BaseModel):
    note: Optional[constr(max_length=2000)] = None
    price_cents: conint(ge=0) = Field(
        ...,
        description="Price in cents, must be >= 0",
        examples=[50000],
    )


class ApplicationCreate(ApplicationBase):
    event_id: int = Field(..., description="Target event id", examples=[1])


class ApplicationRead(ApplicationBase):
    id: int
    event_id: int
    vendor_id: int
    status: Literal["submitted", "under_review", "accepted", "rejected"]
    created_at: datetime
    updated_at: datetime

    # Pydantic v2: allow ORM objects
    model_config = {"from_attributes": True}


class ApplicationSetStatus(BaseModel):
    status: Literal["submitted", "under_review", "accepted", "rejected"]


class ApplicationVendorUpdate(BaseModel):
    note: Optional[constr(max_length=2000)] = None
    price_cents: Optional[conint(ge=0)] = None
