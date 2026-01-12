from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/public", tags=["public-diagram"])


# --- DB helpers (no model imports; avoids app.models / circular issues) ---

_CANDIDATE_TABLES = ["event_diagrams", "event_diagram", "events_diagram"]
# Prefer these JSON columns if present, in this order:
_JSON_COL_PREF = ["data", "diagram", "layout_json", "layout", "json", "payload"]


def _table_exists(db: Session, table_name: str) -> bool:
    q = text(
        """
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name=:t
        ) AS ok
        """
    )
    return bool(db.execute(q, {"t": table_name}).scalar())


def _columns_for(db: Session, table_name: str) -> List[str]:
    q = text(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=:t
        ORDER BY ordinal_position
        """
    )
    return [r[0] for r in db.execute(q, {"t": table_name}).fetchall()]


def _pick_cols(cols: List[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (json_col, version_col)
    """
    json_col = None
    for c in _JSON_COL_PREF:
        if c in cols:
            json_col = c
            break

    version_col = "version" if "version" in cols else None
    return json_col, version_col


def load_event_diagram(db: Session, event_id: int) -> Dict[str, Any]:
    """
    Loads a diagram from whichever diagram table exists in this DB.
    Returns a stable shape:
      { event_id, version, diagram, debug }
    """
    existing = [t for t in _CANDIDATE_TABLES if _table_exists(db, t)]
    counts: Dict[str, int] = {}

    for t in existing:
        try:
            c = db.execute(
                text(f"SELECT COUNT(*) FROM {t} WHERE event_id=:eid"), {"eid": event_id}
            ).scalar()
            counts[t] = int(c or 0)
        except Exception:
            counts[t] = 0

    picked: Optional[str] = None
    for t in existing:
        if counts.get(t, 0) > 0:
            picked = t
            break

    # If none have rows, return null diagram
    if not picked:
        return {
            "event_id": event_id,
            "version": 0,
            "diagram": None,
            "debug": {
                "picked": None,
                "candidates": _CANDIDATE_TABLES,
                "existing": existing,
                "counts": counts,
                "reason": "no rows found in any diagram table for this event_id",
            },
        }

    cols = _columns_for(db, picked)
    json_col, version_col = _pick_cols(cols)
    if not json_col:
        return {
            "event_id": event_id,
            "version": 0,
            "diagram": None,
            "debug": {
                "picked": picked,
                "candidates": _CANDIDATE_TABLES,
                "existing": existing,
                "counts": counts,
                "cols": cols,
                "reason": "no JSON column found (expected one of: "
                + ", ".join(_JSON_COL_PREF)
                + ")",
            },
        }

    select_cols = f"{json_col} AS diagram"
    if version_col:
        select_cols += f", {version_col} AS version"
    else:
        select_cols += ", 0 AS version"

    q = text(f"SELECT {select_cols} FROM {picked} WHERE event_id=:eid LIMIT 1")
    row = db.execute(q, {"eid": event_id}).mappings().first()

    diagram = row["diagram"] if row else None
    version = int(row["version"] if row else 0)

    return {
        "event_id": event_id,
        "version": version,
        "diagram": diagram,
        "debug": {
            "picked": picked,
            "candidates": _CANDIDATE_TABLES,
            "existing": existing,
            "counts": counts,
            "cols": cols,
            "json_col": json_col,
            "version_col": version_col,
        },
    }


@router.get("/events/{event_id}/diagram")
def get_public_event_diagram(
    event_id: int,
    db: Session = Depends(get_db),
    debug: bool = Query(False),
):
    payload = load_event_diagram(db=db, event_id=event_id)
    if not debug:
        payload.pop("debug", None)
    return payload
