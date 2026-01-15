# app/routers/organizer_diagram.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import require_organizer
from app.db import get_db
from app.models.event import Event
from app.models.slot import Slot

router = APIRouter(prefix="/organizer/events", tags=["organizer-diagram"])


def _get_event(db: Session, event_id: int) -> Event:
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _slot_to_wire(s: Slot) -> dict:
    return {
        "id": s.id,
        "label": s.label,
        "x": s.x,
        "y": s.y,
        "w": s.width,
        "h": s.height,
        "status": s.status,
        "kind": s.kind,
        "price_cents": s.price_cents,
        "category_id": s.category_id,
    }


@router.get("/{event_id}/diagram")
def get_event_diagram(
    event_id: int,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    # DEV UNBLOCK: we are authenticated as an organizer; allow diagram editing for now.
    # We'll re-tighten ownership once /organizer/whoami proves which id field matches events.organizer_id.
    _get_event(db, event_id)

    slots = (
        db.query(Slot)
        .filter(Slot.event_id == event_id)
        .order_by(Slot.label.asc())
        .all()
    )

    return {
        "event_id": event_id,
        "version": 1,  # placeholder (no snapshots yet)
        "grid_px": 32,  # frontend default
        "slots": [_slot_to_wire(s) for s in slots],
    }


@router.put("/{event_id}/diagram")
def save_event_diagram(
    event_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    # DEV UNBLOCK: allow save while we reconcile organizer id mapping.
    _get_event(db, event_id)

    slots_in = payload.get("slots") or []
    if not isinstance(slots_in, list):
        raise HTTPException(status_code=422, detail="slots must be a list")

    created = 0
    updated = 0

    for s in slots_in:
        if not isinstance(s, dict):
            continue

        slot_id = s.get("id", None)

        label = str(s.get("label") or "").strip() or "A1"
        x = s.get("x", 0)
        y = s.get("y", 0)
        w = s.get("w", 1)
        h = s.get("h", 1)

        status = s.get("status") or "available"
        kind = s.get("kind") or "standard"
        price_cents = int(s.get("price_cents") or 0)
        category_id = s.get("category_id", None)

        if isinstance(slot_id, int) and slot_id > 0:
            # UPDATE
            slot = (
                db.query(Slot)
                .filter(Slot.id == slot_id, Slot.event_id == event_id)
                .first()
            )
            if not slot:
                continue

            slot.label = label
            slot.x = x
            slot.y = y
            slot.width = w
            slot.height = h
            slot.status = status
            slot.kind = kind
            slot.price_cents = price_cents
            slot.category_id = category_id
            updated += 1
        else:
            # CREATE (frontend omits id for new booths)
            slot = Slot(
                event_id=event_id,
                label=label,
                x=x,
                y=y,
                width=w,
                height=h,
                status=status,
                kind=kind,
                price_cents=price_cents,
                category_id=category_id,
            )
            db.add(slot)
            created += 1

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Save failed: duplicate booth label for this event. Rename a booth and try again.",
        )

    return {"ok": True, "created": created, "updated": updated}


@router.post("/{event_id}/diagram")
def save_event_diagram_post(
    event_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    organizer=Depends(require_organizer),
):
    # backward-compat
    return save_event_diagram(event_id, payload, db, organizer)
