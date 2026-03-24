from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from app.store import _REQUIREMENT_TEMPLATES, save_store

router = APIRouter(tags=["Requirement Templates"])


# -------------------------------------------------------------------
# Models
# -------------------------------------------------------------------


class RequirementTemplateCreate(BaseModel):
    name: str = Field(min_length=1)
    category: str | None = None
    payload: Dict[str, Any]


class RequirementTemplateUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    payload: Dict[str, Any] | None = None


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _get_template_or_404(template_id: str):
    t = _REQUIREMENT_TEMPLATES.get(template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


# -------------------------------------------------------------------
# Organizer Template Endpoints
# -------------------------------------------------------------------


@router.get("/organizer/requirement-templates")
def list_templates():
    return {"items": list(_REQUIREMENT_TEMPLATES.values())}


@router.post("/organizer/requirement-templates")
def create_template(payload: RequirementTemplateCreate):

    tid = f"tmpl_{len(_REQUIREMENT_TEMPLATES)+1}"

    t = {
        "id": tid,
        "name": payload.name,
        "category": payload.category,
        "payload": payload.payload,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
    }

    _REQUIREMENT_TEMPLATES[tid] = t
    save_store()

    return t


@router.put("/organizer/requirement-templates/{template_id}")
def update_template(template_id: str, payload: RequirementTemplateUpdate):

    t = _get_template_or_404(template_id)

    if payload.name is not None:
        t["name"] = payload.name

    if payload.category is not None:
        t["category"] = payload.category

    if payload.payload is not None:
        t["payload"] = payload.payload

    t["updated_at"] = utc_now_iso()

    save_store()

    return t


@router.delete("/organizer/requirement-templates/{template_id}")
def delete_template(template_id: str):

    if template_id not in _REQUIREMENT_TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    del _REQUIREMENT_TEMPLATES[template_id]

    save_store()

    return {"ok": True}
