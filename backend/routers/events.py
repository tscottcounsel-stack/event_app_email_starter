# backend/routers/events.py
from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel, Field

from backend.deps import require_organizer, get_current_user, SimpleUser

router = APIRouter(prefix="/events", tags=["events"])

# ---------------------------
# Models (strings for datetimes to avoid parsing surprises)
# ---------------------------
class EventCreate(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = ""
    # Provide EITHER `date` OR both `start_time` and `end_time` (ISO 8601 strings)
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None

class EventRead(BaseModel):
    id: int
    organizer_id: int
    title: str
    description: str
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    diagram_url: Optional[str] = None

# ---------------------------
# In-memory store
# ---------------------------
_EVENTS: Dict[int, EventRead] = {}
_NEXT_EVENT_ID = 1

def _reset_events() -> None:
    global _EVENTS, _NEXT_EVENT_ID
    _EVENTS.clear()
    _NEXT_EVENT_ID = 1

def _get_event_or_none(eid: int) -> Optional[EventRead]:
    return _EVENTS.get(eid)

# ---------------------------
# Endpoints
# ---------------------------

@router.post("/", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, user: SimpleUser = Depends(require_organizer)):
    """
    Create an event. You must provide either:
      • `date` (single ISO string), OR
      • both `start_time` and `end_time` (ISO strings).
    """
    global _NEXT_EVENT_ID

    has_single_date = bool(payload.date)
    has_window = bool(payload.start_time and payload.end_time)
    if not (has_single_date or has_window):
        raise HTTPException(
            status_code=422,
            detail="Provide either 'date' OR both 'start_time' and 'end_time'.",
        )

    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title cannot be empty")

    ev = EventRead(
        id=_NEXT_EVENT_ID,
        organizer_id=user.id,
        title=title,
        description=(payload.description or "").strip(),
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        location=payload.location,
        diagram_url=None,
    )
    _EVENTS[_NEXT_EVENT_ID] = ev
    _NEXT_EVENT_ID += 1
    return ev

@router.get("/", response_model=list[EventRead])
def list_events(_=Depends(get_current_user)):
    return list(_EVENTS.values())

@router.get("/{event_id}", response_model=EventRead)
def get_event(event_id: int, _=Depends(get_current_user)):
    ev = _get_event_or_none(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev

@router.put("/{event_id}", response_model=EventRead)
def update_event(
    event_id: int,
    payload: EventUpdate,
    user: SimpleUser = Depends(require_organizer),
):
    ev = _get_event_or_none(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.organizer_id != user.id:
        raise HTTPException(status_code=403, detail="You do not own this event")

    updates = {}
    if payload.title is not None:
        t = payload.title.strip()
        if not t:
            raise HTTPException(status_code=422, detail="title cannot be empty")
        updates["title"] = t
    if payload.description is not None:
        updates["description"] = (payload.description or "").strip()
    if "date" in payload.model_fields_set:
        updates["date"] = payload.date
    if "start_time" in payload.model_fields_set:
        updates["start_time"] = payload.start_time
    if "end_time" in payload.model_fields_set:
        updates["end_time"] = payload.end_time
    if payload.location is not None:
        updates["location"] = payload.location

    updated = ev.model_copy(update=updates)
    _EVENTS[event_id] = updated
    return updated

# ---------------------------
# Diagram upload (optional)
# ---------------------------
UPLOAD_DIR = Path("uploads/events")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/{event_id}/diagram", response_model=EventRead)
def upload_diagram(
    event_id: int,
    file: UploadFile = File(...),
    user: SimpleUser = Depends(require_organizer),
):
    ev = _get_event_or_none(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.organizer_id != user.id:
        raise HTTPException(status_code=403, detail="You do not own this event")

    safe_name = f"event_{event_id}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    with dest.open("wb") as f:
        f.write(file.file.read())

    updated = ev.model_copy(update={"diagram_url": str(dest)})
    _EVENTS[event_id] = updated
    return updated
