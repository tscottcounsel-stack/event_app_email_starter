from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.db import get_db
from app.models.event import Event

router = APIRouter(tags=["Organizers"])


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    email = email.strip().lower()

    events = (
        db.query(Event)
        .filter(Event.organizer_email == email)
        .all()
    )

    if not events:
        raise HTTPException(status_code=404, detail="Organizer not found")

    organizer_name = (
        events[0].organizer_email
        or "Organizer"
    )

    return {
        "organizer": {
            "email": email,
            "name": organizer_name,
            "verified": True,
            "events_count": len(events),
        }
    }