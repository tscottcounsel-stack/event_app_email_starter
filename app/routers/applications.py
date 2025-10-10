# app/routers/applications.py
from __future__ import annotations
from typing import Optional, List, Dict, Any

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
import sqlalchemy.exc as sa_exc

from app.db import get_db  # sync Session dependency

# --- Pydantic v2/v1 compatibility ---
try:
    from pydantic import BaseModel, ConfigDict, field_validator
    _PD_V2 = True
except Exception:  # pydantic v1 fallback
    from pydantic import BaseModel, validator as field_validator  # type: ignore
    ConfigDict = None
    _PD_V2 = False

router = APIRouter(prefix="/applications", tags=["applications"])

# -------------------- Schemas --------------------
class ApplicationCreate(BaseModel):
    event_id: int
    vendor_id: int
    price_cents: Optional[int] = None

    if _PD_V2:
        @field_validator("price_cents")
        @classmethod
        def nonneg(cls, v: Optional[int]) -> Optional[int]:
            if v is not None and v < 0:
                raise ValueError("price_cents must be >= 0")
            return v
    else:
        @field_validator("price_cents")  # type: ignore[misc]
        def nonneg(cls, v):  # type: ignore[no-redef]
            if v is not None and v < 0:
                raise ValueError("price_cents must be >= 0")
            return v

class ApplicationUpdate(BaseModel):
    """Partial update: currently supports only price_cents."""
    price_cents: Optional[int] = None  # explicit null allowed

    if _PD_V2:
        @field_validator("price_cents")
        @classmethod
        def nonneg(cls, v: Optional[int]) -> Optional[int]:
            if v is not None and v < 0:
                raise ValueError("price_cents must be >= 0")
            return v
    else:
        @field_validator("price_cents")  # type: ignore[misc]
        def nonneg(cls, v):  # type: ignore[no-redef]
            if v is not None and v < 0:
                raise ValueError("price_cents must be >= 0")
            return v

class ApplicationOut(BaseModel):
    # we return plain dicts (not ORM instances)
    if _PD_V2:
        model_config = ConfigDict(from_attributes=False)  # type: ignore[arg-type]
    else:
        class Config:
            orm_mode = False

    id: int
    event_id: int
    vendor_id: int
    price_cents: Optional[int] = None

    # expose common extras if present in your table (optional)
    # status: Optional[str] = None
    # created_at: Optional[datetime] = None
    # updated_at: Optional[datetime] = None

class ApplicationsPage(BaseModel):
    items: List[ApplicationOut]
    total: int
    limit: int
    offset: int
    next_offset: Optional[int] = None

# -------------------- Helpers --------------------
def _row_to_dict(row) -> Dict[str, Any]:
    return dict(row)

def _dump_changes(model: BaseModel) -> Dict[str, Any]:
    try:
        return model.model_dump(exclude_unset=True)  # pydantic v2
    except Exception:
        return model.dict(exclude_unset=True)        # pydantic v1

# Build a WHERE clause + params for shared filters
def _build_filters(
    event_id: Optional[int],
    vendor_id: Optional[int],
    status_val: Optional[str],
    created_from: Optional[datetime],
    created_to: Optional[datetime],
):
    where = [
        "(:e IS NULL OR event_id = :e)",
        "(:v IS NULL OR vendor_id = :v)",
    ]
    params: Dict[str, Any] = {"e": event_id, "v": vendor_id}

    # status filter (if your table has a status column)
    if status_val is not None:
        where.append("status = :s")
        params["s"] = status_val

    # created_at range (if your table has created_at timestamp with tz)
    if created_from is not None:
        where.append("created_at >= :cf")
        params["cf"] = created_from
    if created_to is not None:
        where.append("created_at <= :ct")
        params["ct"] = created_to

    return " AND ".join(where), params

# -------------------- Diagnostics --------------------
@router.get("/diag/ping")
def applications_diag_ping(db: Session = Depends(get_db)):
    cls = type(db).__name__
    val = db.execute(text("SELECT 1")).scalar()
    return {"session_type": cls, "select_1": val}

@router.get("/diag")
def applications_router_diag(db: Session = Depends(get_db)):
    cls = type(db).__name__
    val = db.execute(text("SELECT 1")).scalar()
    return {"session_type": cls, "select_1": val}

# -------------------- Count --------------------
@router.get("/count")
def count_applications(
    event_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    status: Optional[str] = None,
    created_from: Optional[datetime] = Query(None, description="ISO date/time, e.g., 2025-09-28T00:00:00Z"),
    created_to: Optional[datetime] = Query(None, description="ISO date/time, e.g., 2025-10-07T23:59:59Z"),
    db: Session = Depends(get_db),
):
    where_sql, params = _build_filters(event_id, vendor_id, status, created_from, created_to)

    row = db.execute(
        text(f"SELECT COUNT(*) AS c FROM applications WHERE {where_sql}"),
        params,
    ).mappings().first()
    return {"count": int(row["c"]) if row else 0}

