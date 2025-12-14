# app/routers/organizer_diagram.py
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import MetaData, Table, insert, select, text, update
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer-diagram"])


# ----------------------------
# Reflection helpers
# ----------------------------


def _reflect(db: Session, name: str) -> Table:
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


def _require(t: Table, *names: str):
    c = _col(t, *names)
    if c is None:
        raise HTTPException(
            500, f"Table '{t.name}' missing required column(s): {names}"
        )
    return c


def _now_sql():
    return text("now()")


def _history_table(db: Session) -> Optional[Table]:
    try:
        return _reflect(db, "event_diagram_history")
    except Exception:
        return None


# ----------------------------
# Schemas
# ----------------------------


class SaveDiagramBody(BaseModel):
    model_config = ConfigDict(extra="allow")
    diagram: dict[str, Any]
    expect_version: Optional[int] = None
    reason: Optional[str] = None
    tag: Optional[str] = None
    changed_by: Optional[int] = None


# ----------------------------
# Routes
# ----------------------------


@router.get("/{event_id}/diagram")
def get_event_diagram(event_id: int, db: Session = Depends(get_db)):
    t = _reflect(db, "event_diagram")

    c_event_id = _require(t, "event_id", "events_id")
    c_diagram = _require(
        t, "diagram", "data", "payload", "diagram_json", "diagram_data"
    )
    c_version = _col(t, "version", "rev", "revision")
    c_id = _col(t, "id")

    cols = [c_diagram]
    if c_version is not None:
        cols.append(c_version)
    if c_id is not None:
        cols.append(c_id)

    q = select(*cols).where(c_event_id == event_id)
    if c_id is not None:
        q = q.order_by(c_id.desc())
    q = q.limit(1)

    row = db.execute(q).mappings().first()
    if not row:
        # UI-friendly empty payload (matches your current "slots/width/height" shape)
        return {
            "event_id": event_id,
            "version": 0,
            "diagram": {"width": 32, "height": 16, "slots": []},
        }

    diagram = row.get(c_diagram.name) or {"width": 32, "height": 16, "slots": []}
    version = int(row.get(c_version.name) or 0) if c_version is not None else 0
    return {"event_id": event_id, "version": version, "diagram": diagram}


@router.get("/{event_id}/diagram/history")
def get_event_diagram_history(
    event_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    h = _history_table(db)
    if h is None:
        return {"event_id": event_id, "items": []}

    c_event_id = _require(h, "event_id", "events_id", "eventid")
    c_id = _col(h, "id")
    c_version = _col(h, "version", "rev", "revision")
    c_created_at = _col(h, "created_at")
    c_tag = _col(h, "tag")
    c_reason = _col(h, "reason")
    c_changed_by = _col(h, "changed_by")

    cols = [
        c
        for c in [c_id, c_version, c_created_at, c_tag, c_reason, c_changed_by]
        if c is not None
    ]
    if not cols:
        cols = [h]

    q = select(*cols).where(c_event_id == event_id)
    if c_id is not None:
        q = q.order_by(c_id.desc())
    q = q.limit(int(limit))

    rows = db.execute(q).mappings().all()
    items: list[dict[str, Any]] = []
    for r in rows:
        items.append(
            {
                "id": r.get(c_id.name) if c_id is not None else None,
                "version": r.get(c_version.name) if c_version is not None else None,
                "created_at": (
                    r.get(c_created_at.name) if c_created_at is not None else None
                ),
                "tag": r.get(c_tag.name) if c_tag is not None else None,
                "reason": r.get(c_reason.name) if c_reason is not None else None,
                "changed_by": (
                    r.get(c_changed_by.name) if c_changed_by is not None else None
                ),
            }
        )

    return {"event_id": event_id, "items": items}


@router.put("/{event_id}/diagram")
def save_event_diagram(
    event_id: int,
    payload: SaveDiagramBody,
    db: Session = Depends(get_db),
):
    t = _reflect(db, "event_diagram")
    h = _history_table(db)

    c_event_id = _require(t, "event_id", "events_id")
    c_diagram = _require(
        t, "diagram", "data", "payload", "diagram_json", "diagram_data"
    )
    c_version = _col(t, "version", "rev", "revision")
    c_updated_at = _col(t, "updated_at", "modified_at")

    if c_version is None:
        raise HTTPException(
            500, f"{t.name} missing version column (version/rev/revision)"
        )

    # Load current row
    current = (
        db.execute(select(t).where(c_event_id == event_id).limit(1)).mappings().first()
    )

    # Create if missing
    if not current:
        ins = {
            c_event_id.name: event_id,
            c_diagram.name: payload.diagram,
            c_version.name: 1,
        }
        if c_updated_at is not None:
            ins[c_updated_at.name] = _now_sql()
        try:
            db.execute(insert(t).values(**ins))
            db.commit()
        except Exception as ex:
            db.rollback()
            raise HTTPException(500, f"Insert failed: {ex}")

        row = (
            db.execute(select(t).where(c_event_id == event_id).limit(1))
            .mappings()
            .first()
        )
        return {
            "event_id": event_id,
            "version": int(row.get(c_version.name) or 0),
            "diagram": row.get(c_diagram.name) or {},
        }

    # Optimistic concurrency
    if payload.expect_version is not None:
        cur_ver = int(current.get(c_version.name) or 0)
        if cur_ver != int(payload.expect_version):
            raise HTTPException(
                409,
                detail={
                    "code": "version_mismatch",
                    "message": "Diagram version mismatch",
                    "current_version": cur_ver,
                },
            )

    # Snapshot to history (best-effort)
    if h is not None:
        try:
            h_event_id = _col(h, "event_id", "events_id", "eventid")
            h_data = _col(h, "data")
            h_version = _col(h, "version", "rev", "revision")
            if h_event_id is not None and h_data is not None and h_version is not None:
                hv = {
                    h_event_id.name: event_id,
                    h_data.name: current.get(c_diagram.name) or {},
                    h_version.name: int(current.get(c_version.name) or 0),
                }
                h_reason = _col(h, "reason")
                h_tag = _col(h, "tag")
                h_changed_by = _col(h, "changed_by")
                h_created_at = _col(h, "created_at")

                if h_reason is not None and payload.reason is not None:
                    hv[h_reason.name] = str(payload.reason)
                if h_tag is not None and payload.tag is not None:
                    hv[h_tag.name] = str(payload.tag)
                if h_changed_by is not None and payload.changed_by is not None:
                    hv[h_changed_by.name] = int(payload.changed_by)
                if h_created_at is not None:
                    hv[h_created_at.name] = _now_sql()

                db.execute(insert(h).values(**hv))
                db.commit()
        except Exception:
            db.rollback()
            # do not block saving if history fails

    # Update canonical
    values = {
        c_diagram.name: payload.diagram,
        c_version.name: (c_version + 1),
    }
    if c_updated_at is not None:
        values[c_updated_at.name] = _now_sql()

    try:
        db.execute(update(t).where(c_event_id == event_id).values(**values))
        db.commit()
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Update failed: {ex}")

    row = (
        db.execute(select(t).where(c_event_id == event_id).limit(1)).mappings().first()
    )
    return {
        "event_id": event_id,
        "version": int(row.get(c_version.name) or 0),
        "diagram": row.get(c_diagram.name) or {},
    }
