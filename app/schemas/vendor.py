# app/schemas/vendor.py
from __future__ import annotations

from pydantic import BaseModel, Field


class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=50)
    description: str | None = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    category: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=50)
    description: str | None = None


class VendorRead(VendorBase):
    id: int
    created_at: str | None = None
    updated_at: str | None = None
