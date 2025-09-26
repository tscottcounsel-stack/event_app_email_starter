from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.models import models, schemas
from backend.config.database import get_db

router = APIRouter(prefix="/vendors", tags=["vendors"])

# ✅ Create a new vendor profile
@router.post("/", response_model=schemas.VendorProfileOut)
def create_vendor(vendor: schemas.VendorProfileCreate, db: Session = Depends(get_db)):
    db_vendor = models.VendorProfile(
        display_name=vendor.display_name,
        company_name=vendor.company_name,
        phone=vendor.phone,
        location=vendor.location,
        services=vendor.services,
        categories=vendor.categories,
        rate_min=vendor.rate_min,
        rate_max=vendor.rate_max,
        bio=vendor.bio,
        availability_notes=vendor.availability_notes,
        user_id=1  # 🔧 placeholder until user auth is added
    )
    db.add(db_vendor)
    db.commit()
    db.refresh(db_vendor)
    return db_vendor


# ✅ List all vendors
@router.get("/all", response_model=List[schemas.VendorProfileOut])
def list_vendors(db: Session = Depends(get_db)):
    return db.query(models.VendorProfile).all()


# ✅ Get one vendor by ID
@router.get("/{vendor_id}", response_model=schemas.VendorProfileOut)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.query(models.VendorProfile).filter(models.VendorProfile.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


# ✅ Delete a vendor
@router.delete("/{vendor_id}")
def delete_vendor(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.query(models.VendorProfile).filter(models.VendorProfile.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db.delete(vendor)
    db.commit()
    return {"message": f"Vendor {vendor_id} deleted successfully"}
