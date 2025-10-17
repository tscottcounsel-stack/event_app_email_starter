from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text  # â† IMPORTANT in SQLAlchemy 2.0
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import application as m_app
from app.models import event as m_event
from app.models import vendor as m_vendor

router = APIRouter(prefix="/seed", tags=["dev-seed"])


@router.post("", status_code=status.HTTP_201_CREATED)
def seed_demo(db: Session = Depends(get_db)):
    """
    Dev-only: seeds a vendor, an event, and an application.
    Requires at least one existing users.id to use as organizer_id.
    """
    # find a user id to use as organizer (highest id)
    uid = db.execute(
        text("select id from public.users order by id desc limit 1")
    ).scalar()
    if not uid:
        raise HTTPException(
            status_code=400, detail="No users found; create a user first."
        )

    # create a vendor
    v = m_vendor.Vendor(
        name="Seed Vendor", category="catering", phone="555-0101", description="Seeded"
    )
    db.add(v)
    db.flush()  # to get v.id without a commit

    # create an event
    e = m_event.Event(
        title="Seed Event",
        organizer_id=uid,
        date=datetime.now() + timedelta(days=30),
        location="Town Hall",
        description="Seeded event",
    )
    db.add(e)
    db.flush()  # to get e.id

    # create an application
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
