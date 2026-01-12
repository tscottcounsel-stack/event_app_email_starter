from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.routers.public_diagram import load_event_diagram

router = APIRouter(prefix="/vendor", tags=["vendor-diagram"])


@router.get("/events/{event_id}/diagram")
def get_vendor_event_diagram(
    event_id: int,
    db: Session = Depends(get_db),
    debug: bool = Query(False),
):
    # For now vendor gets the same diagram as public.
    # Later we can overlay “mine/assigned” coloring server-side if you want.
    payload = load_event_diagram(db=db, event_id=event_id)
    if not debug:
        payload.pop("debug", None)
    return payload
