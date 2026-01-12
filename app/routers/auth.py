# app/routers/auth.py
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app import models
from app.db import get_db
from app.deps import create_access_token_for_user, get_current_active_user

router = APIRouter(tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: str
    password: str
    role: Optional[str] = None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: Optional[str] = None
    is_active: bool


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def _verify_password(plain_password: str, hashed_password: str) -> bool:
    # If hashed_password doesn't look like a bcrypt hash, this will fail.
    # That's OK: seeded users must have a valid hash for real auth.
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/register", response_model=UserOut)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> UserOut:
    """
    Register a new user in the real `users` table.

    If the email already exists, we raise 400.
    """
    existing = _get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = models.User(
        email=payload.email,
        hashed_password=_hash_password(payload.password),
        role=payload.role or "vendor",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user  # Pydantic will convert via from_attributes


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Authenticate a user with email + password and return a JWT access token.
    """
    user = _get_user_by_email(db, payload.email)
    if not user or not _verify_password(payload.password, user.hashed_password):
        # Deliberately generic message to avoid leaking which part failed
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    access_token = create_access_token_for_user(
        user,
        expires_delta=timedelta(minutes=60 * 24),
    )
    return TokenResponse(access_token=access_token)


@router.get("/me", response_model=UserOut)
def auth_me(current_user: models.User = Depends(get_current_active_user)) -> UserOut:
    """
    Return the current authenticated user.

    Useful for front-end "who am I?" checks.
    """
    return current_user


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    current_user: models.User = Depends(get_current_active_user),
) -> TokenResponse:
    """
    Issue a new access token for the current user.
    """
    access_token = create_access_token_for_user(current_user)
    return TokenResponse(access_token=access_token)