# -------------------- List (envelope + pagination + sorting + filters) --------------------
@router.get("", response_model=ApplicationsPage)
def list_applications(
    event_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    status: Optional[str] = None,
    created_from: Optional[datetime] = Query(None, description="ISO date/time, e.g., 2025-09-28T00:00:00Z"),
    created_to: Optional[datetime] = Query(None, description="ISO date/time, e.g., 2025-10-07T23:59:59Z"),
    limit: int = 100,
    offset: int = 0,
    sort: str = "id",      # id | event_id | vendor_id | price_cents | (status, created_at if present)
    order: str = "desc",   # asc | desc
    db: Session = Depends(get_db),
):
    # guardrails
    if limit < 1:   limit = 1
    if limit > 500: limit = 500
    if offset < 0:  offset = 0

    # whitelist sort fields to prevent SQL injection
    sort_map = {
        "id": "id",
        "event_id": "event_id",
        "vendor_id": "vendor_id",
        "price_cents": "price_cents",
        # Uncomment if these cols exist on your table:
        "status": "status",
        "created_at": "created_at",
    }
    sort_col = sort_map.get(sort.lower(), "id")
    order_sql = "ASC" if order.lower() == "asc" else "DESC"

    # shared filters
    where_sql, params = _build_filters(event_id, vendor_id, status, created_from, created_to)

    # total
    total_row = db.execute(
        text(f"SELECT COUNT(*) AS c FROM applications WHERE {where_sql}"),
        params,
    ).mappings().first()
    total = int(total_row["c"]) if total_row else 0

    # items
    params.update({"limit": limit, "offset": offset})
    select_sql = f"""
        SELECT id, event_id, vendor_id, price_cents
               -- add these if present and you want to return them:
               -- , status, created_at, updated_at
        FROM applications
        WHERE {where_sql}
        ORDER BY {sort_col} {order_sql}, id DESC
        LIMIT :limit OFFSET :offset
    """
    rows = db.execute(text(select_sql), params).mappings().all()
    items = [_row_to_dict(r) for r in rows]

    next_offset: Optional[int] = offset + limit if (offset + limit) < total else None
    return ApplicationsPage(items=items, total=total, limit=limit, offset=offset, next_offset=next_offset)

# -------------------- Get by id --------------------
@router.get("/id/{application_id:int}", response_model=ApplicationOut)
def get_application(application_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            SELECT id, event_id, vendor_id, price_cents
                   -- , status, created_at, updated_at
            FROM applications
            WHERE id = :id
            LIMIT 1
        """),
        {"id": application_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return _row_to_dict(row)

# -------------------- Create --------------------
@router.post("", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    # FK checks
    if not db.execute(text("SELECT 1 FROM events WHERE id = :id"), {"id": payload.event_id}).scalar():
        raise HTTPException(status_code=404, detail="event_id not found")
    if not db.execute(text("SELECT 1 FROM vendors WHERE id = :id"), {"id": payload.vendor_id}).scalar():
        raise HTTPException(status_code=404, detail="vendor_id not found")

    # Unique pre-check (event_id, vendor_id)
    if db.execute(
        text("SELECT 1 FROM applications WHERE event_id = :e AND vendor_id = :v LIMIT 1"),
        {"e": payload.event_id, "v": payload.vendor_id},
    ).scalar():
        raise HTTPException(status_code=409, detail="Application already exists for this event/vendor")

    # Insert
    try:
        row = db.execute(
            text("""
                INSERT INTO applications (event_id, vendor_id, price_cents)
                VALUES (:e, :v, :p)
                RETURNING id, event_id, vendor_id, price_cents
            """),
            {"e": payload.event_id, "v": payload.vendor_id, "p": payload.price_cents},
        ).mappings().first()
        db.commit()
    except sa_exc.IntegrityError as e:
        db.rollback()
        msg = (str(getattr(e, "orig", e)) or "").lower()
        if "uq_applications_event_vendor" in msg or "unique" in msg:
            raise HTTPException(status_code=409, detail="Application already exists for this event/vendor")
        raise HTTPException(status_code=400, detail="Integrity error creating application")
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unexpected error creating application")

    return _row_to_dict(row)

# -------------------- Patch (price_cents only) --------------------
@router.patch("/id/{application_id:int}", response_model=ApplicationOut)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
):
    changes = _dump_changes(payload)
    if "price_cents" not in changes:
        raise HTTPException(status_code=400, detail="No updatable fields provided")

    try:
        row = db.execute(
            text("""
                UPDATE applications
                SET price_cents = :p
                WHERE id = :id
                RETURNING id, event_id, vendor_id, price_cents
            """),
            {"p": changes["price_cents"], "id": application_id},
        ).mappings().first()
        if not row:
            db.rollback()
            raise HTTPException(status_code=404, detail="Application not found")
        db.commit()
    except sa_exc.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Integrity error updating application")
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unexpected error updating application")

    return _row_to_dict(row)
