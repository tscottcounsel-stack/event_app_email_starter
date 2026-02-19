# app/routers/events.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.store import _APPLICATIONS, _EVENTS, _REQUIREMENTS, next_event_id, save_store

router = APIRouter(tags=["Events"])


# -------------------------------------------------------------------
# Models
# -------------------------------------------------------------------


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1)
    description: Optional[str] = None

    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

    venue_name: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

    category: Optional[str] = None


class Event(EventCreate):
    id: int
    created_at: str
    updated_at: str

    published: bool = False
    archived: bool = False

    requirements_published: bool = False
    layout_published: bool = False


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_event(ev: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(ev)

    try:
        out["id"] = int(out.get("id"))
    except Exception:
        out["id"] = out.get("id")

    out.setdefault("created_at", utc_now_iso())
    out.setdefault("updated_at", utc_now_iso())

    out["published"] = bool(out.get("published", False))
    out["archived"] = bool(out.get("archived", False))

    out["requirements_published"] = bool(out.get("requirements_published", False))
    out["layout_published"] = bool(out.get("layout_published", False))

    return out


def get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def ensure_requirements_slot(event_id: int) -> Dict[str, Any]:
    """
    Stored in app.store._REQUIREMENTS:
      event_id -> { "version": 2, "requirements": {...} }

    IMPORTANT:
      - organizer UI sets booth category pricing (base_price/base_price_cents, etc.)
      - we keep the slot flexible (no strict schema enforcement) so UI can evolve
    """
    eid = int(event_id)

    slot = _REQUIREMENTS.get(eid)
    if not isinstance(slot, dict):
        slot = {
            "version": 2,
            "requirements": {
                "event_id": eid,
                "booth_categories": [],  # organizer sets pricing here
                "custom_restrictions": [],
                "compliance_items": [],
                "document_requirements": [],
                "payment_settings": {
                    "require_deposit": True,
                    "deposit_percent": 50,
                    "late_fee": 0,
                    "refund_policy": "No Refunds",
                    "payment_notes": "",
                    # checkout fallback
                    "default_amount_cents": 0,
                },
                "updated_at": utc_now_iso(),
            },
        }
        _REQUIREMENTS[eid] = slot

    # Normalize minimal shape (do NOT overwrite organizer-provided values)
    slot.setdefault("version", 2)
    slot.setdefault("requirements", {})
    if not isinstance(slot["requirements"], dict):
        slot["requirements"] = {}

    req = slot["requirements"]
    req.setdefault("event_id", eid)
    req.setdefault("booth_categories", [])
    req.setdefault("custom_restrictions", [])
    req.setdefault("compliance_items", [])
    req.setdefault("document_requirements", [])

    ps = req.get("payment_settings")
    if not isinstance(ps, dict):
        ps = {}
        req["payment_settings"] = ps

    ps.setdefault("require_deposit", True)
    ps.setdefault("deposit_percent", 50)
    ps.setdefault("late_fee", 0)
    ps.setdefault("refund_policy", "No Refunds")
    ps.setdefault("payment_notes", "")
    ps.setdefault("default_amount_cents", 0)

    # NOTE: this updates in-memory on read; leaving as-is
    req["updated_at"] = utc_now_iso()
    return slot


# -------------------------------------------------------------------
# Routes (Events)
# -------------------------------------------------------------------


@router.get("/organizer/events", response_model=List[Event])
def list_organizer_events():
    return [normalize_event(e) for e in _EVENTS.values()]


@router.get("/events", response_model=List[Event])
def list_events_compat():
    # legacy compatibility
    return [normalize_event(e) for e in _EVENTS.values()]


@router.get("/public/events", response_model=List[Event])
def list_public_events():
    """
    Vendor browsing endpoint.
    Prefer published + not archived.
    If none are published yet (dev), return all non-archived so the UI works.
    """
    all_events = [normalize_event(e) for e in _EVENTS.values()]
    published = [e for e in all_events if e.get("published") and not e.get("archived")]
    if published:
        return published
    return [e for e in all_events if not e.get("archived")]


@router.get("/vendor/events", response_model=List[Event])
def list_vendor_events_alias():
    # Back-compat alias for vendor UI
    return list_public_events()


@router.post("/organizer/events", response_model=Event)
def create_event(payload: EventCreate):
    event_id = next_event_id()
    now = utc_now_iso()

    event = {
        "id": event_id,
        **payload.model_dump(),
        "created_at": now,
        "updated_at": now,
        "published": False,
        "archived": False,
        "requirements_published": False,
        "layout_published": False,
    }

    _EVENTS[event_id] = event
    ensure_requirements_slot(event_id)

    save_store()
    return normalize_event(event)


# legacy create alias (fixes “Method Not Allowed” if UI still POSTs /events)
@router.post("/events", response_model=Event)
def create_event_compat(payload: EventCreate):
    return create_event(payload)


@router.get("/organizer/events/{event_id}", response_model=Event)
def get_event(event_id: int):
    ev = get_event_or_404(event_id)
    return normalize_event(ev)


@router.put("/organizer/events/{event_id}", response_model=Event)
def update_event(event_id: int, payload: EventCreate):
    ev = get_event_or_404(event_id)
    for k, v in payload.model_dump().items():
        ev[k] = v
    ev["updated_at"] = utc_now_iso()
    save_store()
    return normalize_event(ev)


@router.post("/organizer/events/{event_id}/publish", response_model=Event)
def publish_event(event_id: int):
    ev = get_event_or_404(event_id)
    if ev.get("archived"):
        raise HTTPException(status_code=400, detail="Cannot publish archived event")

    ev["published"] = True
    ev["updated_at"] = utc_now_iso()
    save_store()
    return normalize_event(ev)


@router.post("/organizer/events/{event_id}/unpublish", response_model=Event)
def unpublish_event(event_id: int):
    ev = get_event_or_404(event_id)
    ev["published"] = False
    ev["updated_at"] = utc_now_iso()
    save_store()
    return normalize_event(ev)


@router.post("/organizer/events/{event_id}/archive", response_model=Event)
def archive_event(event_id: int):
    ev = get_event_or_404(event_id)
    ev["archived"] = True
    ev["updated_at"] = utc_now_iso()
    save_store()
    return normalize_event(ev)


@router.delete("/organizer/events/{event_id}")
def delete_event(event_id: int):
    """
    Delete an event and cascade-delete its applications (dev store).
    Also removes the requirements slot if present.
    """
    eid = int(event_id)

    ev = _EVENTS.get(eid)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    to_delete = [
        app_id
        for app_id, app in _APPLICATIONS.items()
        if int(app.get("event_id", -1)) == eid
    ]
    for app_id in to_delete:
        _APPLICATIONS.pop(int(app_id), None)

    _REQUIREMENTS.pop(eid, None)
    _EVENTS.pop(eid, None)

    save_store()
    return {"ok": True, "deleted_event_id": eid, "deleted_applications": len(to_delete)}


# -------------------------------------------------------------------
# Requirements
# Shape: { "version": int, "requirements": {...} }
# -------------------------------------------------------------------


@router.get("/organizer/events/{event_id}/requirements")
def get_event_requirements_organizer(event_id: int):
    get_event_or_404(event_id)
    return ensure_requirements_slot(event_id)


@router.put("/organizer/events/{event_id}/requirements")
def save_event_requirements_organizer(
    event_id: int, payload: Dict[str, Any] = Body(...)
):
    get_event_or_404(event_id)

    version = payload.get("version", 2)
    try:
        version = int(version or 2)
    except Exception:
        version = 2

    requirements = payload.get("requirements", {}) or {}
    if not isinstance(requirements, dict):
        requirements = {}

    requirements["event_id"] = int(event_id)
    requirements["updated_at"] = utc_now_iso()

    _REQUIREMENTS[int(event_id)] = {"version": version, "requirements": requirements}

    ev = _EVENTS.get(int(event_id))
    if ev is not None:
        ev["requirements_published"] = True
        ev["updated_at"] = utc_now_iso()

    save_store()
    return _REQUIREMENTS[int(event_id)]


@router.post("/organizer/events/{event_id}/requirements")
def save_event_requirements_organizer_post(
    event_id: int, payload: Dict[str, Any] = Body(...)
):
    return save_event_requirements_organizer(event_id, payload)


@router.get("/events/{event_id}/requirements")
def get_event_requirements_public(event_id: int):
    get_event_or_404(event_id)
    return ensure_requirements_slot(event_id)
