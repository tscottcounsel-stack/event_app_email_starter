from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.deps import require_vendor, require_organizer, SimpleUser
from backend.routers.events import _get_event_or_none  # event existence check

router = APIRouter(prefix="/applications", tags=["applications"])

class ApplicationCreate(BaseModel):
    event_id: int
    message: str | None = None

class ApplicationRead(BaseModel):
    id: int
    event_id: int
    vendor_id: int
    status: str = "pending"
    message: str | None = None

class StatusUpdate(BaseModel):
    status: str

_APPLICATIONS: Dict[int, ApplicationRead] = {}
_NEXT_APP_ID = 1

def _reset_applications() -> None:
    global _NEXT_APP_ID
    _APPLICATIONS.clear()
    _NEXT_APP_ID = 1

def _get_app_or_404(aid: int) -> ApplicationRead:
    app = _APPLICATIONS.get(aid)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app

# ---- Create (vendor) ----
@router.post("/", response_model=ApplicationRead)
def apply_to_event(payload: ApplicationCreate, user: SimpleUser = Depends(require_vendor)):
    global _NEXT_APP_ID
    if not _get_event_or_none(payload.event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    app = ApplicationRead(
        id=_NEXT_APP_ID,
        event_id=payload.event_id,
        vendor_id=user.id,
        status="pending",
        message=payload.message,
    )
    _APPLICATIONS[_NEXT_APP_ID] = app
    _NEXT_APP_ID += 1
    return JSONResponse(content=app.model_dump(), status_code=201)

# ---- Review (organizer) ----
@router.get("/event/{event_id}", response_model=List[ApplicationRead])
def list_applications_for_event(event_id: int, _=Depends(require_organizer)):
    if not _get_event_or_none(event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    return [a for a in _APPLICATIONS.values() if a.event_id == event_id]

# ---- Vendor: My apps ----
@router.get("/mine", response_model=List[ApplicationRead])
def my_applications(user: SimpleUser = Depends(require_vendor)):
    return [a for a in _APPLICATIONS.values() if a.vendor_id == user.id]

# ---- Organizer: update status (supports query or JSON body) ----
_ALLOWED = {"approved", "pending", "rejected"}

@router.put("/{app_id}", response_model=ApplicationRead)
def update_application_status(
    app_id: int,
    user: SimpleUser = Depends(require_organizer),
    status: Optional[str] = Query(default=None, description="approved | pending | rejected"),
    payload: Optional[StatusUpdate] = None,
):
    app = _get_app_or_404(app_id)
    new_status = (status or (payload.status if payload else None) or "").lower().strip()
    if new_status not in _ALLOWED:
        raise HTTPException(status_code=422, detail=f"Invalid status. Allowed: {sorted(_ALLOWED)}")
    app.status = new_status
    return app

