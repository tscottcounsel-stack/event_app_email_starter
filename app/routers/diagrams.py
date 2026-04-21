from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.diagram import Diagram
from app.models.event import Event

router = APIRouter(tags=["Diagrams"])


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_event_or_404(db: Session, event_id: int) -> Event:
    ev = db.query(Event).filter(Event.id == int(event_id)).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _parse_iso_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _parse_payment_status(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if s in ("unpaid", "pending", "paid", "expired"):
        return s
    return "unpaid" if not s else "unknown"


def _pick_vendor_display_name(app: Dict[str, Any]) -> str | None:
    raw = (
        app.get("vendor_company_name")
        or app.get("company_name")
        or app.get("vendor_name")
        or app.get("vendor_display_name")
        or app.get("vendor_email")
    )
    s = str(raw or "").strip()
    return s or None


def _expire_reservations_for_event(event_id: int) -> int:
    now = datetime.now(timezone.utc)
    changed = 0

    for app in _APPLICATIONS.values():
        if int(app.get("event_id") or 0) != int(event_id):
            continue

        payment_status = _parse_payment_status(app.get("payment_status"))
        if payment_status == "paid":
            continue

        until = _parse_iso_dt(app.get("booth_reserved_until"))
        if not until:
            continue

        if until <= now:
            app["payment_status"] = "expired"
            app["booth_id"] = None
            app["booth_reserved_until"] = None
            app["updated_at"] = utc_now_iso()
            changed += 1

    return changed


def _build_booth_state_by_id(event_id: int) -> Dict[str, Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    idx: Dict[str, Dict[str, Any]] = {}

    for app in _APPLICATIONS.values():
        if int(app.get("event_id") or 0) != int(event_id):
            continue

        booth_id = str(app.get("booth_id") or "").strip()
        if not booth_id:
            continue

        payment_status = _parse_payment_status(app.get("payment_status"))
        reserved_until = app.get("booth_reserved_until")
        until_dt = _parse_iso_dt(reserved_until)

        status: str | None = None
        if payment_status == "paid":
            status = "paid"
        elif payment_status in ("unpaid", "pending") and until_dt and until_dt > now:
            status = "reserved"
        elif payment_status in ("unpaid", "pending"):
            status = "assigned"

        if not status:
            continue

        idx[booth_id] = {
            "status": status,
            "applicationId": int(app.get("id") or 0),
            "vendorEmail": str(app.get("vendor_email") or "").strip() or None,
            "vendorName": _pick_vendor_display_name(app),
            "paymentStatus": payment_status,
            "reservedUntil": str(reserved_until).strip() if reserved_until else None,
        }

    return idx


def ensure_slot(db: Session, event_id: int) -> Diagram:
    eid = int(event_id)
    get_event_or_404(db, eid)

    slot = (
        db.query(Diagram)
        .filter(Diagram.event_id == eid)
        .order_by(Diagram.id.desc())
        .first()
    )

    if not isinstance(slot, Diagram):
        slot = Diagram(
            event_id=eid,
            diagram={"elements": [], "meta": {}},
            version=0,
        )
        db.add(slot)
        db.commit()
        db.refresh(slot)
        return slot

    dirty = False
    if slot.diagram is None:
        slot.diagram = {"elements": [], "meta": {}}
        dirty = True
    if slot.version is None:
        slot.version = 0
        dirty = True

    if dirty:
        db.add(slot)
        db.commit()
        db.refresh(slot)

    return slot


def _read_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    diagram = payload.get("diagram", {"elements": [], "meta": {}})
    version = payload.get("version", 0)
    try:
        version = int(version or 0)
    except Exception:
        version = 0
    return {"diagram": diagram, "version": version}


def _save_diagram(db: Session, event_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    eid = int(event_id)
    ev = get_event_or_404(db, eid)

    parsed = _read_payload(payload)
    diagram = parsed["diagram"]
    version = parsed["version"]

    slot = (
        db.query(Diagram)
        .filter(Diagram.event_id == eid)
        .order_by(Diagram.id.desc())
        .first()
    )

    if not isinstance(slot, Diagram):
        slot = Diagram(event_id=eid)

    slot.diagram = diagram
    slot.version = version
    db.add(slot)

    ev.layout_published = True
    db.add(ev)

    db.commit()
    db.refresh(slot)

    return {
        "diagram": slot.diagram,
        "version": int(slot.version or 0),
        "updated_at": utc_now_iso(),
    }


@router.get("/events/{event_id}/diagram")
def get_event_diagram_public(event_id: int, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    _expire_reservations_for_event(event_id)
    slot = ensure_slot(db, event_id)
    return {
        "diagram": slot.diagram or {"elements": [], "meta": {}},
        "version": int(slot.version or 0),
        "updated_at": utc_now_iso(),
        "booth_state_by_id": {},


@router.get("/vendor/events/{event_id}/diagram")
def get_event_diagram_vendor(event_id: int, db: Session = Depends(get_db)):
    return get_event_diagram_public(event_id, db)


@router.get("/organizer/events/{event_id}/diagram")
def get_event_diagram_organizer(event_id: int, db: Session = Depends(get_db)):
    return get_event_diagram_public(event_id, db)


@router.put("/organizer/events/{event_id}/diagram")
def save_event_diagram_organizer(
    event_id: int,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
):
    return _save_diagram(db, event_id, payload)


@router.put("/events/{event_id}/diagram")
def save_event_diagram_public(
    event_id: int,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
):
    return _save_diagram(db, event_id, payload)


@router.put("/vendor/events/{event_id}/diagram")
def save_event_diagram_vendor(
    event_id: int,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
):
    return _save_diagram(db, event_id, payload)
