# app/routers/organizer_diagram.py

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user
from app.store import _EVENTS

router = APIRouter(
    prefix="/organizer/events",
    tags=["Organizer Diagram"],
)

# ------------------------------------------------------------------
# In-memory store (temporary)
# Later this can be replaced with DB persistence
# ------------------------------------------------------------------

_DIAGRAM_STORE: Dict[int, Dict[str, Any]] = {}


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _get_event_or_404(event_id: int) -> Dict[str, Any]:
    event = _EVENTS.get(int(event_id))
    if not isinstance(event, dict):
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _matches_current_organizer(
    *,
    organizer_email: str,
    organizer_id: Any,
    record_email: Any,
    record_id: Any,
) -> bool:
    rec_email = _norm_email(record_email)
    rec_id = None if record_id is None else str(record_id)

    if organizer_email:
        if rec_email:
            return rec_email == organizer_email
        return (
            rec_id is not None
            and organizer_id is not None
            and rec_id == str(organizer_id)
        )

    if organizer_id is not None:
        return rec_id is not None and rec_id == str(organizer_id)

    return False


def _ensure_event_access(event: Dict[str, Any], user: Dict[str, Any]) -> None:
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return

    organizer_email = _norm_email(user.get("email"))
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    allowed = _matches_current_organizer(
        organizer_email=organizer_email,
        organizer_id=organizer_id,
        record_email=event.get("organizer_email") or event.get("owner_email"),
        record_id=event.get("organizer_id")
        or event.get("owner_id")
        or event.get("created_by"),
    )

    if not allowed:
        raise HTTPException(status_code=403, detail="Not allowed to access this event")


# ------------------------------------------------------------------
# GET: Fetch event diagram
# ------------------------------------------------------------------
@router.get("/{event_id}/diagram")
def get_event_diagram(event_id: int, user: dict = Depends(get_current_user)):
    """
    Return the saved diagram for an event.
    If none exists yet, return a default empty diagram.
    """

    event = _get_event_or_404(event_id)
    _ensure_event_access(event, user)

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
def save_event_diagram(
    event_id: int,
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
):
    """
    Save or update the diagram for an event.

    Expected payload:
    {
        "diagram": { ... },
        "expect_version": number | null
    }
    """

    event = _get_event_or_404(event_id)
    _ensure_event_access(event, user)

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
