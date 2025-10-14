from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.deps import get_current_user

router = APIRouter()


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1)
    description: str | None = None
    date: datetime
    location: str = Field(min_length=1)


_EVENTS: dict[int, dict] = {}
_NEXT_ID = 1


def _require_auth_header(request: Request):
    if "authorization" not in {k.lower(): v for k, v in request.headers.items()}:
        raise HTTPException(status_code=401, detail="Not authenticated")


def _create(body: EventCreate) -> dict:
    global _NEXT_ID
    eid = _NEXT_ID
    _NEXT_ID += 1
    data = {
        "id": eid,
        "title": body.title,
        "description": body.description,
        "date": body.date.isoformat(),
        "location": body.location,
    }
    _EVENTS[eid] = data
    return data


@router.post("", status_code=200)  # /events
def create_event_no_slash(
    body: EventCreate, request: Request, user=Depends(get_current_user)
):
    _require_auth_header(request)
    return _create(body)


@router.post("/", status_code=200)  # /events/
def create_event_slash(
    body: EventCreate, request: Request, user=Depends(get_current_user)
):
    _require_auth_header(request)
    return _create(body)


@router.get("/{event_id}")
def get_event(event_id: int):
    return _EVENTS.get(event_id) or {"id": event_id, "title": f"event-{event_id}"}
