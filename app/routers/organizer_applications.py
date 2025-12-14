# app/routers/organizer_applications.py
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import MetaData, Table, select, update
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer-applications"])


# ----------------------------
# Reflection helpers (no model imports)
# ----------------------------


def _reflect_table(db: Session, name: str) -> Table:
    bind = db.get_bind()
    if bind is None:
        raise HTTPException(500, "Database bind not available")
    md = MetaData()
    try:
        return Table(name, md, autoload_with=bind)
    except Exception as ex:
        raise HTTPException(500, f"Could not reflect table '{name}': {ex}")


def _col(t: Table, *names: str):
    for n in names:
        if n in t.c:
            return t.c[n]
    return None


def _require_col(t: Table, *names: str):
    c = _col(t, *names)
    if c is None:
        raise HTTPException(
            500, f"Table '{t.name}' missing required column(s): {names}"
        )
    return c


def _row_to_dict(row: Any) -> dict[str, Any]:
    # row is a SQLAlchemy RowMapping
    return dict(row)


# ----------------------------
# Schemas
# ----------------------------


class OrganizerApplicationsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: int
    items: list[dict[str, Any]]


class OrganizerApplicationPatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    assigned_slot_id: Optional[int] = Field(default=None, ge=1)
    status: Optional[str] = None


# ----------------------------
# Routes
# ----------------------------


@router.get("/{event_id}/applications", response_model=OrganizerApplicationsResponse)
def list_event_applications(
    event_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Returns vendor applications for an event.
    Reflection-based so it doesn't depend on model names.
    """
    t = _reflect_table(db, "vendor_applications")

    c_event_id = _require_col(t, "event_id", "events_id")
    c_id = _col(t, "id")
    if c_id is None:
        raise HTTPException(500, "vendor_applications missing id column")

    q = select(t).where(c_event_id == event_id).order_by(c_id.desc()).limit(int(limit))

    try:
        rows = db.execute(q).mappings().all()
    except Exception as ex:
        raise HTTPException(500, f"Query failed: {ex}")

    return {"event_id": event_id, "items": [_row_to_dict(r) for r in rows]}


@router.patch("/{event_id}/applications/{app_id}")
def patch_event_application(
    event_id: int,
    app_id: int,
    payload: OrganizerApplicationPatch,
    db: Session = Depends(get_db),
):
    """
    Minimal patch:
      - assigned_slot_id
      - status
    Mirrors what you successfully called:
      PATCH /organizer/events/{event_id}/applications/{app_id}
    """
    t = _reflect_table(db, "vendor_applications")

    c_id = _require_col(t, "id")
    c_event_id = _require_col(t, "event_id", "events_id")

    values: dict[str, Any] = {}
    if payload.assigned_slot_id is not None:
        c_assigned = _col(t, "assigned_slot_id")
        if c_assigned is None:
            raise HTTPException(
                500, "vendor_applications missing assigned_slot_id column"
            )
        values[c_assigned.name] = int(payload.assigned_slot_id)

    if payload.status is not None:
        c_status = _col(t, "status")
        if c_status is None:
            raise HTTPException(500, "vendor_applications missing status column")
        values[c_status.name] = str(payload.status)

    if not values:
        return {"event_id": event_id, "item": None}

    stmt = (
        update(t)
        .where(c_id == app_id)
        .where(c_event_id == event_id)
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
