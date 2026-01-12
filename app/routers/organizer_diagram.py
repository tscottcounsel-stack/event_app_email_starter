# app/routers/organizer_diagram.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer-diagram"])


# -------------------------
# Helpers
# -------------------------


def _norm_int(value: Any, default: int, *, min_value: int = 0) -> int:
    if value is None:
        return default
    try:
        iv = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, iv)


def _get_event_or_404(db: Session, event_id: int):
    EventModel = getattr(models, "Event", None)
    if EventModel is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="models.Event not found",
        )
    ev = db.query(EventModel).filter(EventModel.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found.")
    return ev


def _get_slot_model():
    # Your codebase has used Slot/EventSlot naming at different times.
    SlotModel = getattr(models, "Slot", None) or getattr(models, "EventSlot", None)
    if SlotModel is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Slot model not found (models.Slot or models.EventSlot).",
        )
    return SlotModel


def _fetch_slots_for_event(db: Session, event_id: int):
    SlotModel = _get_slot_model()
    q = db.query(SlotModel).filter(SlotModel.event_id == event_id)
    # stable ordering if label exists
    if hasattr(SlotModel, "label"):
        q = q.order_by(SlotModel.label.asc(), SlotModel.id.asc())
    else:
        q = q.order_by(SlotModel.id.asc())
    return q.all()


def _slot_to_payload(slot: Any) -> Dict[str, Any]:
    # DB uses width/height; API uses w/h
    w = getattr(slot, "width", None)
    h = getattr(slot, "height", None)
    return {
        "id": int(slot.id),
        "label": getattr(slot, "label", "") or "",
        "x": _norm_int(getattr(slot, "x", None), 0, min_value=0),
        "y": _norm_int(getattr(slot, "y", None), 0, min_value=0),
        "w": max(1, _norm_int(w, 1, min_value=1)),
        "h": max(1, _norm_int(h, 1, min_value=1)),
        "status": getattr(slot, "status", None) or "available",
        "kind": getattr(slot, "kind", None) or "standard",
        "price_cents": _norm_int(getattr(slot, "price_cents", None), 0, min_value=0),
        "category_id": getattr(slot, "category_id", None),
    }


def _build_diagram_from_slots(db: Session, event_id: int) -> Dict[str, Any]:
    _get_event_or_404(db, event_id)
    rows = _fetch_slots_for_event(db, event_id)

    return {
        "event_id": event_id,
        "version": 1,
        "grid_px": 32,
        "slots": [_slot_to_payload(s) for s in rows],
        "meta": {"source": "slots"},
    }


def _extract_slots(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    # Accept either {grid_px, slots:[...]} or {diagram:{grid_px, slots:[...]}}
    if isinstance(payload.get("slots"), list):
        return payload["slots"]  # type: ignore[return-value]
    diagram = payload.get("diagram")
    if isinstance(diagram, dict) and isinstance(diagram.get("slots"), list):
        return diagram["slots"]  # type: ignore[return-value]
    return []


def _is_create_mode(raw_id: Any) -> bool:
    # Create if missing, temp, non-numeric, or <= 0
    if raw_id is None:
        return True
    if isinstance(raw_id, int):
        return raw_id <= 0
    if isinstance(raw_id, str):
        if raw_id.isdigit():
            return int(raw_id) <= 0
        return True
    return True


def _coerce_existing_id(raw_id: Any) -> Optional[int]:
    if raw_id is None:
        return None
    if isinstance(raw_id, int):
        return raw_id
    if isinstance(raw_id, str) and raw_id.isdigit():
        return int(raw_id)
    return None


def _save_diagram(
    db: Session, event_id: int, payload: Dict[str, Any]
) -> Dict[str, Any]:
    _get_event_or_404(db, event_id)

    slots_payload = _extract_slots(payload)
    if not slots_payload:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Slots array cannot be empty.",
        )

    SlotModel = _get_slot_model()

    # Load existing slots for this event
    existing = _fetch_slots_for_event(db, event_id)
    by_id: Dict[int, Any] = {int(s.id): s for s in existing}

    for raw in slots_payload:
        if not isinstance(raw, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each slot must be a JSON object.",
            )

        raw_id = raw.get("id")
        create_mode = _is_create_mode(raw_id)

        slot = None

        if not create_mode:
            sid = _coerce_existing_id(raw_id)
            if sid is None or sid <= 0:
                create_mode = True
            else:
                slot = by_id.get(sid)
                if not slot or int(getattr(slot, "event_id", -1)) != event_id:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Slot id {sid} does not belong to event {event_id}.",
                    )

        if create_mode:
            # Create a new slot row for this event
            slot = SlotModel(event_id=event_id)
            db.add(slot)
            db.flush()  # assigns slot.id
            by_id[int(slot.id)] = slot

        # now update fields
        # label
        if hasattr(slot, "label") and "label" in raw:
            slot.label = str(raw.get("label") or "")

        # geometry (payload w/h => db width/height)
        if hasattr(slot, "x") and "x" in raw:
            slot.x = _norm_int(raw.get("x"), 0, min_value=0)
        if hasattr(slot, "y") and "y" in raw:
            slot.y = _norm_int(raw.get("y"), 0, min_value=0)
        if hasattr(slot, "width") and "w" in raw:
            slot.width = _norm_int(raw.get("w"), 1, min_value=1)
        if hasattr(slot, "height") and "h" in raw:
            slot.height = _norm_int(raw.get("h"), 1, min_value=1)

        # optional fields
        if hasattr(slot, "status") and "status" in raw:
            slot.status = raw.get("status") or "available"
        if hasattr(slot, "kind") and "kind" in raw:
            slot.kind = raw.get("kind") or "standard"
        if hasattr(slot, "price_cents") and "price_cents" in raw:
            slot.price_cents = _norm_int(raw.get("price_cents"), 0, min_value=0)
        if hasattr(slot, "category_id") and "category_id" in raw:
            slot.category_id = raw.get("category_id")

    db.commit()
    return _build_diagram_from_slots(db, event_id)


# -------------------------
# Routes
# -------------------------


@router.get("/{event_id}/diagram")
def get_organizer_diagram(
    event_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return _build_diagram_from_slots(db, event_id)


@router.put("/{event_id}/diagram")
def put_organizer_diagram(
    event_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Diagram payload must be a JSON object.",
        )
    return _save_diagram(db, event_id, payload)
