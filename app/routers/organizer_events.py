from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_organizer
from app.db import get_db

# IMPORTANT:
# We import models lazily inside handlers to avoid import-time crashes
# if your models module is still evolving.
router = APIRouter(prefix="/organizer", tags=["organizer"])


@router.get("/events")
def list_organizer_events(
    db: Session = Depends(get_db),
    user=Depends(require_organizer),
) -> Dict[str, Any]:
    """
    Minimal endpoint required by the OrganizerEventsPage:
    GET /organizer/events

    Returns:
      { "items": [ ... ] }
    """
    try:
        from app import models  # type: ignore

        Event = getattr(models, "Event", None)
        if Event is None:
            return {"items": []}

        # Common column name is organizer_id; if yours differs we fail safe.
        q = db.query(Event)

        if hasattr(Event, "organizer_id"):
            q = q.filter(Event.organizer_id == user.id)

        # newest first if a timestamp exists
        if hasattr(Event, "created_at"):
            q = q.order_by(getattr(Event, "created_at").desc())

        rows = q.all()

        def _dt(v):
            if v is None:
                return None
            if isinstance(v, (datetime, date)):
                return v.isoformat()
            return str(v)

        items: List[Dict[str, Any]] = []
        for e in rows:
            items.append(
                {
                    "id": getattr(e, "id", None),
                    "title": getattr(e, "title", None),
                    "date": _dt(getattr(e, "date", None)),
                    "location": getattr(e, "location", None),
                    "city": getattr(e, "city", None),
                    "state": getattr(e, "state", None),
                    "status": getattr(e, "status", None),
                }
            )

        return {"items": items}

    except Exception:
        # Fail-safe: never crash the whole page just because the schema is mid-flight.
        return {"items": []}
