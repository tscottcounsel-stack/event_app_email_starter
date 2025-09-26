# app/schemas.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from enum import Enum

# ---------- Vendor ----------
class VendorCreate(BaseModel):
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None

class VendorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

# ---------- Event ----------
class EventCreate(BaseModel):
    title: str
    starts_at: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None

class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    starts_at: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime

# ---------- Application ----------
class ApplicationStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class ApplicationCreate(BaseModel):
    event_id: int
    vendor_id: int
    status: ApplicationStatus = ApplicationStatus.pending
    notes: Optional[str] = None

class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_id: int
    vendor_id: int
    status: ApplicationStatus
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
app/routers/vendors.py
python
Copy code
# app/routers/vendors.py
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db import get_db
from app.models.vendor import Vendor
from app.schemas import VendorCreate, VendorRead

router = APIRouter(prefix="/vendors", tags=["vendors"])

@router.post("", response_model=VendorRead, status_code=status.HTTP_201_CREATED)
def create_vendor(payload: VendorCreate, db: Session = Depends(get_db)):
    v = Vendor(**payload.model_dump())
    db.add(v)
    db.commit()
    db.refresh(v)
    return v

@router.get("", response_model=List[VendorRead])
def list_vendors(db: Session = Depends(get_db)):
    return db.query(Vendor).order_by(Vendor.id.desc()).limit(100).all()

@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    v = db.get(Vendor, vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v
