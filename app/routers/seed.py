from __future__ import annotations
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import vendor as m_vendor
from app.models import event as m_event
from app.models import application as m_app

router = APIRouter(prefix="/seed", tags=["dev-seed"])

@router.post("", status_code=status.HTTP_201_CREATED)
def seed_demo(db: Session = Depends(get_db)):
    """
    Dev-only: seeds a user (if required by your schema you may already have one),
    a vendor, an event, and an application, returning their IDs.
    Adjust organizer_id as needed if your events require an existing users.id.
    """
    # If your events.organizer_id must be a valid users.id, pick one that exists.
    # For convenience we try to reuse the highest users.id; if none, raise.
    uid = db.execute("select id from public.users order by id desc limit 1").scalar()
    if not uid:
        raise HTTPException(status_code=400, detail="No users found; create a user first.")

    v = m_vendor.Vendor(name="Seed Vendor", category="catering", phone="555-0101", description="Seeded")
    db.add(v); db.flush()

    e = m_event.Event(
        title="Seed Event",
        organizer_id=uid,
        date=datetime.now() + timedelta(days=30),
        location="Town Hall",
        description="Seeded event",
    )
    db.add(e); db.flush()

    a = m_app.Application(
        event_id=e.id,
        vendor_id=v.id,
        price_cents=20000,
        status="submitted",
        notes="seed",
    )
    db.add(a)
    db.commit()

    return {
        "user_id": uid,
        "vendor_id": v.id,
        "event_id": e.id,
        "application_id": a.id,
    }
