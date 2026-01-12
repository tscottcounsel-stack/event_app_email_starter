# app/routers/vendors.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.db import get_db

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("")
def list_vendors(db: Session = Depends(get_db)):
    # Your real table is vendor_profiles, not vendors
    return db.query(models.VendorProfile).order_by(models.VendorProfile.id.asc()).all()


@router.get("/{vendor_profile_id}")
def get_vendor(vendor_profile_id: int, db: Session = Depends(get_db)):
    vp = (
        db.query(models.VendorProfile)
        .filter(models.VendorProfile.id == vendor_profile_id)
        .first()
    )
    if not vp:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vp
