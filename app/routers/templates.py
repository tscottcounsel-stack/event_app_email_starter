# app/routers/templates.py
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.store import _TEMPLATES, next_template_id

router = APIRouter(prefix="/templates", tags=["Templates"])


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1)
    description: Optional[str] = None
    data: Dict[str, Any]


class TemplateOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    data: Dict[str, Any]


@router.get("", response_model=list[TemplateOut])
def list_templates():
    return list(_TEMPLATES.values())


@router.post("", response_model=TemplateOut)
def create_template(body: TemplateCreate):
    tid = next_template_id()
    tpl = {
        "id": tid,
        "name": body.name,
        "description": body.description,
        "data": body.data,
    }
    _TEMPLATES[tid] = tpl
    return tpl


@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: int):
    tpl = _TEMPLATES.get(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@router.delete("/{template_id}")
def delete_template(template_id: int):
    if template_id not in _TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")
    del _TEMPLATES[template_id]
    return {"ok": True}
