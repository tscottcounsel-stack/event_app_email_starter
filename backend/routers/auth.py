# backend/routers/auth.py
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from backend.deps import SimpleUser, get_current_user
from backend.security import get_password_hash, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory user store: email -> user dict
_USERS: Dict[str, Dict[str, Any]] = {}  # {"id": int, "email": str, "role": str, "password_hash": str}
_NEXT_ID = 1


def _get_user_by_id(uid: int) -> Optional[Dict[str, Any]]:
    """Lookup by numeric id (store is keyed by email, so scan values)."""
    for u in _USERS.values():
        if u.get("id") == uid:
            return u
    return None


def _reset_auth() -> None:
    """Reset in-memory user store (used by cleanup router/tests)."""
    global _NEXT_ID
    _USERS.clear()
    _NEXT_ID = 1


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    role: str  # "vendor" | "organizer" | "admin" (admin allowed for completeness)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/me")
def who_am_i(user: SimpleUser = Depends(get_current_user)):
    """Quick introspection of the resolved user."""
    return user.model_dump()


@router.post("/register")
def register(payload: RegisterRequest):
    global _NEXT_ID
    email = payload.email.lower()
    role = payload.role.lower()

    if role not in {"vendor", "organizer", "admin"}:
        raise HTTPException(status_code=422, detail="Invalid role")

    if email in _USERS:
        # Tests accept 200 or 400 when re-registering; we return 400.
        raise HTTPException(status_code=400, detail="User already exists")

    _USERS[email] = {
        "id": _NEXT_ID,
        "email": email,
        "role": role,
        "password_hash": get_password_hash(payload.password),
    }
    _NEXT_ID += 1
    # Keep response minimal; tests don’t require the id here.
    return {"status": "ok"}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    email = payload.email.lower()
    user = _USERS.get(email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # IMPORTANT: include id/email/role so dev tokens become "token-<id>"
    # and strict JWTs embed the same claims.
    token = create_access_token(
        {"id": user["id"], "email": user["email"], "role": user["role"]}
    )
    return {"access_token": token, "token_type": "bearer"}


@router.post("/refresh", response_model=TokenResponse)
def refresh(user: SimpleUser = Depends(get_current_user)):
    token = create_access_token(
        {"id": user.id, "email": user.email, "role": user.role}
    )
    return {"access_token": token, "token_type": "bearer"}
