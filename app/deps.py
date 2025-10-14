# app/deps.py
from __future__ import annotations

from typing import Callable, Iterable

from fastapi import Depends, Header, HTTPException, status


def require_identity(
    x_user_role: str | None = Header(None, alias="x-user-role")
) -> dict:
    """
    Dev/test-friendly identity: if the request carries x-user-role, treat as authenticated.
    Returns a dict similar to a decoded JWT payload: {"id": int, "role": str}.
    """
    if x_user_role:
        # use a dummy id for tests/dev
        return {"id": 1, "role": x_user_role}
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
    )


def role_required(*allowed_roles: Iterable[str]) -> Callable:
    """
    Usage (route): dependencies=[Depends(role_required("organizer","admin"))]
    """
    allowed = set(allowed_roles)

    def _dep(identity: dict = Depends(require_identity)) -> None:
        if identity.get("role") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="insufficient role"
            )

    return _dep
