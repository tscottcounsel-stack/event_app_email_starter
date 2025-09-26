from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.application import Application
from app.schemas import ApplicationCreate, ApplicationRead, ApplicationUpdate

router = APIRouter(prefix="/applications", tags=["applications"])


@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def upsert_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    """
    Upsert semantics:
    - If (event_id, vendor_id) is new: INSERT -> 201.
    - If duplicate (unique constraint uq_applications_event_vendor): UPDATE that row with fields from payload -> 200.
    """
    data = payload.model_dump(exclude_unset=True)
    valid_cols = {c.name for c in Application.__table__.columns}
    data = {k: v for k, v in data.items() if k in valid_cols}

    # Attempt INSERT
    try:
        obj = Application(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj  # 201 (declared on decorator)
    except IntegrityError as ie:
        db.rollback()
        # Detect the specific unique constraint for (event_id, vendor_id)
        # Works for psycopg2; fall back to message substring check if needed.
        msg = str(getattr(ie.orig, "diag", "")) + " " + str(ie.orig)
        if "uq_applications_event_vendor" not in msg:
            # Not a duplicate on that constraint -> bubble up
            raise HTTPException(status_code=400, detail=str(ie)) from ie

        # Get the existing row and UPDATE with incoming fields
        existing = (
            db.query(Application)
            .filter(
                Application.event_id == data["event_id"],
                Application.vendor_id == data["vendor_id"],
            )
            .first()
        )
        if not existing:
            # Extremely rare race condition: constraint says it exists, but we can’t find it
            raise HTTPException(status_code=409, detail="Conflict on (event_id, vendor_id) but existing row not found")

        # Only update columns you actually sent (don’t clobber others)
        for k, v in data.items():
            if k in valid_cols and k not in ("event_id", "vendor_id"):  # never change keys in upsert update
                setattr(existing, k, v)

        try:
            db.commit()
            db.refresh(existing)
        except SQLAlchemyError as ex:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(ex)) from ex

        # Return 200 for update
        # (FastAPI default from decorator is 201; override explicitly)
        from fastapi import Response
        Response.status_code = status.HTTP_200_OK
        return existing

    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex)) from ex


@router.get("", response_model=List[ApplicationRead])
def list_applications(db: Session = Depends(get_db)):
    return db.query(Application).order_by(Application.id.desc()).limit(100).all()


@router.get("/{app_id}", response_model=ApplicationRead)
def get_application(app_id: int, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    return obj


@router.patch("/{app_id}", response_model=ApplicationRead)
def update_application(app_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")

    data = payload.model_dump(exclude_unset=True)
    valid_cols = {c.name for c in Application.__table__.columns}
    for k, v in data.items():
        if k in valid_cols:
            setattr(obj, k, v)

    try:
        db.commit()
        db.refresh(obj)
        return obj
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))


@router.put("/{app_id}", response_model=ApplicationRead)
def replace_application(app_id: int, payload: ApplicationCreate, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")

    for k, v in payload.model_dump().items():
        setattr(obj, k, v)

    try:
        db.commit()
        db.refresh(obj)
        return obj
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(app_id: int, db: Session = Depends(get_db)):
    obj = db.get(Application, app_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    db.delete(obj)
    db.commit()
    return None
