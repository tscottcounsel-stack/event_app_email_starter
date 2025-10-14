from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ApplicationCreate(BaseModel):
    event_id: int = Field(..., ge=1)
    note: Optional[str] = Field(None, max_length=2000)
    price_cents: int = Field(..., ge=0)


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # (aka orm_mode=True in v1)

    id: int
    event_id: int
    vendor_id: int
    note: Optional[str]
    price_cents: int
    status: str
    created_at: datetime
    updated_at: datetime
