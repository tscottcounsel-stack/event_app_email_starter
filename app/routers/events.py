# app/routers/events.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.store import _EVENTS, _REQUIREMENTS, next_event_id, save_store

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

    ticket_sales_url: Optional[str] = None
    google_maps_url: Optional[str] = None
    category: Optional[str] = None

    heroImageUrl: Optional[str] = None
    imageUrls: Optional[list[str]] = None
    videoUrls: Optional[list[str]] = None


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: Optional[str] = None
    description: Optional[str] = None

    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

    venue_name: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

    ticket_sales_url: Optional[str] = None
    google_maps_url: Optional[str] = None
    category: Optional[str] = None

    heroImageUrl: Optional[str] = None
    imageUrls: Optional[list[str]] = None
    videoUrls: Optional[list[str]] = None

    published: Optional[bool] = None
    archived: Optional[bool] = None
    requirements_published: Optional[bool] = None
    layout_published: Optional[bool] = None


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _as_event_dict(e: Dict[str, Any]) -> Dict[str, Any]:
    return dict(e)


def _looks_like_diagram_doc(d: Dict[str, Any]) -> bool:
    """
    Heuristic: if diagram doc is stored raw, it usually has levels/booths/etc.
    """
    if not isinstance(d, dict):
        return False
    if "levels" in d:
        return True
    if "booths" in d:
        return True
    # Some editors store "floors"
    if "floors" in d:
        return True
    return False


def _ensure_diagram_slot(event_id: int) -> Dict[str, Any]:
    """
    Persisted storage is a wrapper:
      event["diagram"] = { "diagram": <doc>, "version": <int> }

    ✅ MIGRATION:
    If event["diagram"] is a raw doc (dict with levels/booths) we wrap it
    instead of wiping it.
    """
    ev = _get_event_or_404(event_id)
    slot = ev.get("diagram")

    # Case 1: already wrapped correctly
    if isinstance(slot, dict) and "diagram" in slot:
        if not isinstance(slot.get("version"), int):
            slot["version"] = 1
        if slot.get("diagram") is None:
            slot["diagram"] = {}
        ev["diagram"] = slot
        return slot

    # Case 2: raw doc stored directly in event["diagram"]  ✅ migrate
    if isinstance(slot, dict) and _looks_like_diagram_doc(slot):
        migrated = {"diagram": slot, "version": 1}
        ev["diagram"] = migrated
        ev["updated_at"] = utc_now_iso()
        save_store()
        return migrated

    # Case 3: missing/unknown → initialize empty
    new_slot = {"diagram": {}, "version": 1}
    ev["diagram"] = new_slot
    ev["updated_at"] = utc_now_iso()
    save_store()
    return new_slot


def _next_diagram_version(current: Optional[int], incoming: Optional[int]) -> int:
    if isinstance(current, int) and current >= 1:
        return current + 1
    if isinstance(incoming, int) and incoming >= 1:
        return incoming
    return 1


def _coerce_incoming_diagram_payload(
    payload: Any,
) -> Tuple[Dict[str, Any], Optional[int]]:
    """
    Accept BOTH payload shapes:
      A) { "diagram": <doc>, "version": <int> }
      B) <doc>   (raw diagram doc)
    Return: (doc, incoming_version)
    """
    if not isinstance(payload, dict):
        return {}, None

    incoming_version = (
        payload.get("version") if isinstance(payload.get("version"), int) else None
    )

    # Wrapped
    if "diagram" in payload and isinstance(payload.get("diagram"), dict):
        return payload.get("diagram") or {}, incoming_version

    # Raw doc
    return payload, incoming_version


def _is_effectively_empty_diagram(doc: Dict[str, Any]) -> bool:
    """
    Prevent accidental wipes. We treat these as empty:
      - {}
      - {"levels": []}
      - {"levels": [{... empty ...}] }  (optional, keep simple)
    """
    if not isinstance(doc, dict):
        return True
    if doc == {}:
        return True
    if (
        "levels" in doc
        and isinstance(doc.get("levels"), list)
        and len(doc.get("levels")) == 0
    ):
        return True
    return False


