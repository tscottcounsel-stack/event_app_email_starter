import random
from typing import List, Optional

# search.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from backend.deps import current_user, get_current_user
from database import get_db
from models import User, VendorProfile
from schemas import VendorProfileOut

router = APIRouter(prefix="/search", tags=["Search"])


# ---- JWT-protected search (requires login) ----
@router.get("/vendors", response_model=List[VendorProfileOut])
def search_vendors(
    services: Optional[str] = Query(None),
    categories: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    min_rate: Optional[float] = Query(None),
    max_rate: Optional[float] = Query(None),
    db: Session = Depends(get_db),
    _current: User = Depends(current_user),
):
    q = db.query(VendorProfile)

    if services:
        for keyword in services.split(","):
            q = q.filter(VendorProfile.services.ilike(f"%{keyword.strip()}%"))

    if categories:
        for keyword in categories.split(","):
            q = q.filter(VendorProfile.categories.ilike(f"%{keyword.strip()}%"))

    if location:
        q = q.filter(VendorProfile.location.ilike(f"%{location}%"))

    if min_rate is not None:
        q = q.filter(VendorProfile.rate_min >= min_rate)

    if max_rate is not None:
        q = q.filter(VendorProfile.rate_max <= max_rate)

    return q.limit(50).all()


# ---- Public search (no login required) ----
@router.get("/vendors/public", response_model=List[VendorProfileOut])
def search_vendors_public(
    services: Optional[str] = Query(None),
    categories: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    min_rate: Optional[float] = Query(None),
    max_rate: Optional[float] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(VendorProfile)

    if services:
        for keyword in services.split(","):
            q = q.filter(VendorProfile.services.ilike(f"%{keyword.strip()}%"))

    if categories:
        for keyword in categories.split(","):
            q = q.filter(VendorProfile.categories.ilike(f"%{keyword.strip()}%"))

    if location:
        q = q.filter(VendorProfile.location.ilike(f"%{location}%"))

    if min_rate is not None:
        q = q.filter(VendorProfile.rate_min >= min_rate)

    if max_rate is not None:
        q = q.filter(VendorProfile.rate_max <= max_rate)

    return q.limit(50).all()


# ---- Featured vendors (public) ----
@router.get("/vendors/featured", response_model=List[VendorProfileOut])
def featured_vendors(
    mode: str = Query("random", description="Choose 'random' or 'cheap'"),
    category: Optional[str] = Query(
        None, description="Filter featured vendors by category"
    ),
    count: int = Query(3, ge=1, le=10, description="Number of vendors to return"),
    db: Session = Depends(get_db),
):
    """
    Get featured vendors for landing pages:
    - mode=random → returns `count` random vendors
    - mode=cheap → returns `count` vendors with lowest min_rate
    - category=... → filter by vendor category first
    """
    q = db.query(VendorProfile)

    if category:
        q = q.filter(VendorProfile.categories.ilike(f"%{category}%"))

    vendors = q.all()
    if not vendors:
        return []

    if mode == "cheap":
        vendors_sorted = sorted(vendors, key=lambda v: v.rate_min or float("inf"))
        return vendors_sorted[:count]

    # Default: random
    return random.sample(vendors, min(count, len(vendors)))
