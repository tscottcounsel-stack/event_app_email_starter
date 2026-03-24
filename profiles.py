# profiles.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user
from backend.deps import current_user, get_current_user
from database import Base, engine, get_db
from models import OrganizerProfile, User, UserRole, VendorProfile
from schemas import (
    OrganizerProfileIn,
    OrganizerProfileOut,
    VendorProfileIn,
    VendorProfileOut,
)

# Ensure tables exist
Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/profiles", tags=["Profiles"])


# --- Helpers ---
def require_vendor(current: User = Depends(current_user)) -> User:
    if current.role != UserRole.vendor:
        raise HTTPException(status_code=403, detail="Vendor role required")
    return current


def require_organizer(current: User = Depends(current_user)) -> User:
    if current.role != UserRole.organizer:
        raise HTTPException(status_code=403, detail="Organizer role required")
    return current


# --- Vendor Profile Endpoints ---
@router.get("/vendor/me", response_model=VendorProfileOut)
def get_my_vendor_profile(
    current: User = Depends(require_vendor), db: Session = Depends(get_db)
):
    prof = db.query(VendorProfile).filter(VendorProfile.user_id == current.id).first()
    if not prof:
        raise HTTPException(status_code=404, detail="Vendor profile not found")
    return prof


@router.put("/vendor/me", response_model=VendorProfileOut)
def upsert_my_vendor_profile(
    payload: VendorProfileIn,
    current: User = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    prof = db.query(VendorProfile).filter(VendorProfile.user_id == current.id).first()
    if not prof:
        prof = VendorProfile(user_id=current.id, **payload.dict())
        db.add(prof)
    else:
        for k, v in payload.dict().items():
            setattr(prof, k, v)
    db.commit()
    db.refresh(prof)
    return prof


# --- Organizer Profile Endpoints ---
@router.get("/organizer/me", response_model=OrganizerProfileOut)
def get_my_organizer_profile(
    current: User = Depends(require_organizer), db: Session = Depends(get_db)
):
    prof = (
        db.query(OrganizerProfile)
        .filter(OrganizerProfile.user_id == current.id)
        .first()
    )
    if not prof:
        raise HTTPException(status_code=404, detail="Organizer profile not found")
    return prof


@router.put("/organizer/me", response_model=OrganizerProfileOut)
def upsert_my_organizer_profile(
    payload: OrganizerProfileIn,
    current: User = Depends(require_organizer),
    db: Session = Depends(get_db),
):
    prof = (
        db.query(OrganizerProfile)
        .filter(OrganizerProfile.user_id == current.id)
        .first()
    )
    if not prof:
        prof = OrganizerProfile(user_id=current.id, **payload.dict())
        db.add(prof)
    else:
        for k, v in payload.dict().items():
            setattr(prof, k, v)
    db.commit()
    db.refresh(prof)
    return prof
