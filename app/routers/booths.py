# app/routers/booths.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.store import _BOOTHS, _EVENTS, next_booth_id, save_store

router = APIRouter(prefix="/events/{event_id}/booths", tags=["Booths"])


class BoothCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str = Field(min_length=1)
    x: int
    y: int
    w: int = 1
    h: int = 1

    category_id: Optional[str] = None  # ties to requirements booth category
    price_override: Optional[float] = None

    status: str = "available"  # available | blocked | reserved | assigned


class BoothOut(BaseModel):
    id: int
    event_id: int
    label: str
    x: int
    y: int
    w: int
    h: int
    category_id: Optional[str] = None
    price_override: Optional[float] = None
    status: str


def _ensure_event(event_id: int):
    if event_id not in _EVENTS:
        raise HTTPException(status_code=404, detail="Event not found")


@router.get("/", response_model=list[BoothOut])
def list_booths(event_id: int):
    _ensure_event(event_id)
    return [b for b in _BOOTHS.values() if b.get("event_id") == event_id]


@router.post("/", response_model=BoothOut)
def create_booth(event_id: int, body: BoothCreate):
    _ensure_event(event_id)
    bid = next_booth_id()

    booth = {
        "id": bid,
        "event_id": event_id,
        "label": body.label,
        "x": body.x,
        "y": body.y,
        "w": body.w,
        "h": body.h,
        "category_id": body.category_id,
        "price_override": body.price_override,
        "status": body.status,
    }

    _BOOTHS[bid] = booth
    save_store()  # ✅ persist booths
    return booth


@router.delete("/{booth_id}")
def delete_booth(event_id: int, booth_id: int):
    _ensure_event(event_id)
    booth = _BOOTHS.get(booth_id)
    if not booth or booth.get("event_id") != event_id:
        raise HTTPException(status_code=404, detail="Booth not found")

    del _BOOTHS[booth_id]
    save_store()  # ✅ persist deletion
    return {"ok": True}
