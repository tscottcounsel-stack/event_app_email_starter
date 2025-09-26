from datetime import datetime
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.security import OAuth2PasswordBearer

from backend.security.auth import decode_access_token
from backend.models.schemas import EventCreate, EventUpdate, EventOut

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

# In-memory events store
_EVENTS: Dict[int, EventOut] = {}
_NEXT_EVENT_ID = 1

@router.post("/", response_model=EventOut, summary="Create event")
def create_event(payload: EventCreate, token: str = Depends(oauth2_scheme)):
    global _NEXT_EVENT_ID
    organizer_id = _user_id_from_token(token)
    eid = _NEXT_EVENT_ID
    _NEXT_EVENT_ID += 1

    created = EventOut(
        id=eid,
        organizer_id=organizer_id,
        created_at=datetime.utcnow(),
        **payload.model_dump(),
    )
    _EVENTS[eid] = created
    return created

@router.get("/{event_id}", response_model=EventOut, summary="Get event by id")
def get_event(event_id: int):
    event = _EVENTS.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@router.get("/", response_model=List[EventOut], summary="List events")
def list_events(mine: Optional[bool] = Query(default=False), token: Optional[str] = Depends(oauth2_scheme)):
    if mine:
        organizer_id = _user_id_from_token(token)
        return [e for e in _EVENTS.values() if e.organizer_id == organizer_id]
    return list(_EVENTS.values())

@router.patch("/{event_id}", response_model=EventOut, summary="Update event (owner only)")
def update_event(event_id: int, payload: EventUpdate, token: str = Depends(oauth2_scheme)):
    organizer_id = _user_id_from_token(token)
    event = _EVENTS.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.organizer_id != organizer_id:
        raise HTTPException(status_code=403, detail="Not your event")

    data = event.model_dump()
    data.update(payload.model_dump(exclude_unset=True))
    updated = EventOut(**data)
    _EVENTS[event_id] = updated
    return updated

@router.delete("/{event_id}", summary="Delete event (owner only)")
def delete_event(event_id: int, token: str = Depends(oauth2_scheme)):
    organizer_id = _user_id_from_token(token)
    event = _EVENTS.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.organizer_id != organizer_id:
        raise HTTPException(status_code=403, detail="Not your event")

    del _EVENTS[event_id]
    return {"deleted": True}
