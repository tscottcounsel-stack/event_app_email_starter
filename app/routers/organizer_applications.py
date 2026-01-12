# app/routers/organizer_applications.py
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import MetaData, Table, select, update
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer-applications"])


# ----------------------------
# Helpers
# ----------------------------


def _reflect_vendor_applications(db: Session) -> Table:
    md = MetaData()
    # "vendor_applications" is your current working backing table for organizer apps
    return Table("vendor_applications", md, autoload_with=db.get_bind())


def _col(t: Table, name: str):
    return t.c.get(name)


# ----------------------------
# Schemas
# ----------------------------


class OrganizerApplicationsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: int
    items: list[dict[str, Any]]


class OrganizerApplicationPatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    # If provided:
    # - assigned_slot_id: int >= 1 => assign/reassign
    # - assigned_slot_id: null      => unassign
    assigned_slot_id: Optional[int] = None
    status: Optional[str] = None

    @field_validator("assigned_slot_id")
    @classmethod
    def _validate_assigned_slot_id(cls, v: Optional[int]):
        if v is None:
            return v
        if int(v) < 1:
            raise ValueError("assigned_slot_id must be >= 1 or null")
        return int(v)


# ----------------------------
# Routes
# ----------------------------


@router.get("/{event_id}/applications", response_model=OrganizerApplicationsResponse)
def list_organizer_applications(
    event_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    t = _reflect_vendor_applications(db)

    c_event = _col(t, "event_id")
    if c_event is None:
        raise HTTPException(500, "vendor_applications missing event_id column")

    stmt = (
        select(t)
        .where(c_event == event_id)
        .order_by(_col(t, "id") if _col(t, "id") is not None else c_event.asc())
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(stmt).mappings().all()
    return {"event_id": event_id, "items": [dict(r) for r in rows]}


@router.patch("/{event_id}/applications/{app_id}")
def patch_organizer_application(
    event_id: int,
    app_id: int,
    payload: OrganizerApplicationPatch,
    db: Session = Depends(get_db),
):
    t = _reflect_vendor_applications(db)

    c_id = _col(t, "id")
    c_event = _col(t, "event_id")
    if c_id is None:
        raise HTTPException(500, "vendor_applications missing id column")
    if c_event is None:
        raise HTTPException(500, "vendor_applications missing event_id column")

    values: dict[str, Any] = {}

    # IMPORTANT: support explicit null for unassign
    if "assigned_slot_id" in payload.model_fields_set:
        c_assigned = _col(t, "assigned_slot_id")
        if c_assigned is None:
            raise HTTPException(
                500, "vendor_applications missing assigned_slot_id column"
            )
        values[c_assigned.name] = (
            None if payload.assigned_slot_id is None else int(payload.assigned_slot_id)
        )

    if payload.status is not None:
        c_status = _col(t, "status")
        if c_status is None:
            raise HTTPException(500, "vendor_applications missing status column")
        values[c_status.name] = str(payload.status)

    if not values:
        return {"event_id": event_id, "item": None}

    stmt = (
        update(t)
        .where(c_event == event_id)
        .where(c_id == app_id)
        .values(**values)
        .returning(t)
    )

    try:
        row = db.execute(stmt).mappings().first()
        db.commit()
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Update failed: {ex}")

    if not row:
        raise HTTPException(404, "Application not found for this event")

    return {"event_id": event_id, "item": dict(row)}
