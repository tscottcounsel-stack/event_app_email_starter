# app/routers/applications.py
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import MetaData, Table, select, update
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/applications", tags=["applications"])


def _reflect_applications(db: Session) -> Table:
    md = MetaData()
    return Table("applications", md, autoload_with=db.get_bind())


def _col(t: Table, name: str):
    return t.c.get(name)


class ApplicationsListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[dict[str, Any]]
    limit: int
    offset: int


class ApplicationPatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Optional[str] = None
    notes: Optional[str] = None

    # Assign/reassign: int >= 1
    # Unassign: null
    assigned_slot_id: Optional[int] = None

    @field_validator("assigned_slot_id")
    @classmethod
    def _validate_assigned_slot_id(cls, v: Optional[int]):
        if v is None:
            return v
        if int(v) < 1:
            raise ValueError("assigned_slot_id must be >= 1 or null")
        return int(v)


@router.get("/diag/ping")
def ping():
    return {"ping": "pong"}


@router.get("", response_model=ApplicationsListResponse)
def list_applications(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    t = _reflect_applications(db)
    c_id = _col(t, "id")
    stmt = (
        select(t)
        .order_by(c_id.desc() if c_id is not None else list(t.c)[0])
        .limit(limit)
        .offset(offset)
    )
    rows = db.execute(stmt).mappings().all()
    return {"items": [dict(r) for r in rows], "limit": limit, "offset": offset}


@router.patch("/id/{application_id}")
def patch_application_by_id(
    application_id: int,
    payload: ApplicationPatch,
    db: Session = Depends(get_db),
):
    t = _reflect_applications(db)
    c_id = _col(t, "id")
    if c_id is None:
        raise HTTPException(500, "applications table missing id column")

    values: dict[str, Any] = {}

    if payload.status is not None and _col(t, "status") is not None:
        values["status"] = str(payload.status)

    if payload.notes is not None and _col(t, "notes") is not None:
        values["notes"] = payload.notes

    # IMPORTANT: allow explicit null for unassign
    if "assigned_slot_id" in payload.model_fields_set:
        if _col(t, "assigned_slot_id") is None:
            raise HTTPException(
                500, "applications table missing assigned_slot_id column"
            )
        values["assigned_slot_id"] = (
            None if payload.assigned_slot_id is None else int(payload.assigned_slot_id)
        )

    if not values:
        row = db.execute(select(t).where(c_id == application_id)).mappings().first()
        if not row:
            raise HTTPException(404, "Application not found")
        return dict(row)

    stmt = update(t).where(c_id == application_id).values(**values).returning(t)
    try:
        row = db.execute(stmt).mappings().first()
        db.commit()
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Update failed: {ex}")

    if not row:
        raise HTTPException(404, "Application not found")

    return dict(row)


@router.patch("/{application_id}")
def patch_application_alias(
    application_id: int, payload: ApplicationPatch, db: Session = Depends(get_db)
):
    return patch_application_by_id(application_id, payload, db)
