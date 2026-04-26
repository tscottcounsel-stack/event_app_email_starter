from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.db import get_db
from app.models.event import Event

router = APIRouter(tags=["Organizers"])

# Simple in-memory profile store (replace later with DB model)
_ORG_PROFILES = {}


@router.post("/organizer/profile")
def save_profile(payload: dict):
    email = (payload.get("email") or "").strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    _ORG_PROFILES[email] = payload
    return {"success": True, "profile": payload}


@router.get("/organizer/profile/{email}")
def get_profile(email: str):
    email = email.strip().lower()

    profile = _ORG_PROFILES.get(email)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"profile": profile}


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    email = email.strip().lower()

    profile = _ORG_PROFILES.get(email)

    events = (
        db.query(Event)
        .filter(Event.organizer_email == email)
        .all()
    )

    if not profile and not events:
        raise HTTPException(status_code=404, detail="Organizer not found")

    name = (
        (profile or {}).get("organizationName")
        or (profile or {}).get("contactName")
        or (events[0].organizer_email if events else "Organizer")
    )

    return {
        "organizer": {
            "email": email,
            "name": name,
            "profile": profile or {},
            "verified": True,
            "events_count": len(events),
        }
    }


@router.get("/organizers/{email}")
def get_public_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)