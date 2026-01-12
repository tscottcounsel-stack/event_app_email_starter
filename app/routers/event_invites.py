from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.auth import AuthUser, get_current_user
from app.database import get_db

router = APIRouter(prefix="/organizer/events", tags=["organizer-events"])


@router.delete("/{event_id}/invites/{invite_id}")
def delete_event_invite(
    event_id: int,
    invite_id: int,
    current_user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Delete an invite by id, scoped to an event.
    """
    # Verify that record exists AND belongs to this event
    row = db.execute(
        text(
            """
            SELECT id FROM event_invites
            WHERE id = :invite_id AND event_id = :event_id
            """
        ),
        dict(invite_id=invite_id, event_id=event_id),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Invite not found.")

    db.execute(
        text(
            """
            DELETE FROM event_invites
            WHERE id = :invite_id
            """
        ),
        dict(invite_id=invite_id),
    )
    db.commit()

    return {"status": "deleted", "invite_id": invite_id}
