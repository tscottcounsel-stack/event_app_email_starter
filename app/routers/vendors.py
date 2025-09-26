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
    v = Vendor(**payload.model_dump()); db.add(v); db.commit(); db.refresh(v); return v

@router.get("", response_model=List[VendorRead])
def list_vendors(db: Session = Depends(get_db)):
    return db.query(Vendor).order_by(Vendor.id.desc()).limit(100).all()

@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    v = db.get(Vendor, vendor_id)
    if not v: raise HTTPException(status_code=404, detail="Vendor not found")
    return v
