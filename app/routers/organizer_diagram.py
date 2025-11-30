# app/routers/organizer_diagram.py

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer:diagram"])


class SaveDiagramBody(BaseModel):
    diagram: Dict[str, Any]
    expect_version: Optional[int] = None


def build_booth_status_map(db: Session, event_id: int) -> dict[int, str]:
    """
    Returns {slot_id: status_string} for all slots in this event,
    based on vendor_applications.

    Statuses:
        - "available" (default)
        - "pending"   (there is a pending application for this slot)
        - "reserved"  (approved but not paid yet – tweak as you wish)
        - "assigned"  (approved + paid)
        - "blocked"   (rejected / blocked)
    """
    # Start with everything "available"
    stmt_slots = select(models.EventSlot).where(models.EventSlot.event_id == event_id)
    slots = db.execute(stmt_slots).scalars().all()

    status_by_slot_id: dict[int, str] = {slot.id: "available" for slot in slots}

    # Look at applications to upgrade statuses
    stmt_apps = select(models.VendorApplication).where(
        models.VendorApplication.event_id == event_id
    )
    apps = db.execute(stmt_apps).scalars().all()

    for app in apps:
        slot_id = app.assigned_slot_id
        if not slot_id:
            continue

        current = status_by_slot_id.get(slot_id, "available")
        app_status = (app.status or "").lower()
        pay_status = (app.payment_status or "").lower()

        # Highest priority: fully assigned (approved + paid)
        if app_status == "approved" and pay_status == "paid":
            status_by_slot_id[slot_id] = "assigned"
            continue

        # Next priority: pending application
        if app_status == "pending":
            # Don't downgrade an already-assigned slot
            if current != "assigned":
                status_by_slot_id[slot_id] = "pending"
            continue

        # Next: approved but not paid -> reserved
        if app_status == "approved" and pay_status != "paid":
            if current not in ("assigned", "pending"):
                status_by_slot_id[slot_id] = "reserved"
            continue

        # Finally: rejected -> blocked (only if not already higher priority)
        if app_status == "rejected":
            if current not in ("assigned", "pending", "reserved"):
                status_by_slot_id[slot_id] = "blocked"
            continue

    return status_by_slot_id


@router.get("/{event_id}/diagram")
def get_event_diagram(event_id: int, db: Session = Depends(get_db)):
    diagram = (
        db.query(models.EventDiagram)
        .filter(models.EventDiagram.event_id == event_id)
        .one_or_none()
    )
    if not diagram:
        raise HTTPException(status_code=404, detail="Diagram not found")

    body = diagram.diagram or {}
    booth_map_raw = body.get("boothMap") or {}

    # Ensure we have a plain dict we can mutate
    if isinstance(booth_map_raw, dict):
        booth_map = dict(booth_map_raw)
    else:
        booth_map = {}

    # Fetch slots for this event
    stmt_slots = select(models.EventSlot).where(models.EventSlot.event_id == event_id)
    slots = db.execute(stmt_slots).scalars().all()

    status_by_slot_id = build_booth_status_map(db, event_id)

    # Build a mapping from some "code-like" field -> slot.id
    # Try several common attribute names so we don't crash if one doesn't exist.
    slot_id_by_code: dict[str, int] = {}
    for slot in slots:
        code = (
            getattr(slot, "code", None)
            or getattr(slot, "label", None)
            or getattr(slot, "name", None)
        )
        if not code:
            continue
        slot_id_by_code[str(code)] = slot.id

    # Attach status to each booth if we can match it to a slot.
    # IMPORTANT: only set status if the booth does NOT already
    # have a status. This way, manually-set statuses in JSON
    # won't be overwritten on every GET.
    for code, slot_data in booth_map.items():
        slot_id = slot_id_by_code.get(str(code))
        if slot_id is None:
            continue

        status = status_by_slot_id.get(slot_id)
        if not status:
            continue

        if not isinstance(slot_data, dict):
            continue

        # Only apply auto status if booth has no explicit status
        if not slot_data.get("status"):
            slot_data["status"] = status

    body["boothMap"] = booth_map

    return {
        "event_id": event_id,
        "version": diagram.version,
        "diagram": body,
        "updated_at": diagram.updated_at,
    }


@router.put("/{event_id}/diagram")
def save_event_diagram(
    event_id: int,
    payload: SaveDiagramBody,
    db: Session = Depends(get_db),
):
    """
    Save (or create) the event diagram.

    Frontend sends:
        {
          "diagram": { "boothMap": { ... } },
          "expect_version": <int or null>
        }
    """
    # Make sure event exists (optional but nice)
    event = db.query(models.Event).filter(models.Event.id == event_id).one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    # Fetch existing diagram row or create one
    diagram = (
        db.query(models.EventDiagram)
        .filter(models.EventDiagram.event_id == event_id)
        .one_or_none()
    )

    if diagram is None:
        # First time we’re saving a diagram for this event
        diagram = models.EventDiagram(
            event_id=event_id,
            version=1,
            diagram=payload.diagram,
        )
        db.add(diagram)
        db.commit()
        db.refresh(diagram)
        return {
            "event_id": event_id,
            "version": diagram.version,
            "diagram": diagram.diagram,
            "updated_at": diagram.updated_at,
        }

    # Optimistic concurrency check (if frontend sent expect_version)
    if payload.expect_version is not None and diagram.version != payload.expect_version:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "version_mismatch",
                "message": "Diagram version mismatch",
                "current_version": diagram.version,
            },
        )

    # Update diagram JSON + bump version
    diagram.diagram = payload.diagram
    diagram.version += 1

    db.add(diagram)
    db.commit()
    db.refresh(diagram)

    return {
        "event_id": event_id,
        "version": diagram.version,
        "diagram": diagram.diagram,
        "updated_at": diagram.updated_at,
    }
