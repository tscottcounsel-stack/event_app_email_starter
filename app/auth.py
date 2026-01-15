# app/auth.py
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, status


class AuthUser:
    def __init__(
        self,
        id: int,
        role: str,
        organizer_id: Optional[int] = None,
        vendor_id: Optional[int] = None,
    ):
        self.id = id
        self.role = role
        self.organizer_id = organizer_id
        self.vendor_id = vendor_id


# DEV DEFAULTS (matches your DB screenshot)
DEV_ORGANIZER_USER_ID = 13
DEV_ORGANIZER_PROFILE_ID = 2


def get_current_user(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    """
    Dev auth:
      - If Authorization header is present, we still just treat it as "logged in".
      - Default user is organizer user_id=13 with organizer_profile_id=2.
    """
    # You can extend this later to decode JWTs, etc.
    return AuthUser(
        id=DEV_ORGANIZER_USER_ID,
        role="organizer",
        organizer_id=DEV_ORGANIZER_PROFILE_ID,
        vendor_id=None,
    )


def require_organizer(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if getattr(user, "role", None) != "organizer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer access required",
        )
    if getattr(user, "organizer_id", None) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer profile required",
        )
    return user


def require_vendor(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if getattr(user, "role", None) != "vendor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor access required",
        )
    if getattr(user, "vendor_id", None) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor profile required",
        )
    return user
