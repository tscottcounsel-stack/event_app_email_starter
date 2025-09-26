# backend/routers/vendors.py
from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.deps import require_vendor, require_organizer, SimpleUser

router = APIRouter(prefix="/vendors", tags=["vendors"])

# ---------------------------
# Models
# ---------------------------
class VendorCreate(BaseModel):
    display_name: str = Field(min_length=1)
    bio: Optional[str] = ""
    website: Optional[str] = None
    contact_email: Optional[str] = None

class VendorUpdate(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    website: Optional[str] = None
    contact_email: Optional[str] = None

class VendorRead(BaseModel):
    id: int                 # vendor id (== user.id here)
    user_id: int
    email: str
    display_name: str
    bio: Optional[str] = ""
    website: Optional[str] = None
    contact_email: Optional[str] = None
    logo_url: Optional[str] = None

# ---------------------------
# In-memory store
# ---------------------------
_VENDORS: Dict[int, VendorRead] = {}  # key: user_id

def _reset_vendors() -> None:
    """Used by cleanup/test hook."""
    _VENDORS.clear()

def _get_vendor_or_none(vid: int) -> Optional[VendorRead]:
    return _VENDORS.get(vid)

# ---------------------------
# Endpoints
# ---------------------------

@router.post("/", response_model=VendorRead)
def create_or_upsert_vendor(payload: VendorCreate, user: SimpleUser = Depends(require_vendor)):
    """
    Create (201) if not exists; otherwise update (200).
    Vendor id == user.id for simplicity.
    """
    first_time = user.id not in _VENDORS
    if first_time:
        vr = VendorRead(
            id=user.id,
            user_id=user.id,
            email=user.email,
            display_name=payload.display_name.strip(),
            bio=(payload.bio or "").strip(),
            website=payload.website,
            contact_email=payload.contact_email,
            logo_url=None,
        )
        _VENDORS[user.id] = vr
        return JSONResponse(content=vr.model_dump(), status_code=status.HTTP_201_CREATED)

    # Upsert path (update existing)
    existing = _VENDORS[user.id]
    updated = existing.model_copy(
        update={
            "display_name": payload.display_name.strip(),
            "bio": (payload.bio or "").strip(),
            "website": payload.website,
            "contact_email": payload.contact_email,
        }
    )
    _VENDORS[user.id] = updated
    return updated  # 200 OK


@router.get("/me", response_model=VendorRead)
def get_my_vendor(user: SimpleUser = Depends(require_vendor)):
    vr = _get_vendor_or_none(user.id)
    if not vr:
        raise HTTPException(status_code=404, detail="Vendor profile not found")
    return vr


@router.patch("/", response_model=VendorRead)
def update_vendor(payload: VendorUpdate, user: SimpleUser = Depends(require_vendor)):
    vr = _get_vendor_or_none(user.id)
    if not vr:
        raise HTTPException(status_code=404, detail="Vendor profile not found")

    changes: Dict[str, object] = {}
    if payload.display_name is not None:
        name = payload.display_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="display_name cannot be empty")
        changes["display_name"] = name
    if payload.bio is not None:
        changes["bio"] = (payload.bio or "").strip()
    if payload.website is not None:
        changes["website"] = payload.website
    if payload.contact_email is not None:
        changes["contact_email"] = payload.contact_email

    vr = vr.model_copy(update=changes)
    _VENDORS[user.id] = vr
    return vr


@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: int):
    # Public read; switch to organizer-only if you prefer.
    vr = _get_vendor_or_none(vendor_id)
    if not vr:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vr


@router.get("/", response_model=list[VendorRead])
def list_vendors(_=Depends(require_organizer)):
    return list(_VENDORS.values())


# ---------------------------
# File upload: logo
# ---------------------------
UPLOAD_DIR = Path("uploads/vendors")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/logo", response_model=VendorRead)
def upload_logo(file: UploadFile = File(...), user: SimpleUser = Depends(require_vendor)):
    vr = _get_vendor_or_none(user.id)
    if not vr:
        raise HTTPException(status_code=404, detail="Vendor profile not found")

    safe_name = f"vendor_{user.id}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    with dest.open("wb") as f:
        f.write(file.file.read())

    vr = vr.model_copy(update={"logo_url": str(dest)})
    _VENDORS[user.id] = vr
    return vr
