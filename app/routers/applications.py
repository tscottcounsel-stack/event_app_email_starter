# app/routers/applications.py
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/applications", tags=["applications"])

_APPLICATIONS: Dict[int, Dict[str, Any]] = {}
_NEXT_ID: int = 1


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: Optional[int] = None
    vendor_id: Optional[int] = None
    requested_slots: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None
    status: Optional[str] = None


class ApplicationPatch(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: Optional[int] = None
    vendor_id: Optional[int] = None
    requested_slots: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None
    status: Optional[str] = None
    assigned_slot_id: Optional[int] = Field(default=None, ge=1)


def _get_or_404(application_id: int) -> Dict[str, Any]:
    app = _APPLICATIONS.get(application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.get("/diag/ping")
def applications_diag_ping():
    return {"ping": "pong"}


@router.get("")
def list_applications(
    event_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
):
    items = list(_APPLICATIONS.values())
    if event_id is not None:
        items = [a for a in items if a.get("event_id") == event_id]
    if vendor_id is not None:
        items = [a for a in items if a.get("vendor_id") == vendor_id]
    return items[: int(limit)]


@router.post("", status_code=201)
def create_application(payload: ApplicationCreate):
    global _NEXT_ID
    app_id = _NEXT_ID
    _NEXT_ID += 1
    data = {"id": app_id, **payload.model_dump(exclude_none=True)}
    _APPLICATIONS[app_id] = data
    return data


@router.get("/id/{application_id}")
def get_application_by_id(application_id: int):
    return _get_or_404(application_id)


@router.patch("/id/{application_id}")
def patch_application_by_id(application_id: int, patch: ApplicationPatch):
    app = _get_or_404(application_id)
    updates = patch.model_dump(exclude_none=True)
    app.update(updates)
    return app


@router.get("/{application_id}")
def get_application_alias(application_id: int):
    return get_application_by_id(application_id)


@router.patch("/{application_id}")
def patch_application_alias(application_id: int, patch: ApplicationPatch):
    return patch_application_by_id(application_id, patch)
