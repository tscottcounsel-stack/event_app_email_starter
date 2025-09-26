from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.schemas import EventCreate, EventRead, EventUpdate

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)

    # Only keep valid ORM columns (avoid unexpected kwargs)
    valid_cols = {c.name for c in Event.__table__.columns}
    data = {k: v for k, v in data.items() if k in valid_cols}

    try:
        e = Event(**data)
        db.add(e)
        db.commit()
        db.refresh(e)
        return e
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))


@router.get("", response_model=List[EventRead])
def list_events(db: Session = Depends(get_db)):
    return db.query(Event).order_by(Event.id.desc()).limit(100).all()


@router.get("/{event_id}", response_model=EventRead)
def get_event(event_id: int, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    return e


@router.patch("/{event_id}", response_model=EventRead)
def update_event(event_id: int, payload: EventUpdate, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    data = payload.model_dump(exclude_unset=True)
    valid_cols = {c.name for c in Event.__table__.columns}
    for k, v in data.items():
        if k in valid_cols:
            setattr(e, k, v)

    try:
        db.commit()
        db.refresh(e)
        return e
    except SQLAlchemyError as ex:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(ex))


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(e)
    db.commit()
    return None
