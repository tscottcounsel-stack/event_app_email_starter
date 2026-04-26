from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event

router = APIRouter(tags=["Organizers"])

# Persist organizer profiles on Railway's mounted volume when available.
DATA_DIR = Path("/data") if Path("/data").exists() else Path(__file__).resolve().parent.parent
PROFILE_STORE_PATH = DATA_DIR / "organizer_profiles.json"


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _load_profiles() -> Dict[str, Dict[str, Any]]:
    try:
        if not PROFILE_STORE_PATH.exists():
            return {}
        data = json.loads(PROFILE_STORE_PATH.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_profiles(profiles: Dict[str, Dict[str, Any]]) -> None:
    PROFILE_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_STORE_PATH.write_text(json.dumps(profiles, indent=2, sort_keys=True), encoding="utf-8")


def _event_to_public(event: Event) -> Dict[str, Any]:
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "venue_name": event.venue_name,
        "street_address": event.street_address,
        "city": event.city,
        "state": event.state,
        "start_date": event.start_date.isoformat() if event.start_date else None,
        "end_date": event.end_date.isoformat() if event.end_date else None,
        "published": bool(event.published),
        "archived": bool(event.archived),
        "heroImageUrl": event.hero_image_url,
        "imageUrls": list(event.image_urls or []),
        "videoUrls": list(event.video_urls or []),
        "category": event.category,
        "organizer_email": event.organizer_email,
    }


def _profile_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    email = _norm_email(payload.get("email"))
    return {
        "organizationName": str(payload.get("organizationName") or payload.get("organization_name") or "").strip(),
        "organizationType": str(payload.get("organizationType") or payload.get("organization_type") or "").strip(),
        "contactName": str(payload.get("contactName") or payload.get("contact_name") or "").strip(),
        "email": email,
        "phone": str(payload.get("phone") or "").strip(),
        "website": str(payload.get("website") or "").strip(),
        "location": str(payload.get("location") or "").strip(),
        "logoDataUrl": str(payload.get("logoDataUrl") or payload.get("logo_url") or "").strip(),
        "imageUrls": list(payload.get("imageUrls") or []),
        "profileComplete": bool(payload.get("profileComplete")),
        "updatedAt": str(payload.get("updatedAt") or "").strip(),
    }


@router.post("/organizer/profile")
def save_organizer_profile(payload: Dict[str, Any]):
    profile = _profile_from_payload(payload or {})
    email = _norm_email(profile.get("email"))

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    if not profile.get("organizationName"):
        raise HTTPException(status_code=400, detail="Organization name required")

    if not profile.get("contactName"):
        raise HTTPException(status_code=400, detail="Primary contact name required")

    profiles = _load_profiles()
    profiles[email] = profile
    _save_profiles(profiles)

    return {"ok": True, "profile": profile, "organizer": {"email": email, "profile": profile}}


@router.get("/organizer/profile/{email}")
def get_organizer_profile(email: str):
    email = _norm_email(email)
    profile = _load_profiles().get(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"profile": profile}


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    email = _norm_email(email)
    profiles = _load_profiles()
    profile = profiles.get(email)

    events = (
        db.query(Event)
        .filter(Event.organizer_email == email)
        .order_by(Event.id.desc())
        .all()
    )

    public_events = [
        _event_to_public(event)
        for event in events
        if bool(event.published) and not bool(event.archived)
    ]

    if not profile and not events:
        raise HTTPException(status_code=404, detail="Organizer not found")

    name = (
        (profile or {}).get("organizationName")
        or (profile or {}).get("contactName")
        or (events[0].organizer_email if events else email)
        or "Organizer"
    )

    return {
        "organizer": {
            "email": email,
            "name": name,
            "verified": True,
            "profile": profile or {},
            "events_count": len(events),
            "public_events_count": len(public_events),
            "events": public_events,
        }
    }


@router.get("/organizers/{email}")
def get_public_organizer_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)
