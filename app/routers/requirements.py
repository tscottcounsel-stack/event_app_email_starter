from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.store import _REQUIREMENTS, save_store

router = APIRouter(tags=["Requirements"])


class RequirementsSavePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    requirements: Optional[Dict[str, Any]] = None
    version: Optional[Any] = None


CATEGORY_DEFAULTS: Dict[str, Dict[str, list[dict[str, Any]]]] = {
    "Food & Beverage": {
        "compliance": [
            {
                "id": "food_safety_certification",
                "text": "Food staff must follow food safety handling requirements",
                "required": True,
            }
        ],
        "documents": [
            {
                "id": "health_permit",
                "name": "Health permit",
                "required": True,
            }
        ],
    },
    "Art": {"compliance": [], "documents": []},
    "Clothing": {"compliance": [], "documents": []},
    "Beauty": {
        "compliance": [
            {
                "id": "product_safety_disclosure",
                "text": "Beauty vendors must disclose any regulated or restricted product use",
                "required": True,
            }
        ],
        "documents": [],
    },
    "Services": {"compliance": [], "documents": []},
    "Tech": {
        "compliance": [
            {
                "id": "electrical_equipment_safety",
                "text": "Electrical equipment must meet safety requirements",
                "required": True,
            }
        ],
        "documents": [
            {
                "id": "demo_or_activation_plan",
                "name": "Demo or activation plan",
                "required": True,
            }
        ],
    },
    "Other": {"compliance": [], "documents": []},
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_event(db: Session, event_id: int) -> Event:
    event = db.query(Event).filter(Event.id == int(event_id)).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _clone_items(values: list[Any]) -> list[Any]:
    out: list[Any] = []
    for item in values or []:
        if isinstance(item, dict):
            out.append(dict(item))
        else:
            out.append(item)
    return out


def _bucket_from_raw(raw: Any) -> Dict[str, list[Any]]:
    source = raw if isinstance(raw, dict) else {}
    return {
        "compliance": _clone_items(list(source.get("compliance", []) or [])),
        "documents": _clone_items(list(source.get("documents", []) or [])),
    }


def _default_bucket(category: str) -> Dict[str, list[Any]]:
    source = CATEGORY_DEFAULTS.get(category, {"compliance": [], "documents": []})
    return {
        "compliance": _clone_items(source.get("compliance", [])),
        "documents": _clone_items(source.get("documents", [])),
    }


def _empty_requirements_shape() -> Dict[str, Any]:
    return {
        "global": {"compliance": [], "documents": []},
        "categories": {
            "Food & Beverage": _default_bucket("Food & Beverage"),
            "Art": _default_bucket("Art"),
            "Clothing": _default_bucket("Clothing"),
            "Beauty": _default_bucket("Beauty"),
            "Services": _default_bucket("Services"),
            "Tech": _default_bucket("Tech"),
            "Other": _default_bucket("Other"),
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
        normalized["global"] = _bucket_from_raw(req.get("global"))

    if isinstance(req.get("categories"), dict):
        for key, value in req.get("categories", {}).items():
            if isinstance(value, dict):
                normalized["categories"][key] = _bucket_from_raw(value)

    return normalized, ver


def _mark_event_requirements_saved(db: Session, event_id: int, version: int) -> None:
    event = _ensure_event(db, event_id)
    event.requirements_published = True
    db.add(event)
    db.commit()
    db.refresh(event)


def _saved_payload(event_id: int) -> Dict[str, Any]:
    saved = _REQUIREMENTS.get(int(event_id))
    if not saved:
        return {"requirements": _empty_requirements_shape(), "version": 1}

    req = (
        saved.get("requirements")
        if isinstance(saved, dict) and isinstance(saved.get("requirements"), dict)
        else _empty_requirements_shape()
    )
    ver = saved.get("version", 1) if isinstance(saved, dict) else 1

    try:
        version = int(ver)
    except Exception:
        version = 1

    return {
        "requirements": req,
        "version": version,
    }


@router.get("/organizer/events/{event_id}/requirements")
def organizer_get_event_requirements(event_id: int, db: Session = Depends(get_db)):
    _ensure_event(db, event_id)
    return _saved_payload(event_id)


@router.put("/organizer/events/{event_id}/requirements")
def organizer_put_event_requirements(
    event_id: int,
    payload: RequirementsSavePayload,
    db: Session = Depends(get_db),
):
    _ensure_event(db, event_id)
    requirements, version = _normalize_save_body(payload)

    _REQUIREMENTS[int(event_id)] = {"requirements": requirements, "version": version}
    _mark_event_requirements_saved(db, event_id, version)
    save_store()

    return {"ok": True, "version": version, "requirements": requirements}


@router.post("/organizer/events/{event_id}/requirements")
def organizer_post_event_requirements(
    event_id: int,
    payload: RequirementsSavePayload,
    db: Session = Depends(get_db),
):
    return organizer_put_event_requirements(event_id, payload, db)


@router.get("/events/{event_id}/requirements")
def public_get_event_requirements(event_id: int, db: Session = Depends(get_db)):
    event = _ensure_event(db, event_id)
    if not bool(event.published) or bool(event.archived):
        raise HTTPException(status_code=404, detail="Event not found")
    return _saved_payload(event_id)
