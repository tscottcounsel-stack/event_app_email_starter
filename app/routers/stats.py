from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.application import Application
from app.models.event import Event
from app.models.vendor import Vendor

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("")
def get_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    vendor_count = db.query(func.count(Vendor.id)).scalar() or 0
    event_count = db.query(func.count(Event.id)).scalar() or 0
    application_count = db.query(func.count(Application.id)).scalar() or 0

    latest_event = db.query(func.max(Event.date)).scalar()
    latest_app = db.query(func.max(Application.created_at)).scalar()

    # per-status breakdown (submitted/approved/rejected/etc.)
    per_status = dict(
        db.query(Application.status, func.count(Application.id))
        .group_by(Application.status)
        .all()
    )

    # top vendors by # of applications
    top_vendors = (
        db.query(Vendor.name, func.count(Application.id).label("apps"))
        .join(Application, Application.vendor_id == Vendor.id, isouter=True)
        .group_by(Vendor.id)
        .order_by(func.count(Application.id).desc(), Vendor.name.asc())
        .limit(10)
        .all()
    )
    top_vendors = [
        {"name": name, "applications": apps or 0} for name, apps in top_vendors
    ]

    return {
        "vendors": vendor_count,
        "events": event_count,
        "applications": application_count,
        "latest": {
            "event_date": latest_event,
            "application_created_at": latest_app,
        },
        "applications_by_status": per_status,
        "top_vendors": top_vendors,
    }