def _apply_event_patch(ev: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in patch.items():
        if k in ("start_date", "end_date") and isinstance(v, datetime):
            ev[k] = v.isoformat()
        else:
            ev[k] = v
    ev["updated_at"] = utc_now_iso()
    save_store()
    return _as_event_dict(ev)


# -------------------------------------------------------------------
# Organizer endpoints
# -------------------------------------------------------------------


@router.get("/organizer/events")
def organizer_list_events():
    return {"events": [_as_event_dict(e) for e in _EVENTS.values()]}


@router.post("/organizer/events")
def organizer_create_event(payload: EventCreate):
    eid = next_event_id()
    e = {
        "id": eid,
        "title": payload.title,
        "description": payload.description,
        "start_date": payload.start_date.isoformat() if payload.start_date else None,
        "end_date": payload.end_date.isoformat() if payload.end_date else None,
        "venue_name": payload.venue_name,
        "street_address": payload.street_address,
        "city": payload.city,
        "state": payload.state,
        "zip_code": payload.zip_code,
        "ticket_sales_url": payload.ticket_sales_url,
        "google_maps_url": payload.google_maps_url,
        "category": payload.category,
        "heroImageUrl": payload.heroImageUrl,
        "imageUrls": payload.imageUrls or [],
        "videoUrls": payload.videoUrls or [],
        "published": False,
        "archived": False,
        "requirements_published": False,
        "layout_published": False,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "diagram": {"diagram": {}, "version": 1},
    }
    _EVENTS[eid] = e
    save_store()
    return _as_event_dict(e)


@router.get("/organizer/events/{event_id}")
def organizer_get_event(event_id: int):
    return _as_event_dict(_get_event_or_404(event_id))


@router.put("/organizer/events/{event_id}")
def organizer_update_event(event_id: int, payload: EventUpdate):
    ev = _get_event_or_404(event_id)
    patch = payload.model_dump(exclude_unset=True)
    return _apply_event_patch(ev, patch)


@router.patch("/organizer/events/{event_id}")
def organizer_patch_event(event_id: int, payload: Dict[str, Any] = Body(default={})):
    ev = _get_event_or_404(event_id)
    return _apply_event_patch(ev, dict(payload or {}))


@router.delete("/organizer/events/{event_id}")
def organizer_delete_event(event_id: int):
    eid = int(event_id)
    if eid in _EVENTS:
        del _EVENTS[eid]
    if eid in _REQUIREMENTS:
        del _REQUIREMENTS[eid]
    save_store()
    return {"ok": True}


@router.get("/organizer/events/{event_id}/requirements")
def organizer_get_requirements(event_id: int):
    _get_event_or_404(event_id)
    return _REQUIREMENTS.get(int(event_id), {}) or {}


@router.put("/organizer/events/{event_id}/requirements")
def organizer_put_requirements(event_id: int, payload: Dict[str, Any]):
    _get_event_or_404(event_id)
    _REQUIREMENTS[int(event_id)] = payload or {}
    save_store()
    return {"ok": True}


@router.post("/organizer/events/{event_id}/publish")
def organizer_publish_event(event_id: int):
    ev = _get_event_or_404(event_id)
    ev["published"] = True
    ev["archived"] = False
    ev["updated_at"] = utc_now_iso()
    save_store()
    return _as_event_dict(ev)


# ✅ Organizer diagram endpoints — RETURN RAW DOC
@router.get("/organizer/events/{event_id}/diagram")
def organizer_get_event_diagram(event_id: int):
    slot = _ensure_diagram_slot(event_id)
    doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}
    return doc or {}


@router.put("/organizer/events/{event_id}/diagram")
def organizer_put_event_diagram(event_id: int, payload: Dict[str, Any]):
    ev = _get_event_or_404(event_id)
    slot = _ensure_diagram_slot(event_id)

    incoming_doc, incoming_version = _coerce_incoming_diagram_payload(payload)
    existing_doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}

    # ✅ Overwrite guard: don't wipe a non-empty diagram with empty payload
    if _is_effectively_empty_diagram(
        incoming_doc
    ) and not _is_effectively_empty_diagram(existing_doc):
        # just return existing doc (no-op)
        return existing_doc or {}

    current_version = slot.get("version") if isinstance(slot, dict) else None
    next_version = _next_diagram_version(current_version, incoming_version)

    ev["diagram"] = {"diagram": incoming_doc or {}, "version": next_version}
    ev["updated_at"] = utc_now_iso()
    save_store()

    return incoming_doc or {}


# -------------------------------------------------------------------
# Public endpoints
# -------------------------------------------------------------------


@router.get("/public/events")
def public_list_events():
    out = []
    for e in _EVENTS.values():
        if e.get("published") and not e.get("archived"):
            out.append(_as_event_dict(e))
    return {"events": out}


@router.get("/public/events/{event_id}")
def public_get_event(event_id: int):
    ev = _get_event_or_404(event_id)
    if not ev.get("published") or ev.get("archived"):
        raise HTTPException(status_code=404, detail="Event not found")
    return _as_event_dict(ev)


@router.get("/events/{event_id}")
def public_get_event_alias(event_id: int):
    return public_get_event(event_id)


@router.get("/events/{event_id}/requirements")
def public_get_event_requirements(event_id: int):
    _get_event_or_404(event_id)
    return _REQUIREMENTS.get(int(event_id), {}) or {}


@router.get("/events/{event_id}/diagram")
def public_get_event_diagram(event_id: int):
    _get_event_or_404(event_id)
    slot = _ensure_diagram_slot(event_id)
    doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}
    return doc or {}


@router.get("/vendor/events")
def vendor_list_events_alias():
    return public_list_events()


@router.patch("/events/{event_id}")
def public_patch_event_alias(event_id: int, payload: Dict[str, Any] = Body(default={})):
    ev = _get_event_or_404(event_id)
    return _apply_event_patch(ev, dict(payload or {}))
