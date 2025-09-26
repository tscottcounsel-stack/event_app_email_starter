from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.models.application import Application
from app.schemas import (
    ApplicationCreate,
    ApplicationRead,
    ApplicationUpdate,
)

router = APIRouter(prefix="/applications", tags=["applications"])

# ── Upsert: POST will insert or update on (event_id, vendor_id) uniqueness ─────
@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def upsert_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)
    valid_cols = {c.name for c in Application.__table__.columns}
    data = {k: v for k, v in data.items() if k in valid_cols}

    try:
        obj = Application(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        # eager load vendor for response
        db.refresh(obj)  # ensure PK, then load relation
        return db.query(Application).options(joinedload(Application.vendor)).get(obj.id)
    except IntegrityError as ie:
        db.rollback()
        # detect unique pair violation (constraint name may differ; use message)
        msg = str(ie.orig)
        if "uq_applications_event_vendor" not in msg and "unique" not in msg.lower():
            raise HTTPException(status_code=400, detail=str(ie)) from ie

        existing = (
            db.query(Application)
            .filter(
                Application.event_id == data["event_id"],
                Application.vendor_id == data["vendor_id"],
            )
            .first()
        )
        if not existing:
            raise HTTPException(status_code=409, detail="Conflict on (event_id, vendor_id) but row not found")

        # don't change keys during upsert-update
        for k, v in data.items():
            if k not in ("event_id", "vendor_id"):
                setattr(existing, k, v)
        try:
            db.commit()
            # return with vendor joined
            return (
                db.query(Application)
                .options(joinedload(Application.vendor))
                .get(existing.id)
            )
        except SQLAlchemyError as ex:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(ex)) from ex
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex)) from ex

# ── List with filters: ?event_id=&vendor_id=&limit= ────────────────────────────
@router.get("", response_model=List[ApplicationRead])
def list_applications(
    event_id: Optional[int] = Query(default=None),
    vendor_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Application).options(joinedload(Application.vendor))
    if event_id is not None:
        q = q.filter(Application.event_id == event_id)
    if vendor_id is not None:
        q = q.filter(Application.vendor_id == vendor_id)
    return q.order_by(Application.id.desc()).limit(limit).all()

# ── Get by id (joined vendor) ─────────────────────────────────────────────────
@router.get("/{app_id}", response_model=ApplicationRead)
def get_application(app_id: int, db: Session = Depends(get_db)):
    obj = (
        db.query(Application)
        .options(joinedload(Application.vendor))
        .get(app_id)
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return obj

# ── PATCH ─────────────────────────────────────────────────────────────────────
@router.patch("/{app_id}", response_model=ApplicationRead)
def update_application(app_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    data = payload.model_dump(exclude_unset=True)
    valid = {c.name for c in Application.__table__.columns}
    for k, v in data.items():
        if k in valid:
            setattr(obj, k, v)
    try:
        db.commit()
        return (
            db.query(Application)
            .options(joinedload(Application.vendor))
            .get(app_id)
        )
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))

# ── PUT ───────────────────────────────────────────────────────────────────────
@router.put("/{app_id}", response_model=ApplicationRead)
def replace_application(app_id: int, payload: ApplicationCreate, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    for k, v in payload.model_dump().items():
        setattr(obj, k, v)
    try:
        db.commit()
        return (
            db.query(Application)
            .options(joinedload(Application.vendor))
            .get(app_id)
        )
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))

# ── DELETE ────────────────────────────────────────────────────────────────────
@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(app_id: int, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    db.delete(obj)
    db.commit()
    return None
