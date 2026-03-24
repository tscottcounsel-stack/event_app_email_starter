# app/routers/organizer_diagram.py

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

router = APIRouter(
    prefix="/organizer/events",
    tags=["Organizer Diagram"],
)

# ------------------------------------------------------------------
# In-memory store (temporary)
# Later this can be replaced with DB persistence
# ------------------------------------------------------------------

_DIAGRAM_STORE: Dict[int, Dict[str, Any]] = {}


# ------------------------------------------------------------------
# GET: Fetch event diagram
# ------------------------------------------------------------------
@router.get("/{event_id}/diagram")
def get_event_diagram(event_id: int):
    """
    Return the saved diagram for an event.
    If none exists yet, return a default empty diagram.
    """

    if event_id not in _DIAGRAM_STORE:
        return {
            "event_id": event_id,
            "version": 1,
            "diagram": {
                "boothMap": {},
                "meta": {
                    "gridSize": 10,
                    "canvas": {"width": 1200, "height": 800},
                    "mode": "single-floor",
                },
            },
            "source": "memory",
        }

    return _DIAGRAM_STORE[event_id]


# ------------------------------------------------------------------
# PUT: Save / update event diagram
# ------------------------------------------------------------------
@router.put("/{event_id}/diagram")
def save_event_diagram(event_id: int, payload: Dict[str, Any]):
    """
    Save or update the diagram for an event.

    Expected payload:
    {
        "diagram": { ... },
        "expect_version": number | null
    }
    """

    diagram = payload.get("diagram")
    expect_version = payload.get("expect_version")

    if not diagram:
        raise HTTPException(status_code=400, detail="diagram is required")

    current = _DIAGRAM_STORE.get(event_id)

    # Version check (optimistic locking)
    if current and expect_version is not None:
        if current["version"] != expect_version:
            raise HTTPException(
                status_code=409,
                detail="Diagram version mismatch",
            )

    next_version = 1 if not current else current["version"] + 1

    saved = {
        "event_id": event_id,
        "version": next_version,
        "diagram": diagram,
        "source": "memory",
    }

    _DIAGRAM_STORE[event_id] = saved
    return saved
