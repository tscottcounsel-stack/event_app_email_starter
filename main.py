# ---- Event Slots CRUD ----
from pydantic import BaseModel, conint
from fastapi import HTTPException

class SlotCreate(BaseModel):
    label: str
    price_cents: conint(ge=0) = 0
    coord_x: int | None = None
    coord_y: int | None = None
    width:   int | None = None
    height:  int | None = None
    notes:   str | None = None

class SlotPatch(BaseModel):
    label: str | None = None
    price_cents: conint(ge=0) | None = None
    coord_x: int | None = None
    coord_y: int | None = None
    width:   int | None = None
    height:  int | None = None
    notes:   str | None = None
    status:  str | None = None   # 'available' | 'held' | 'reserved' | 'blocked'...

@app.get("/events/{event_id}/slots")
def list_event_slots(event_id: int, db: Session = Depends(get_db)):
    rows = db.execute(sa.text("""
        SELECT id, event_id, label, coord_x, coord_y, width, height,
               price_cents, status, notes
        FROM public.event_slots
        WHERE event_id = :eid
        ORDER BY label
    """), {"eid": event_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/events/{event_id}/slots", dependencies=[Depends(role_required("organizer","admin"))], status_code=201)
def create_event_slot(event_id: int, p: SlotCreate, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
        INSERT INTO public.event_slots
          (event_id, label, coord_x, coord_y, width, height, price_cents, status, notes)
        VALUES
          (:event_id, :label, :coord_x, :coord_y, :width, :height, :price_cents, 'available', :notes)
        RETURNING id
    """), {"event_id": event_id, **p.model_dump()}).fetchone()
    db.commit()
    return {"id": row.id}

@app.patch("/events/{event_id}/slots/{slot_id}", dependencies=[Depends(role_required("organizer","admin"))])
def patch_event_slot(event_id: int, slot_id: int, p: SlotPatch, db: Session = Depends(get_db)):
    data = {k: v for k, v in p.model_dump().items() if v is not None}
    if not data:
        return {"updated": False}
    sets = ", ".join(f"{k} = :{k}" for k in data.keys())
    params = {"event_id": event_id, "slot_id": slot_id, **data}
    row = db.execute(sa.text(f"""
        UPDATE public.event_slots
        SET {sets}
        WHERE id = :slot_id AND event_id = :event_id
        RETURNING id, event_id, label, price_cents, status, coord_x, coord_y, width, height, notes
    """), params).mappings().first()
    if not row:
        raise HTTPException(404, "slot not found")
    db.commit()
    return dict(row)

@app.delete("/events/{event_id}/slots/{slot_id}", dependencies=[Depends(role_required("organizer","admin"))], status_code=204)
def delete_event_slot(event_id: int, slot_id: int, db: Session = Depends(get_db)):
    # Will fail if referenced by applications.slot_id unless it's NULL / ON DELETE rules allow
    res = db.execute(sa.text("""
        DELETE FROM public.event_slots
        WHERE id = :slot_id AND event_id = :event_id
    """), {"slot_id": slot_id, "event_id": event_id})
    if res.rowcount == 0:
        raise HTTPException(404, "slot not found")
    db.commit()
    return
