# app/deps.py
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Sequence

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.db import get_db

# ---------------------------------------------------------------------------
# JWT configuration
# ---------------------------------------------------------------------------

# TODO: override via environment variable in production
SECRET_KEY = os.getenv("JWT_SECRET", "change-me-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class TokenData(BaseModel):
    user_id: int
    role: Optional[str] = None


def _decode_token(token: str) -> TokenData:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    sub = payload.get("sub")
    role = payload.get("role")

    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )

    try:
        user_id = int(sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        )

    return TokenData(user_id=user_id, role=role)


# ---------------------------------------------------------------------------
# Core auth dependencies
# ---------------------------------------------------------------------------


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> models.User:
    """
    Resolve the current user from the Bearer token.

    Expects a JWT with:
        sub: user_id
        role: user role (optional)
    """
    token_data = _decode_token(token)

    user = db.query(models.User).filter(models.User.id == token_data.user_id).first()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inactive or missing user",
        )

    return user


def get_current_active_user(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )
    return current_user


def role_required(*allowed_roles: str) -> Callable[[models.User], models.User]:
    """
    Dependency factory enforcing that the current user has one of the given roles.

    Usage:

        @router.post("/something")
        def handler(
            current_user: models.User = Depends(role_required("organizer", "admin")),
        ):
            ...
    """

    def _dependency(
        current_user: models.User = Depends(get_current_active_user),
    ) -> models.User:
        if allowed_roles and (current_user.role not in allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient role; requires one of {allowed_roles}",
            )
        return current_user

    return _dependency


# ---------------------------------------------------------------------------
# Token creation helper (used by auth router)
# ---------------------------------------------------------------------------


def create_access_token_for_user(
    user: models.User,
    expires_delta: Optional[timedelta] = None,
) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "sub": str(user.id),
        "role": user.role,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "type": "access",
    }

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
