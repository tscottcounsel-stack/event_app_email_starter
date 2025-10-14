# app/routers/slots.py
from __future__ import annotations

# ---- Auth + role gates (prod/DEV toggle) -------------------------------------
import os

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, conint
from sqlalchemy.orm import Session

from app.db import get_db


def _noop_user():
    return None


require_auth = os.environ.get("REQUIRE_AUTH", "1") == "1"
use_dev_auth = os.environ.get("DEV_AUTH", "0") == "1"

if require_auth:
    if use_dev_auth:
        # Fixed Bearer token flow for local dev
        from app.auth_dev import get_current_user_dev

        auth_dep = Depends(get_current_user_dev)
    else:
        # Real auth (if available); otherwise no-op to avoid startup failures
        try:
            from app.auth import get_current_user  # your real dependency

            auth_dep = Depends(get_current_user)
        except Exception:
            auth_dep = Depends(_noop_user)
else:
    # Full bypass (legacy dev mode)
    auth_dep = Depends(_noop_user)


def _role_required_noop(*roles: str):
    def _dep():
        return None

    return _dep


if require_auth and not use_dev_auth:
    try:
        from app.deps import role_required as _role_required_real

        role_required = _role_required_real
    except Exception:
        role_required = _role_required_noop
else:
    role_required = _role_required_noop

# ── Router (single instance) ──────────────────────────────────────────────────
router = APIRouter(
    prefix="/events/{event_id}/slots",
    tags=["event-slots"],
    dependencies=[auth_dep],  # apply auth to all endpoints (no-op when REQUIRE_AUTH=0)
)


# ── Schemas ──────────────────────────────────────────────────────────────────
class SlotCreate(BaseModel):
    label: str
    price_cents: conint(ge=0) = 0
    coord_x: int | None = None
    coord_y: int | None = None
    width: int | None = None
    height: int | None = None
    notes: str | None = None


class SlotPatch(BaseModel):
    label: str | None = None
    price_cents: conint(ge=0) | None = None
    coord_x: int | None = None
    coord_y: int | None = None
    width: int | None = None
    height: int | None = None
    notes: str | None = None
    status: str | None = None  # 'available' | 'held' | 'booked' | 'blocked' ...


# ── Routes ───────────────────────────────────────────────────────────────────
@router.get("")
def list_event_slots(event_id: int, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            sa.text(
                """
        SELECT id, event_id, label, coord_x, coord_y, width, height,
               price_cents, status, notes
        FROM public.event_slots
        WHERE event_id = :eid
        ORDER BY label
    """
            ),
            {"eid": event_id},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


@router.get("/{slot_id}")
def get_event_slot(event_id: int, slot_id: int, db: Session = Depends(get_db)):
    row = (
        db.execute(
            sa.text(
                """
        SELECT id, event_id, label, coord_x, coord_y, width, height,
               price_cents, status, notes
        FROM public.event_slots
        WHERE id = :sid AND event_id = :eid
    """
            ),
            {"sid": slot_id, "eid": event_id},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="slot not found"
        )
    return dict(row)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(role_required("organizer", "admin"))],
)
def create_event_slot(event_id: int, p: SlotCreate, db: Session = Depends(get_db)):
    # app-layer uniqueness guard (DB unique recommended too)
    dup = db.execute(
        sa.text(
            """
        SELECT 1 FROM public.event_slots
        WHERE event_id = :eid AND label = :lbl
        LIMIT 1
    """
        ),
        {"eid": event_id, "lbl": p.label},
    ).first()
    if dup:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="slot label already exists for this event",
        )

    row = db.execute(
        sa.text(
            """
        INSERT INTO public.event_slots
          (event_id, label, coord_x, coord_y, width, height, price_cents, status, notes)
        VALUES
          (:event_id, :label, :coord_x, :coord_y, :width, :height, :price_cents, 'available', :notes)
        RETURNING id
    """
        ),
        {"event_id": event_id, **p.model_dump()},
    ).fetchone()
    db.commit()
    return {"id": row.id}


@router.patch("/{slot_id}", dependencies=[Depends(role_required("organizer", "admin"))])
def patch_event_slot(
    event_id: int, slot_id: int, p: SlotPatch, db: Session = Depends(get_db)
):
    if p.label is not None:
        dup = db.execute(
            sa.text(
                """
            SELECT 1 FROM public.event_slots
            WHERE event_id = :eid AND label = :lbl AND id <> :sid
            LIMIT 1
        """
            ),
            {"eid": event_id, "lbl": p.label, "sid": slot_id},
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="slot label already exists for this event",
            )

    data = {k: v for k, v in p.model_dump().items() if v is not None}
    if not data:
        return {"updated": False}

    sets = ", ".join(f"{k} = :{k}" for k in data.keys())
    params = {"event_id": event_id, "slot_id": slot_id, **data}
    row = (
        db.execute(
            sa.text(
                f"""
        UPDATE public.event_slots
        SET {sets}
        WHERE id = :slot_id AND event_id = :event_id
        RETURNING id, event_id, label, price_cents, status, coord_x, coord_y, width, height, notes
    """
            ),
            params,
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="slot not found"
        )
    db.commit()
    return dict(row)


@router.delete(
    "/{slot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(role_required("organizer", "admin"))],
)
def delete_event_slot(event_id: int, slot_id: int, db: Session = Depends(get_db)):
    try:
        res = db.execute(
            sa.text(
                """
            DELETE FROM public.event_slots
            WHERE id = :slot_id AND event_id = :event_id
        """
            ),
            {"slot_id": slot_id, "event_id": event_id},
        )
        if res.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="slot not found"
            )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"cannot delete slot: {e}"
        )
    return
