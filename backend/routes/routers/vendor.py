from pathlib import Path
from typing import Dict, List
from uuid import uuid4
import shutil

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from fastapi.security import OAuth2PasswordBearer

from backend.security.auth import decode_access_token
from backend.models.schemas import (
    VendorCreateIn, VendorOut,
    VendorProfileBase, VendorProfileUpdate, VendorProfileOut
)

router = APIRouter()

# -------------------------
# Minimal vendor CRUD (in-memory, for demo/tests)
# -------------------------
_VENDORS: Dict[int, VendorOut] = {}
_NEXT_VENDOR_ID = 1

@router.post("/", response_model=VendorOut, summary="Create a vendor (demo)")
def create_vendor(payload: VendorCreateIn):
    global _NEXT_VENDOR_ID
    vid = _NEXT_VENDOR_ID
    _NEXT_VENDOR_ID += 1
    vendor = VendorOut(id=vid, email=payload.email, name=payload.name)
    _VENDORS[vendor.id] = vendor
    return vendor

@router.get("/{vendor_id}", response_model=VendorOut, summary="Get a vendor (demo)")
def get_vendor(vendor_id: int):
    vendor = _VENDORS.get(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor

# -------------------------
# Auth helpers
# -------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def _user_id_from_token(token: str) -> int:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        return int(payload["sub"])
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token subject")

# -------------------------
# Vendor Profile (in-memory, keyed by user_id)
# -------------------------
_PROFILES: Dict[int, VendorProfileOut] = {}

@router.post("/me/profile", response_model=VendorProfileOut, summary="Create my vendor profile (idempotent)")
def create_my_profile(payload: VendorProfileBase, token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    # idempotent create: return existing if present
    if user_id in _PROFILES:
        return _PROFILES[user_id]
    profile = VendorProfileOut(id=user_id, user_id=user_id, **payload.model_dump())
    _PROFILES[user_id] = profile
    return profile

@router.get("/me/profile", response_model=VendorProfileOut, summary="Get my vendor profile")
def get_my_profile(token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    profile = _PROFILES.get(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile

@router.patch("/me/profile", response_model=VendorProfileOut, summary="Update my vendor profile (partial)")
def update_my_profile(payload: VendorProfileUpdate, token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    existing = _PROFILES.get(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")

    data = existing.model_dump()
    data.update({k: v for k, v in payload.model_dump(exclude_unset=True).items()})
    updated = VendorProfileOut(**data)
    _PROFILES[user_id] = updated
    return updated

@router.delete("/me/profile", summary="Delete my vendor profile")
def delete_my_profile(token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    if user_id in _PROFILES:
        del _PROFILES[user_id]
    return {"deleted": True}

# -------------------------
# Media upload endpoints (auth required)
# -------------------------
UPLOAD_ROOT = Path("uploads")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

@router.post("/me/media", summary="Upload one image or video; returns public URL")
async def upload_media(
    file: UploadFile = File(...),
    token: str = Depends(oauth2_scheme),
):
    user_id = _user_id_from_token(token)

    # Only allow image/* or video/*
    ct = (file.content_type or "").lower()
    if not (ct.startswith("image/") or ct.startswith("video/")):
        raise HTTPException(status_code=400, detail="Only image/* or video/* files are allowed")

    # Ensure user folder exists
    user_dir = UPLOAD_ROOT / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    # Save with a safe random filename, keep original extension
    ext = Path(file.filename or "").suffix
    fname = f"{uuid4().hex}{ext}"
    dest = user_dir / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    public_url = f"/uploads/{user_id}/{fname}"
    return {"url": public_url, "mime": ct, "filename": fname}

@router.get("/me/media", response_model=List[str], summary="List your uploaded media")
def list_media(token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    user_dir = UPLOAD_ROOT / str(user_id)
    if not user_dir.exists():
        return []
    return [
        f"/uploads/{user_id}/{p.name}"
        for p in user_dir.iterdir()
        if p.is_file()
    ]

@router.delete("/me/media/{filename}", summary="Delete one uploaded media file")
def delete_media(filename: str, token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    path = (UPLOAD_ROOT / str(user_id) / filename)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    return {"deleted": f"/uploads/{user_id}/{filename}"}

# ---------- ORGANIZER PROFILE ----------
class OrganizerProfileBase(BaseModel):
    display_name: str
    organization_name: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    location: Optional[str] = None
    preferred_categories: Optional[str] = None
    bio: Optional[str] = None

class OrganizerProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    organization_name: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    location: Optional[str] = None
    preferred_categories: Optional[str] = None
    bio: Optional[str] = None

class OrganizerProfileOut(OrganizerProfileBase):
    id: int
    user_id: int
    model_config = ConfigDict(from_attributes=True)

# ---------- EVENTS ----------
class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    date: datetime
    location: str
    cover_image_url: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None
    gallery_urls: Optional[list[str]] = None

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[datetime] = None
    location: Optional[str] = None
    cover_image_url: Optional[str] = None
    diagram_url: Optional[str] = None
    layout_json: Optional[str] = None
    gallery_urls: Optional[list[str]] = None

class EventOut(EventCreate):
    id: int
    organizer_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
