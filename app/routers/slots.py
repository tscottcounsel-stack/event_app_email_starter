# app/routers/slots.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, conint
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.db import get_db
from app.deps import role_required

router = APIRouter(prefix="/events/{event_id}/slots", tags=["slots"])

class SlotIn(BaseModel):
    label: str
    price_cents: conint(ge=0) = 0
    coord_x: int | None = None
    coord_y: int | None = None
    width: int | None = None
    height: int | None = None
    notes: str | None = None

@router.get("", dependencies=[Depends(role_required("organizer","admin"))])
def list_slots(event_id: int, db: Session = Depends(get_db)):
    rows = db.execute(sa.text("""
      SELECT id, label, price_cents, status, coord_x, coord_y, width, height, notes
      FROM public.event_slots
      WHERE event_id = :eid
      ORDER BY id
    """), {"eid": event_id}).mappings().all()
    return [dict(r) for r in rows]

@router.post("", dependencies=[Depends(role_required("organizer","admin"))], status_code=201)
def create_slot(event_id: int, p: SlotIn, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
      INSERT INTO public.event_slots (event_id, label, price_cents, coord_x, coord_y, width, height, notes)
      VALUES (:eid, :label, :price, :x, :y, :w, :h, :notes)
      RETURNING id, label, price_cents, status
    """), {"eid": event_id, "label": p.label, "price": p.price_cents,
           "x": p.coord_x, "y": p.coord_y, "w": p.width, "h": p.height, "notes": p.notes}).mappings().first()
    db.commit()
    return dict(row)

@router.patch("/{slot_id}", dependencies=[Depends(role_required("organizer","admin"))])
def update_slot(event_id: int, slot_id: int, p: SlotIn, db: Session = Depends(get_db)):
    data = {k:v for k,v in p.model_dump().items() if v is not None}
    if not data:
        return {"updated": False}
    sets = ", ".join(f"{k} = :{k}" for k in data.keys())
    params = {"eid": event_id, "sid": slot_id, **data}
    row = db.execute(sa.text(f"""
      UPDATE public.event_slots
      SET {sets}
      WHERE id = :sid AND event_id = :eid
      RETURNING id, label, price_cents, status
    """), params).mappings().first()
    if not row:
        raise HTTPException(404, "slot not found")
    db.commit()
    return dict(row)
