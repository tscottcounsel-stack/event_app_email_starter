# backend/schemas/vendor.py
from typing import Optional
from pydantic import BaseModel, ConfigDict


class VendorBase(BaseModel):
    business_name: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None


class VendorCreate(VendorBase):
    """Payload used when creating a vendor profile."""
    pass


class VendorRead(VendorBase):
    """Response model returned for vendor resources."""
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)
