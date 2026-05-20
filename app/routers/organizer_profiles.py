from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import _decode_token

router = APIRouter(prefix="/organizer", tags=["Organizer Profile"])
bearer = HTTPBearer(auto_error=False)


class OrganizerProfilePayload(BaseModel):
    model_config = ConfigDict(extra="allow")


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Dict[str, Any]:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing auth token")

    payload = _decode_token(credentials.credentials)
    email = _norm(payload.get("email") or payload.get("sub"))
    role = _norm(payload.get("role") or "organizer")
    user_id = payload.get("user_id") or payload.get("id") or payload.get("sub")

    if not email:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Organizer account required")

    return {"email": email, "role": role, "user_id": user_id, "raw": payload}


def _profile_to_payload(profile: Profile) -> Dict[str, Any]:
    data = profile.data if isinstance(profile.data, dict) else {}
    out: Dict[str, Any] = dict(data)

    out.setdefault("email", profile.email)
    out.setdefault("organizationName", profile.business_name or profile.display_name or "")
    out.setdefault("business_name", profile.business_name or "")
    out.setdefault("businessName", profile.business_name or "")
    out.setdefault("contactName", profile.display_name or "")
    out.setdefault("display_name", profile.display_name or "")
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


def _legacy_row_to_payload(row: Any, auth_email: str) -> Dict[str, Any]:
    m = row._mapping if hasattr(row, "_mapping") else row
    business_name = _safe_str(m.get("business_name") or m.get("company_name"))
    contact_name = _safe_str(m.get("contact_name"))
    public_email = _safe_str(m.get("public_email") or m.get("email") or auth_email)

    return {
        "id": m.get("id"),
        "legacy_profile_id": m.get("id"),
        "user_id": m.get("user_id"),
        "role": "organizer",
        "email": auth_email,
        "organizationName": business_name,
        "business_name": business_name,
        "businessName": business_name,
        "company_name": _safe_str(m.get("company_name")) or business_name,
        "contactName": contact_name,
        "display_name": contact_name,
        "publicEmail": public_email,
        "public_email": public_email,
        "phone": _safe_str(m.get("phone")),
        "website": _safe_str(m.get("website")),
        "city": _safe_str(m.get("city")),
        "state": _safe_str(m.get("state")),
        "address": _safe_str(m.get("address")),
        "description": _safe_str(m.get("description")),
        "organizationStory": _safe_str(m.get("organizer_story")),
        "organizer_story": _safe_str(m.get("organizer_story")),
        "logoUrl": _safe_str(m.get("logo_url")),
        "logo_url": _safe_str(m.get("logo_url")),
        "bannerUrl": _safe_str(m.get("banner_url")),
        "banner_url": _safe_str(m.get("banner_url")),
        "instagram": _safe_str(m.get("instagram")),
        "facebook": _safe_str(m.get("facebook")),
        "twitter": _safe_str(m.get("twitter")),
        "tiktok": _safe_str(m.get("tiktok")),
        "youtube": _safe_str(m.get("youtube")),
        "checklist_tags": m.get("checklist_tags") or [],
        "organizer_categories": m.get("organizer_categories") or [],
        "tags": m.get("tags") or [],
        "profileComplete": bool(business_name and contact_name),
        "verified": False,
        "verification_status": None,
        "public_verification_status": None,
        "review_status": None,
        "updatedAt": str(m.get("updated_at") or ""),
    }


def _find_legacy_profile(db: Session, auth_email: str, user_id: Any = None):
    """Compatibility read for the older organizer_profiles table.

    Preference order:
    1. Match old row by public/email fields.
    2. Match by token user_id if the token has a numeric id.
    3. Fallback to most recently updated non-empty organizer profile.
    """
    params: Dict[str, Any] = {"email": auth_email}

    row = db.execute(
        text(
            """
            SELECT *
            FROM organizer_profiles
            WHERE lower(coalesce(public_email, '')) = :email
               OR lower(coalesce(email, '')) = :email
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1
            """
        ),
        params,
    ).first()
    if row:
        return row

    try:
        numeric_user_id = int(user_id) if user_id is not None and str(user_id).isdigit() else None
    except Exception:
        numeric_user_id = None

    if numeric_user_id:
        row = db.execute(
            text(
                """
                SELECT *
                FROM organizer_profiles
                WHERE user_id = :user_id
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
            ),
            {"user_id": numeric_user_id},
        ).first()
        if row:
            return row

    row = db.execute(
        text(
            """
            SELECT *
            FROM organizer_profiles
            WHERE nullif(trim(coalesce(business_name, '')), '') IS NOT NULL
               OR nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1
            """
        )
    ).first()
    return row


def _upsert_profile_from_payload(db: Session, email: str, data: Dict[str, Any]) -> Profile:
    organization_name = _safe_str(
        data.get("organizationName")
        or data.get("business_name")
        or data.get("businessName")
        or data.get("company_name")
    )
    contact_name = _safe_str(
        data.get("contactName")
        or data.get("display_name")
        or data.get("displayName")
    )
    city = _safe_str(data.get("city"))
    state = _safe_str(data.get("state"))

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
    merged = {**existing_data, **data, "email": email, "role": "organizer"}

    profile.display_name = contact_name or profile.display_name or organization_name or email
    profile.business_name = organization_name or profile.business_name or contact_name or email
    profile.city = city or profile.city
    profile.state = state or profile.state
    profile.data = merged

    db.commit()
    db.refresh(profile)
    return profile


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
    if profile is not None:
        return {"ok": True, "profile": _profile_to_payload(profile)}

    legacy = _find_legacy_profile(db, email, user.get("user_id"))
    if legacy:
        legacy_payload = _legacy_row_to_payload(legacy, email)
        return {"ok": True, "profile": legacy_payload, "source": "legacy_organizer_profiles"}

    return {
        "ok": True,
        "profile": {
            "email": email,
            "role": "organizer",
            "organizationName": "",
            "business_name": "",
            "businessName": "",
            "contactName": "",
            "city": "",
            "state": "",
            "profileComplete": False,
            "verified": False,
        },
    }


@router.post("/profile")
def save_organizer_profile(
    payload: OrganizerProfilePayload,
    user: Dict[str, Any] = Depends(_current_user),
    db: Session = Depends(get_db),
):
    email = user["email"]
    data = payload.model_dump()
    profile = _upsert_profile_from_payload(db, email, data)
    return {"ok": True, "profile": _profile_to_payload(profile)}
