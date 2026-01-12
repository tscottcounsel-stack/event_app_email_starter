# app/routers/stats.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/ping")
def ping():
    return {"ping": "pong"}


@router.get("/db")
def db_stats(db: Session = Depends(get_db)):
    insp = inspect(db.get_bind())
    tables = insp.get_table_names()
    out = {
        "tables": tables,
        "counts": {},
    }

    # optional: only compute counts for a small set we care about
    for name in (
        "events",
        "applications",
        "vendor_applications",
        "event_slots",
        "vendor_profiles",
    ):
        if name in tables:
            try:
                out["counts"][name] = int(
                    db.execute(f"SELECT COUNT(*) FROM {name}").scalar() or 0
                )
            except Exception:
                out["counts"][name] = None

    return out
