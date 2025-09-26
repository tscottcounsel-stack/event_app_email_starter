from typing import Dict
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer

from backend.security.auth import decode_access_token
from backend.models.schemas import (
    OrganizerProfileBase, OrganizerProfileUpdate, OrganizerProfileOut
)

router = APIRouter()

# Auth helpers
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def _user_id_from_token(token: str) -> int:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        return int(payload["sub"])
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token subject")

# In-memory organizer profiles (keyed by user_id)
_ORG_PROFILES: Dict[int, OrganizerProfileOut] = {}

@router.post("/me/profile", response_model=OrganizerProfileOut, summary="Create my organizer profile (idempotent)")
def create_my_org_profile(payload: OrganizerProfileBase, token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    if user_id in _ORG_PROFILES:
        return _ORG_PROFILES[user_id]
    profile = OrganizerProfileOut(id=user_id, user_id=user_id, **payload.model_dump())
    _ORG_PROFILES[user_id] = profile
    return profile

@router.get("/me/profile", response_model=OrganizerProfileOut, summary="Get my organizer profile")
def get_my_org_profile(token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    profile = _ORG_PROFILES.get(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile

@router.patch("/me/profile", response_model=OrganizerProfileOut, summary="Update my organizer profile (partial)")
def update_my_org_profile(payload: OrganizerProfileUpdate, token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    existing = _ORG_PROFILES.get(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")

    data = existing.model_dump()
    data.update(payload.model_dump(exclude_unset=True))
    updated = OrganizerProfileOut(**data)
    _ORG_PROFILES[user_id] = updated
    return updated

@router.delete("/me/profile", summary="Delete my organizer profile")
def delete_my_org_profile(token: str = Depends(oauth2_scheme)):
    user_id = _user_id_from_token(token)
    if user_id in _ORG_PROFILES:
        del _ORG_PROFILES[user_id]
    return {"deleted": True}
