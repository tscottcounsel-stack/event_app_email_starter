# app/routers/requirements_alias.py
from __future__ import annotations

from fastapi import APIRouter

from app.store import _EVENTS, save_store

router = APIRouter(prefix="/requirements", tags=["Requirements Alias"])


def _ensure_defaults(e: dict) -> dict:
    e.setdefault("requirements", {})
    e.setdefault("requirements_version", 0)
    return e


@router.get("/{event_id}")
def get_requirements_alias(event_id: int):
    e = _EVENTS.get(event_id)
    if not e:
        return {"requirements": {}, "version": 0}
    e = _ensure_defaults(e)
    return {"requirements": e["requirements"], "version": e["requirements_version"]}


@router.put("/{event_id}")
def put_requirements_alias(event_id: int, body: dict):
    e = _EVENTS.get(event_id)
    if not e:
        # create empty event record not allowed; keep strict
        return {"requirements": {}, "version": 0}

    e = _ensure_defaults(e)
    e["requirements"] = body.get("requirements") or body or {}
    # bump version if not provided
    incoming = body.get("version")
    e["requirements_version"] = (
        int(incoming) if incoming is not None else int(e["requirements_version"]) + 1
    )
    _EVENTS[event_id] = e
    save_store()
    return {"requirements": e["requirements"], "version": e["requirements_version"]}
