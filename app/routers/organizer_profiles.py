from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import _decode_token

router = APIRouter(prefix="/organizer", tags=["Organizer Profile"])
bearer = HTTPBearer(auto_error=False)


class OrganizerProfilePayload(BaseModel):
    model_config = ConfigDict(extra="allow")


def _current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing auth token")

    payload = _decode_token(credentials.credentials)
    email = str(payload.get("email") or payload.get("sub") or "").strip().lower()
    role = str(payload.get("role") or "").strip().lower()

    if not email:
        raise HTTPException(status_code=401, detail="Invalid auth token")

    if role and role != "organizer" and role != "admin":
        raise HTTPException(status_code=403, detail="Organizer account required")

    return {
        "email": email,
        "role": role or "organizer",
        "user_id": payload.get("user_id") or payload.get("id"),
    }


def _serialize_profile(profile: Profile) -> Dict[str, Any]:
    data = profile.data if isinstance(profile.data, dict) else {}
    out = dict(data)

    out.setdefault("email", profile.email)
    out.setdefault("organizationName", profile.business_name or profile.display_name or "")
    out.setdefault("contactName", profile.display_name or "")
    out.setdefault("city", profile.city or "")
    out.setdefault("state", profile.state or "")
    out.setdefault("profileComplete", bool(data.get("profileComplete")))

    out["id"] = profile.id
    out["role"] = profile.role
    out["verified"] = bool(profile.verified)
    out["verification_status"] = profile.verification_status
    out["public_verification_status"] = profile.public_verification_status
    out["public_verification_label"] = profile.public_verification_label
    out["review_status"] = profile.review_status
    out["visibility_tier"] = profile.visibility_tier
    out["subscription_plan"] = profile.subscription_plan
    out["subscription_status"] = profile.subscription_status
    out["featured"] = bool(profile.featured)
    out["promoted"] = bool(profile.promoted)
    out["updatedAt"] = profile.updated_at.isoformat() if profile.updated_at else data.get("updatedAt")

    return out


@router.get("/profile")
def get_organizer_profile(
    user: Dict[str, Any] = Depends(_current_user),
    db: Session = Depends(get_db),
):
    email = user["email"]

    profile = (
        db.query(Profile)
        .filter(Profile.role == "organizer", func.lower(Profile.email) == email)
        .one_or_none()
    )

    if profile is None:
        return {"profile": None}

    return {"profile": _serialize_profile(profile)}


@router.post("/profile")
def save_organizer_profile(
    payload: OrganizerProfilePayload,
    user: Dict[str, Any] = Depends(_current_user),
    db: Session = Depends(get_db),
):
    email = user["email"]
    data = payload.model_dump()

    organization_name = str(
        data.get("organizationName")
        or data.get("business_name")
        or data.get("businessName")
        or ""
    ).strip()

    contact_name = str(
        data.get("contactName")
        or data.get("display_name")
        or data.get("displayName")
        or ""
    ).strip()

    city = str(data.get("city") or "").strip()
    state = str(data.get("state") or "").strip()

    profile = (
        db.query(Profile)
        .filter(Profile.role == "organizer", func.lower(Profile.email) == email)
        .one_or_none()
    )

    if profile is None:
        profile = Profile(
            role="organizer",
            email=email,
            display_name=contact_name or organization_name or email,
            business_name=organization_name or contact_name or email,
            city=city or None,
            state=state or None,
            categories=[],
            data={},
            verified=False,
        )
        db.add(profile)
        db.flush()

    existing_data = profile.data if isinstance(profile.data, dict) else {}
    merged_data = {**existing_data, **data, "email": email, "role": "organizer"}

    profile.display_name = contact_name or profile.display_name or organization_name or email
    profile.business_name = organization_name or profile.business_name or contact_name or email
    profile.city = city or profile.city
    profile.state = state or profile.state
    profile.data = merged_data

    db.commit()
    db.refresh(profile)

    return {"ok": True, "profile": _serialize_profile(profile)}
