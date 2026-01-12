# app/routers/events.py
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/events", tags=["events"])


def _json_date(v: Any) -> Any:
    if v is None:
        return None
    iso = getattr(v, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:
            pass
    if isinstance(v, str):
        return v
    return str(v)


def _table_columns(db: Session, table_name: str) -> List[str]:
    rows = db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :t
            ORDER BY ordinal_position
            """
        ),
        {"t": table_name},
    ).all()
    return [r[0] for r in rows]


def _pick(cols: List[str], preferred: List[str]) -> Optional[str]:
    for c in preferred:
        if c in cols:
            return c
    return None


# ✅ Use /events/diag (won't collide with /events/{event_id})
@router.get("/diag")
def events_diag(db: Session = Depends(get_db)) -> Dict[str, Any]:
    cols = _table_columns(db, "events")
    return {
        "table": "events",
        "columns": cols,
        "picked": {
            "title": _pick(cols, ["title", "name"]),
            "date": _pick(cols, ["date", "event_date", "starts_at", "start_date"]),
            "location": _pick(cols, ["location", "venue", "address"]),
            "description": _pick(cols, ["description", "details", "about"]),
        },
    }


@router.get("")
def list_events(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=50_000),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    try:
        cols = _table_columns(db, "events")
        if "id" not in cols:
            raise HTTPException(
                status_code=500, detail="events table missing required column: id"
            )

        title_col = _pick(cols, ["title", "name"])
        date_col = _pick(cols, ["date", "event_date", "starts_at", "start_date"])
        loc_col = _pick(cols, ["location", "venue", "address"])
        desc_col = _pick(cols, ["description", "details", "about"])

        select_parts = ["id"]
        if title_col:
            select_parts.append(f"{title_col} AS title")
        if date_col:
            select_parts.append(f"{date_col} AS date")
        if loc_col:
            select_parts.append(f"{loc_col} AS location")
        if desc_col:
            select_parts.append(f"{desc_col} AS description")

        order_by = "id ASC"
        if date_col:
            order_by = f"{date_col} ASC NULLS LAST, id ASC"

        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM events
            ORDER BY {order_by}
            LIMIT :limit OFFSET :offset
        """

        rows = (
            db.execute(text(sql), {"limit": int(limit), "offset": int(offset)})
            .mappings()
            .all()
        )

        items: List[Dict[str, Any]] = []
        for r in rows:
            rid = int(r["id"])
            title = r.get("title") or f"Event {rid}"
            items.append(
                {
                    "id": rid,
                    "name": title,
                    "title": title,
                    "date": _json_date(r.get("date")),
                    "location": r.get("location") or "",
                    "description": r.get("description") or "",
                }
            )

        return {"items": items, "count": len(items)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"/events failed: {type(e).__name__}: {e}"
        )


# ✅ Force int conversion at routing level
@router.get("/{event_id:int}")
def get_event(event_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    try:
        cols = _table_columns(db, "events")
        if "id" not in cols:
            raise HTTPException(
                status_code=500, detail="events table missing required column: id"
            )

        title_col = _pick(cols, ["title", "name"])
        date_col = _pick(cols, ["date", "event_date", "starts_at", "start_date"])
        loc_col = _pick(cols, ["location", "venue", "address"])
        desc_col = _pick(cols, ["description", "details", "about"])

        select_parts = ["id"]
        if title_col:
            select_parts.append(f"{title_col} AS title")
        if date_col:
            select_parts.append(f"{date_col} AS date")
        if loc_col:
            select_parts.append(f"{loc_col} AS location")
        if desc_col:
            select_parts.append(f"{desc_col} AS description")

        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM events
            WHERE id = :eid
        """

        row = db.execute(text(sql), {"eid": int(event_id)}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        rid = int(row["id"])
        title = row.get("title") or f"Event {rid}"
        return {
            "id": rid,
            "name": title,
            "title": title,
            "date": _json_date(row.get("date")),
            "location": row.get("location") or "",
            "description": row.get("description") or "",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"/events/{{id}} failed: {type(e).__name__}: {e}"
        )
