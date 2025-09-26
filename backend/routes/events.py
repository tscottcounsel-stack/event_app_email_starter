print("✅ Using events.py from:", __file__)

print("✅ Loaded events.py from:", __file__)


from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List

from backend.models import models, schemas
from backend.config.database import get_db

router = APIRouter(
    prefix="/events",
    tags=["events"]
)

# ✅ Create a new event
@router.post("/", response_model=schemas.EventOut)
def create_event(event: schemas.EventCreate, db: Session = Depends(get_db)):
    db_event = models.Event(
        title=event.title,
        description=event.description,
        date=event.date,
        location=event.location,
        diagram_url=event.diagram_url,
        layout_json=event.layout_json,
        organizer_id=1,  # 🔧 placeholder until organizers are wired
        created_at=datetime.utcnow()
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


# ✅ Get all events
@router.get("/", response_model=List[schemas.EventOut])
def get_events(db: Session = Depends(get_db)):
    return db.query(models.Event).all()

# ✅ Get one event by ID
@router.get("/test")
def get_events_test():
    return [{"id": 1, "title": "debug event"}]


# ✅ Delete an event
@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return {"message": f"Event {event_id} deleted successfully"}

for r in router.routes:
    print("📌 EVENTS ROUTE:", r.path, r.methods)

@router.get("/ping")
def ping():
    return {"status": "ok"}


