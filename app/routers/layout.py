# app/routers/layout.py
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.store import _EVENTS, _LAYOUT_META, save_store

router = APIRouter(prefix="/events/{event_id}/layout", tags=["Layout"])


class LayoutPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: Dict[str, Any]


def _ensure_event(event_id: int):
    if event_id not in _EVENTS:
        raise HTTPException(status_code=404, detail="Event not found")


@router.get("/")
def get_layout(event_id: int):
    _ensure_event(event_id)
    # ✅ never return None for data
    return _LAYOUT_META.get(event_id) or {"data": {}}


@router.put("/")
def save_layout(event_id: int, body: LayoutPayload):
    _ensure_event(event_id)
    _LAYOUT_META[event_id] = {"data": body.data or {}}
    save_store()  # ✅ persist layout meta
    return {"ok": True, "event_id": event_id}
