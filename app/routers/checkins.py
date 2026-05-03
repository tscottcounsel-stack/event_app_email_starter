from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event_checkin import EventCheckIn
from app.models.application import Application
from app.utils.qr_tokens import generate_qr_token, verify_qr_token

router = APIRouter(prefix="/events", tags=["checkins"])


# ✅ 1. Generate QR by numeric vendor_id
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

    token = generate_qr_token(event_id, int(app.vendor_id), int(app.id))

    return {
        "token": token,
        "payload": {
            "event_id": event_id,
            "vendor_id": int(app.vendor_id),
            "application_id": int(app.id),
        },
    }


# ✅ 1B. Generate QR by logged-in vendor email
# This supports your current JWT payload, which includes email/sub but not vendor_id.
@router.get("/{event_id}/vendors/by-email/{vendor_email}/qr")
def generate_qr_by_email(event_id: int, vendor_email: str, db: Session = Depends(get_db)):
    email = (vendor_email or "").strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail="Missing vendor email")

    app = (
        db.query(Application)
        .filter(
            Application.event_id == event_id,
            Application.vendor_email == email,
            Application.status == "approved",
        )
        .first()
    )

    if not app:
        raise HTTPException(status_code=404, detail="Vendor not approved for event")

    if getattr(app, "vendor_id", None) is None:
        raise HTTPException(
            status_code=400,
            detail="Approved application is missing vendor_id",
        )

    token = generate_qr_token(event_id, int(app.vendor_id), int(app.id))

    return {
        "token": token,
        "payload": {
            "event_id": event_id,
            "vendor_id": int(app.vendor_id),
            "vendor_email": email,
            "application_id": int(app.id),
        },
    }


# ✅ 2. Scan / Check-In
@router.post("/{event_id}/checkins/scan")
def scan_qr(data: dict, event_id: int, db: Session = Depends(get_db)):
    token = (data or {}).get("token")

    if not token:
        raise HTTPException(status_code=400, detail="Missing QR token")

    try:
        payload = verify_qr_token(token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid QR")

    if int(payload.get("event_id")) != int(event_id):
        raise HTTPException(status_code=400, detail="Wrong event QR")

    vendor_id = payload.get("vendor_id")
    application_id = payload.get("application_id")

    if vendor_id is None or application_id is None:
        raise HTTPException(status_code=400, detail="Invalid QR payload")

    approved_app = (
        db.query(Application)
        .filter(
            Application.event_id == event_id,
            Application.vendor_id == int(vendor_id),
            Application.id == int(application_id),
            Application.status == "approved",
        )
        .first()
    )

    if not approved_app:
        raise HTTPException(status_code=403, detail="Vendor is not approved for this event")

    existing = (
        db.query(EventCheckIn)
        .filter_by(
            event_id=event_id,
            vendor_id=int(vendor_id),
        )
        .first()
    )

    if existing:
        return {
            "status": existing.status,
            "message": "Already checked in",
            "vendor_id": int(vendor_id),
            "application_id": int(application_id),
            "checked_in_at": existing.checked_in_at.isoformat() if existing.checked_in_at else None,
        }

    checkin = EventCheckIn(
        event_id=event_id,
        vendor_id=int(vendor_id),
        application_id=int(application_id),
        status="checked_in",
        checked_in_at=datetime.utcnow(),
    )

    db.add(checkin)
    db.commit()
    db.refresh(checkin)

    return {
        "status": "checked_in",
        "vendor_id": int(vendor_id),
        "application_id": int(application_id),
        "checked_in_at": checkin.checked_in_at.isoformat() if checkin.checked_in_at else None,
    }


# ✅ 3. Stats
@router.get("/{event_id}/checkins")
def checkin_stats(event_id: int, db: Session = Depends(get_db)):
    total = (
        db.query(Application)
        .filter(
            Application.event_id == event_id,
            Application.status == "approved",
        )
        .count()
    )

    rows = db.query(EventCheckIn).filter_by(event_id=event_id).all()

    checked_in = len([r for r in rows if r.status == "checked_in"])
    late = len([r for r in rows if r.status == "late"])
    no_show = len([r for r in rows if r.status == "no_show"])

    pending = max(total - checked_in - late - no_show, 0)

    return {
        "total": total,
        "checked_in": checked_in,
        "late": late,
        "no_show": no_show,
        "pending": pending,
    }
