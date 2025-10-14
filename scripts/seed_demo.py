# scripts/seed_demo.py
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import application, event, slot  # noqa: F401

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL, future=True)

with engine.begin() as conn:
    Base.metadata.create_all(conn)

with Session(engine) as s:
    # create a demo event + slot if missing
    ev = s.query(event.Event).filter_by(title="Demo Event").one_or_none()
    if not ev:
        ev = event.Event(title="Demo Event")
        s.add(ev)
        s.flush()
    sl = (
        s.query(slot.EventSlot).filter_by(event_id=ev.id, label="Booth A").one_or_none()
    )
    if not sl:
        sl = slot.EventSlot(event_id=ev.id, label="Booth A")
        s.add(sl)
    s.commit()
print("Seeded.")
