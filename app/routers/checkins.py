from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event_checkin import EventCheckIn
from app.models.application import Application
from app.utils.qr_tokens import generate_qr_token, verify_qr_token

router = APIRouter(prefix="/events", tags=["checkins"])


# ✅ 1. Generate QR
@router.get("/{event_id}/vendors/{vendor_id}/qr")
def generate_qr(event_id: int, vendor_id: int, db: Session = Depends(get_db)):
    app = (
        db.query(Application)
        .filter(
            Application.event_id == event_id,
            Application.vendor_id == vendor_id,
            Application.status == "approved",
        )
        .first()
    )

    if not app:
        raise HTTPException(status_code=404, detail="Vendor not approved for event")

    token = generate_qr_token(event_id, vendor_id, app.id)

    return {
        "token": token,
        "payload": {
            "event_id": event_id,
            "vendor_id": vendor_id,
            "application_id": app.id,
        },
    }


# ✅ 2. Scan / Check-In
@router.post("/{event_id}/checkins/scan")
def scan_qr(data: dict, event_id: int, db: Session = Depends(get_db)):
    token = data.get("token")

    try:
        payload = verify_qr_token(token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid QR")

    if payload["event_id"] != event_id:
        raise HTTPException(status_code=400, detail="Wrong event QR")

    existing = (
        db.query(EventCheckIn)
        .filter_by(
            event_id=event_id,
            vendor_id=payload["vendor_id"],
        )
        .first()
    )

    if existing:
        return {
            "status": existing.status,
            "message": "Already checked in",
        }

    checkin = EventCheckIn(
        event_id=event_id,
        vendor_id=payload["vendor_id"],
        application_id=payload["application_id"],
        status="checked_in",
        checked_in_at=datetime.utcnow(),
    )

    db.add(checkin)
    db.commit()

    return {
        "status": "checked_in",
        "vendor_id": payload["vendor_id"],
    }


# ✅ 3. Stats
@router.get("/{event_id}/checkins")
def checkin_stats(event_id: int, db: Session = Depends(get_db)):
    rows = db.query(EventCheckIn).filter_by(event_id=event_id).all()

    total = len(rows)
    checked_in = len([r for r in rows if r.status == "checked_in"])
    late = len([r for r in rows if r.status == "late"])
    no_show = len([r for r in rows if r.status == "no_show"])

    return {
        "total": total,
        "checked_in": checked_in,
        "late": late,
        "no_show": no_show,
        "pending": total - checked_in - late - no_show,
    }