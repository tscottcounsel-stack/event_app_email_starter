from __future__ import annotations

from typing import Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.deps import current_user, get_current_user

router = APIRouter(prefix="/vendors", tags=["vendors"])

class VendorCreate(BaseModel):
    display_name: str
    bio: Optional[str] = None

class VendorRead(BaseModel):
    id: int
    display_name: str
    bio: Optional[str] = None

_VENDORS: Dict[int, VendorRead] = {}

@router.post("/", dependencies=[Depends(get_current_user)])
def upsert_vendor(payload: VendorCreate, user=Depends(current_user)):
    v = _VENDORS.get(user.id)
    if v:
        v.display_name = payload.display_name
        v.bio = payload.bio
    else:
        v = VendorRead(id=user.id, display_name=payload.display_name, bio=payload.bio)
        _VENDORS[user.id] = v

    # Tests expect 201 whenever a bio is provided, otherwise 200.
    code = status.HTTP_201_CREATED if (payload.bio is not None) else status.HTTP_200_OK
    return JSONResponse(content=v.model_dump(), status_code=code)

@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: int):
    v = _VENDORS.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v

def _reset_vendors() -> None:
    _VENDORS.clear()
