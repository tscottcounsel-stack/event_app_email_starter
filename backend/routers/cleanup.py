# backend/routers/cleanup.py
from __future__ import annotations

from fastapi import APIRouter

from backend.routers.auth import _reset_auth
from backend.routers.events import _reset_events
from backend.routers.applications import _reset_applications
from backend.routers.vendors import _reset_vendors

router = APIRouter(prefix="/cleanup", tags=["cleanup"])

@router.post("/all")
def cleanup_all():
    _reset_auth()
    _reset_events()
    _reset_applications()
    _reset_vendors()
    return {"status": "ok"}
