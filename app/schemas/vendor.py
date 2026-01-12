# app/schemas/vendor.py
from __future__ import annotations

from pydantic import BaseModel, Field


class VendorBase(BaseModel):
    # Existing basic fields
    name: str = Field(..., min_length=1, max_length=200)
    category: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=50)
    description: str | None = None

    # NEW: story + checklist + categories
    vendor_story: str | None = None
    # e.g. ["insured", "licensed", "returning_vendor"]
    checklist_tags: list[str] | None = None
    # e.g. ["Food", "Desserts", "Beverages"]
    vendor_categories: list[str] | None = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    category: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=50)
    description: str | None = None

    vendor_story: str | None = None
    checklist_tags: list[str] | None = None
    vendor_categories: list[str] | None = None


class VendorRead(VendorBase):
    id: int
    created_at: str | None = None
    updated_at: str | None = None
