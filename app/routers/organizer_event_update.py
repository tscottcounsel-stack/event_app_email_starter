# app/routers/organizer_event_update.py
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models.event import Event

router = APIRouter(prefix="/organizer", tags=["organizer"])


def _require_organizer(user: Any) -> None:
    """
    Ensure the caller is an organizer or admin.
    This matches the existing Organizer Event Update contract.
    """
    role = getattr(user, "role", None) or getattr(user, "user_role", None)
    if role not in ("organizer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer access required",
        )


def _validate_capacity_payload(data: Dict[str, Any]) -> None:
    """
    Defensive validation for new capacity fields.

    Contract (capacity addendum):
    - total_vendor_capacity: optional, integer >= 0
    - category_vendor_capacity: optional, JSON array of objects:
        [ { "category": string, "target": integer >= 0 }, ... ]
    """
    if "total_vendor_capacity" in data:
        value = data["total_vendor_capacity"]
        if value is not None:
            if not isinstance(value, int):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="total_vendor_capacity must be an integer or null",
                )
            if value < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="total_vendor_capacity must be >= 0",
                )

    if "category_vendor_capacity" in data:
        raw = data["category_vendor_capacity"]
        if raw is None:
            # Null is allowed; means "no per-category targets"
            return

        if not isinstance(raw, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="category_vendor_capacity must be a list of objects",
            )

        normalized: List[Dict[str, Any]] = []
        for idx, item in enumerate(raw):
            if not isinstance(item, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"category_vendor_capacity[{idx}] must be an object",
                )

            category = item.get("category")
            target = item.get("target")

            if not isinstance(category, str) or not category.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"category_vendor_capacity[{idx}].category must be a non-empty string",
                )

            if target is None:
                # Allow null → treat as 0
                target_int = 0
            elif isinstance(target, int):
                target_int = target
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"category_vendor_capacity[{idx}].target must be an integer",
                )

            if target_int < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"category_vendor_capacity[{idx}].target must be >= 0",
                )

            normalized.append({"category": category.strip(), "target": target_int})

        # Replace with normalized list so DB always gets clean data
        data["category_vendor_capacity"] = normalized


@router.patch("/events/{event_id}", summary="Update an event (organizer)")
def organizer_update_event(
    event_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    """
    Organizer event update endpoint.

    Locked behavior (from DIAGRAM_CONTRACT):
    - Auth: organizer/admin required
    - PATCH semantics: partial update
    - Guaranteed supported fields:
        * title
        * description
        * location
        * date
      plus legacy aliases: name → title, venue → location, start_date → date

    Extended behavior (capacity contract):
    - Optional fields:
        * total_vendor_capacity: int >= 0 or null
        * category_vendor_capacity: JSON array as described above

    No diagram, application, or other schema behavior is modified here.
    """
    _require_organizer(user)

    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    # Base allowed keys (locked contract)
    allowed = {
        "title",
        "name",  # alias -> title
        "description",
        "location",
        "venue",  # alias -> location
        "date",
        "start_date",  # alias -> date
        # Capacity fields (new, additive)
        "total_vendor_capacity",
        "category_vendor_capacity",
    }

    # Filter down to known keys only
    data: Dict[str, Any] = {k: v for k, v in (payload or {}).items() if k in allowed}

    # Handle aliases for core fields
    if "name" in data and "title" not in data:
        data["title"] = data.pop("name")
    if "venue" in data and "location" not in data:
        data["location"] = data.pop("venue")
    if "start_date" in data and "date" not in data:
        data["date"] = data.pop("start_date")

    # Validate capacity payload (if present)
    _validate_capacity_payload(data)

    changed = False
    for k, v in data.items():
        if hasattr(ev, k):
            setattr(ev, k, v)
            changed = True

    if not changed:
        # No-op update: return current event unchanged
        return ev

    try:
        db.add(ev)
        db.commit()
        db.refresh(ev)
        return ev
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Update failed: {type(e).__name__}: {e}",
        )
