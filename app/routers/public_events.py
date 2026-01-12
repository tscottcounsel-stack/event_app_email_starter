# app/routers/public_events.py
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import models
from app.db import get_db

router = APIRouter(prefix="/public", tags=["public"])


def _date_to_str(v: Any) -> Optional[str]:
    """
    DB / model date field may be:
      - datetime
      - date
      - string (already serialized)
      - None
    Return a string safe for JSON.
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, str):
        return v
    # fallback
    try:
        return str(v)
    except Exception:
        return None


@router.get("/events")
def list_public_events(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    rows = db.query(models.Event).order_by(models.Event.id.desc()).limit(limit).all()

    items: List[Dict[str, Any]] = []
    for e in rows:
        items.append(
            {
                "id": e.id,
                "title": getattr(e, "title", None),
                "date": _date_to_str(getattr(e, "date", None)),
                "location": getattr(e, "location", None),
                "city": getattr(e, "city", None),
            }
        )

    return {"items": items, "count": len(items)}
