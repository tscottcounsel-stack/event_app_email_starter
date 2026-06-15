from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class Vendor(BaseModel):
    vendor_id: str = ""
    business_name: str = ""
    email: str = ""
    phone: str = ""
    description: str = ""
    categories: List[str] = Field(default_factory=list)
    website: str = ""
    instagram: str = ""
    facebook: str = ""
    logo_url: str = ""
    banner_url: str = ""
    contact_name: str = ""
