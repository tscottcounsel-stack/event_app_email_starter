# app/services/diagram_loader.py
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import EventDiagram, EventDiagramHistory, EventsDiagram


def load_event_diagram(db: Session, event_id: int):
    """
    Return the most recent diagram for an event.
    Prefers:
      1) event_diagrams
      2) event_diagram
      3) events_diagram
    """

    # New table
    row = (
        db.query(EventDiagram)
        .filter(EventDiagram.event_id == event_id)
        .order_by(EventDiagram.id.desc())
        .first()
    )
    if row:
        return row.data, row.version

    # Legacy table
    row = (
        db.query(EventsDiagram)
        .filter(EventsDiagram.event_id == event_id)
        .order_by(EventsDiagram.id.desc())
        .first()
    )
    if row:
        return row.data, row.version

    # Older legacy
    row = (
        db.query(EventDiagramHistory)
        .filter(EventDiagramHistory.event_id == event_id)
        .order_by(EventDiagramHistory.version.desc())
        .first()
    )
    if row:
        return row.data, row.version

    return None, None
