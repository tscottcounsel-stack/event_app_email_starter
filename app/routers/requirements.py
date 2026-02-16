# app/routers/requirements.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.store import _EVENTS, _REQUIREMENTS

router = APIRouter(tags=["Requirements"])


class RequirementsSavePayload(BaseModel):
    """
    Accepts BOTH:
      A) { "requirements": {...}, "version": 2 }
      B) a model-like dict (organizer UI may send fields directly)

    We keep extra="allow" so frontend payload drift doesn't 422.
    """

    model_config = ConfigDict(extra="allow")

    requirements: Optional[Dict[str, Any]] = None
    version: Optional[Any] = None  # backend wants int, but we normalize


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_event(event_id: int) -> Dict[str, Any]:
    e = _EVENTS.get(event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    return e


def _normalize_save_body(
    payload: RequirementsSavePayload,
) -> Tuple[Dict[str, Any], int]:
    """
    Returns (requirements_dict, version_int)
    """
    raw = payload.model_dump()

    # If wrapped { requirements: {...}, version: ... } use it.
    if isinstance(raw.get("requirements"), dict):
        req = raw["requirements"] or {}
        ver_raw = raw.get("version")
    else:
        # Otherwise the organizer sent a model-like dict directly
        req = raw
        ver_raw = raw.get("version")

    # Normalize version to an int if possible, else default to 1
    try:
        ver = int(ver_raw) if ver_raw is not None else 1
    except Exception:
        ver = 1

    return req, ver


def _mark_event_requirements_saved(event_id: int, version: int) -> None:
    """
    Persist simple progress flags onto the event object so the organizer
    dashboard (events list) can reflect step completion.

    We do NOT auto-publish the event here.
    """
    e = _ensure_event(event_id)

    # Progress flags the UI can use (optional)
    e["requirements_published"] = True
    e["requirements_version"] = version
    e["requirements_updated_at"] = _utc_now_iso()

    # Optional: If you want a single combined "ready" indicator
    # (requires layout_published to be set by the map editor save route):
    # e["ready_to_publish"] = bool(e.get("requirements_published") and e.get("layout_published"))


# ---------------------------------------------------------
# Organizer endpoints (canonical)
# ---------------------------------------------------------


@router.get("/organizer/events/{event_id}/requirements")
def organizer_get_event_requirements(event_id: int):
    _ensure_event(event_id)
    saved = _REQUIREMENTS.get(event_id)

    if not saved:
        return {"requirements": {}, "version": 0}

    return {
        "requirements": saved.get("requirements", {}) or {},
        "version": saved.get("version", 0) or 0,
    }


@router.put("/organizer/events/{event_id}/requirements")
def organizer_put_event_requirements(event_id: int, payload: RequirementsSavePayload):
    _ensure_event(event_id)
    req, ver = _normalize_save_body(payload)

    _REQUIREMENTS[event_id] = {"requirements": req, "version": ver}

    # Update the event record so organizer dashboard can reflect progress
    _mark_event_requirements_saved(event_id, ver)

    return {"ok": True, "version": ver}


@router.post("/organizer/events/{event_id}/requirements")
def organizer_post_event_requirements(event_id: int, payload: RequirementsSavePayload):
    # behave same as PUT for now
    return organizer_put_event_requirements(event_id, payload)


# ---------------------------------------------------------
# Public/Vendor-facing endpoint
# ---------------------------------------------------------


@router.get("/events/{event_id}/requirements")
def public_get_event_requirements(event_id: int):
    _ensure_event(event_id)
    saved = _REQUIREMENTS.get(event_id)

    if not saved:
        # IMPORTANT: return {} not null so vendor UI can render empty state cleanly
        return {"requirements": {}, "version": 0}

    return {
        "requirements": saved.get("requirements", {}) or {},
        "version": saved.get("version", 0) or 0,
    }
