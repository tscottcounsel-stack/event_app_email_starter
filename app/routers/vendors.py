from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import sqlalchemy as sa

from app.db import get_db
from app.deps import role_required
from app.schemas import VendorCreate, VendorRead

router = APIRouter(prefix="/vendors", tags=["vendors"])

@router.post("", response_model=dict, dependencies=[Depends(role_required("organizer","admin"))], status_code=201)
def create_vendor(p: VendorCreate, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
        INSERT INTO public.vendors (name, category, phone, description)
        VALUES (:name, :category, :phone, :description)
        RETURNING id
    """), p.model_dump()).fetchone()
    db.commit()
    return {"id": row.id}

@router.get("/{vendor_id}", response_model=VendorRead)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
        SELECT id, name, category, phone, description, created_at, updated_at
        FROM public.vendors
        WHERE id = :vid
    """), {"vid": vendor_id}).mappings().first()
    if not row:
        raise HTTPException(404, "vendor not found")
    return dict(row)

@router.get("", response_model=list[VendorRead])
def list_vendors(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = db.execute(sa.text("""
        SELECT id, name, category, phone, description, created_at, updated_at
        FROM public.vendors
        ORDER BY id
        LIMIT :limit OFFSET :offset
    """), {"limit": limit, "offset": offset}).mappings().all()
    return [dict(r) for r in rows]
