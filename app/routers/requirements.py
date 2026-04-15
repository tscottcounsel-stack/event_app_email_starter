from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.store import _EVENTS, _REQUIREMENTS, save_store

router = APIRouter(tags=["Requirements"])


class RequirementsSavePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    requirements: Optional[Dict[str, Any]] = None
    version: Optional[Any] = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_event(event_id: int) -> Dict[str, Any]:
    e = _EVENTS.get(event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    return e


def _empty_requirements_shape() -> Dict[str, Any]:
    return {
        "global": {"compliance": [], "documents": []},
        "categories": {
            "Food & Beverage": {"compliance": [], "documents": []},
            "Art": {"compliance": [], "documents": []},
            "Clothing": {"compliance": [], "documents": []},
            "Beauty": {"compliance": [], "documents": []},
            "Services": {"compliance": [], "documents": []},
            "Tech": {"compliance": [], "documents": []},
            "Other": {"compliance": [], "documents": []},
        },
    }


def _normalize_save_body(payload: RequirementsSavePayload) -> Tuple[Dict[str, Any], int]:
    raw = payload.model_dump()

    if isinstance(raw.get("requirements"), dict):
        req = raw["requirements"] or {}
        ver_raw = raw.get("version")
    else:
        req = raw
        ver_raw = raw.get("version")

    try:
        ver = int(ver_raw) if ver_raw is not None else 1
    except Exception:
        ver = 1

    normalized = _empty_requirements_shape()

    if isinstance(req.get("global"), dict):
        normalized["global"] = {
            "compliance": list(req.get("global", {}).get("compliance", []) or []),
            "documents": list(req.get("global", {}).get("documents", []) or []),
        }

    if isinstance(req.get("categories"), dict):
        for key, value in req.get("categories", {}).items():
            if isinstance(value, dict):
                normalized["categories"][key] = {
                    "compliance": list(value.get("compliance", []) or []),
                    "documents": list(value.get("documents", []) or []),
                }

    return normalized, ver


def _mark_event_requirements_saved(event_id: int, version: int) -> None:
    e = _ensure_event(event_id)
    e["requirements_published"] = True
    e["requirements_version"] = version
    e["requirements_updated_at"] = _utc_now_iso()


def _saved_payload(event_id: int) -> Dict[str, Any]:
    saved = _REQUIREMENTS.get(event_id)
    if not saved:
        return {"requirements": _empty_requirements_shape(), "version": 1}

    req = saved.get("requirements") if isinstance(saved.get("requirements"), dict) else _empty_requirements_shape()
    ver = saved.get("version", 1)
    return {
        "requirements": req,
        "version": int(ver) if str(ver).isdigit() else 1,
    }


@router.get("/organizer/events/{event_id}/requirements")
def organizer_get_event_requirements(event_id: int):
    _ensure_event(event_id)
    return _saved_payload(event_id)


@router.put("/organizer/events/{event_id}/requirements")
def organizer_put_event_requirements(event_id: int, payload: RequirementsSavePayload):
    _ensure_event(event_id)
    req, ver = _normalize_save_body(payload)

    _REQUIREMENTS[event_id] = {"requirements": req, "version": ver}
    _mark_event_requirements_saved(event_id, ver)
    save_store()

    return {"ok": True, "version": ver, "requirements": req}


@router.post("/organizer/events/{event_id}/requirements")
def organizer_post_event_requirements(event_id: int, payload: RequirementsSavePayload):
    return organizer_put_event_requirements(event_id, payload)


@router.get("/events/{event_id}/requirements")
def public_get_event_requirements(event_id: int):
    _ensure_event(event_id)
    return _saved_payload(event_id)
