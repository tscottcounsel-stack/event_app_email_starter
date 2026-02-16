# app/routers/auth.py
from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict

# --- Optional dependencies (recommended) ---
# pip install "python-jose[cryptography]" passlib[bcrypt]
try:
    from jose import jwt  # type: ignore
except Exception:  # pragma: no cover
    jwt = None  # type: ignore

try:
    from passlib.context import CryptContext  # type: ignore
except Exception:  # pragma: no cover
    CryptContext = None  # type: ignore


router = APIRouter(tags=["Auth"])
bearer = HTTPBearer(auto_error=False)

# -------------------------------------------------------------------
# In-memory users (dev-only)
# -------------------------------------------------------------------
_USERS: dict[int, dict] = {}
_USERS_BY_EMAIL: dict[str, int] = {}
_USERS_BY_USERNAME: dict[str, int] = {}
_NEXT_ID = 1

# JWT settings
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")
JWT_ISS = os.getenv("JWT_ISS", "event-app")
JWT_AUD = os.getenv("JWT_AUD", "event-app-clients")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "1440"))  # 24h default

# Password hashing (bcrypt if available)
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto") if CryptContext else None


# -------------------------------------------------------------------
# Request/Response Models
# -------------------------------------------------------------------
class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    email: str
    password: str
    role: Optional[str] = "vendor"
    username: Optional[str] = None


class LoginRequest(BaseModel):
    """
    Accepts both old and new frontend payloads.
    Frontend currently sends: email, password, role, username
    """

    model_config = ConfigDict(extra="allow")
    email: Optional[str] = None
    username: Optional[str] = None
    password: str
    role: Optional[str] = None  # ignored for auth (role comes from stored user)


class AuthResponse(BaseModel):
    accessToken: str
    role: str


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def _normalize_identifier(v: Optional[str]) -> str:
    return (v or "").strip().lower()


def _hash_password(pw: str) -> str:
    if _pwd:
        return _pwd.hash(pw)
    # dev fallback (NOT for prod)
    return "plain:" + pw


def _verify_password(pw: str, hashed: str) -> bool:
    if _pwd:
        try:
            return _pwd.verify(pw, hashed)
        except Exception:
            return False
    return hashed == ("plain:" + pw)


def _create_access_token(*, email: str, role: str, is_active: bool = True) -> str:
    if jwt is None:
        raise HTTPException(
            status_code=500,
            detail="Missing dependency for JWT. Install: python-jose[cryptography]",
        )

    now = int(time.time())
    exp = now + ACCESS_TOKEN_MINUTES * 60

    payload = {
        "sub": email,
        "email": email,
        "role": role,
        "is_active": is_active,
        "iat": now,
        "exp": exp,
        "iss": JWT_ISS,
        "aud": JWT_AUD,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode_token(token: str) -> Dict[str, Any]:
    if jwt is None:
        raise HTTPException(
            status_code=500,
            detail="Missing dependency for JWT. Install: python-jose[cryptography]",
        )

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            audience=JWT_AUD,
            issuer=JWT_ISS,
            options={"verify_signature": True, "verify_aud": True, "verify_iss": True},
        )
        return payload
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}"
        )


def _index_user(user: dict) -> None:
    """
    Ensures our lookup maps are consistent.
    """
    email = _normalize_identifier(user.get("email"))
    username = _normalize_identifier(user.get("username") or email)

    _USERS_BY_EMAIL[email] = int(user["id"])
    _USERS_BY_USERNAME[username] = int(user["id"])


def _add_user(
    *,
    user_id: int,
    email: str,
    password: str,
    role: str,
    username: Optional[str] = None,
) -> None:
    e = _normalize_identifier(email)
    u = _normalize_identifier(username or e)

    _USERS[user_id] = {
        "id": user_id,
        "email": e,
        "username": u,
        "password_hash": _hash_password(password),
        "role": role,
        "is_active": True,
    }
    _index_user(_USERS[user_id])


def _seed_dev_users() -> None:
    """
    Seeds the known dev accounts so login always works in local dev.
    You can disable seeding by setting AUTH_DISABLE_DEV_SEED=1.
    """
    global _NEXT_ID

    if os.getenv("AUTH_DISABLE_DEV_SEED", "").strip() in (
        "1",
        "true",
        "TRUE",
        "yes",
        "YES",
    ):
        return

    # Only seed if not already present
    existing = set(_USERS_BY_EMAIL.keys())

    seed = [
        (13, "organizer@example.com", "organizer123", "organizer"),
        (14, "vendor@example.com", "vendor123", "vendor"),
        (15, "admin@example.com", "admin123", "admin"),
        (5, "pytest_vendor@example.com", "vendor123", "vendor"),
        (16, "vendor1@example.com", "vendor123", "vendor"),
    ]

    for user_id, email, pw, role in seed:
        e = _normalize_identifier(email)
        if e in existing:
            continue
        _add_user(user_id=user_id, email=e, password=pw, role=role, username=e)

    # make _NEXT_ID always > max id
    if _USERS:
        _NEXT_ID = max(_USERS.keys()) + 1


# Seed on import (dev convenience)
_seed_dev_users()


# -------------------------------------------------------------------
# Dependencies
# -------------------------------------------------------------------
def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    payload = _decode_token(creds.credentials)

    role = str(payload.get("role") or "").lower().strip()
    if role not in ("vendor", "organizer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid role in token"
        )

    if payload.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive account"
        )

    return payload


def get_current_vendor(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    if str(user.get("role") or "").lower() != "vendor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Vendor role required"
        )
    return user


def get_current_organizer(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    if str(user.get("role") or "").lower() != "organizer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Organizer role required"
        )
    return user


def get_current_admin(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    if str(user.get("role") or "").lower() != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required"
        )
    return user


# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------
@router.post("/register", response_model=AuthResponse, status_code=200)
def register(payload: RegisterRequest) -> AuthResponse:
    global _NEXT_ID

    email = _normalize_identifier(payload.email)
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    role = _normalize_identifier(payload.role or "vendor")
    if role not in ("vendor", "organizer", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")

    if email in _USERS_BY_EMAIL:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = _NEXT_ID
    _NEXT_ID += 1

    username = _normalize_identifier(payload.username or email)

    _USERS[user_id] = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": _hash_password(payload.password),
        "role": role,
        "is_active": True,
    }
    _index_user(_USERS[user_id])

    token = _create_access_token(email=email, role=role, is_active=True)
    return AuthResponse(accessToken=token, role=role)


@router.post("/login", response_model=AuthResponse, status_code=200)
def login(payload: LoginRequest) -> AuthResponse:
    """
    Accepts either:
      - email + password
      - username + password
    Ignores client-provided role; role comes from stored user.
    """
    # Ensure dev accounts exist even if module reloads in a weird order
    _seed_dev_users()

    email = _normalize_identifier(payload.email)
    username = _normalize_identifier(payload.username)

    identifier = email or username
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username required")

    user_id = _USERS_BY_EMAIL.get(identifier) or _USERS_BY_USERNAME.get(identifier)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = _USERS[user_id]

    if not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")

    token = _create_access_token(
        email=str(user["email"]), role=str(user["role"]), is_active=True
    )
    return AuthResponse(accessToken=token, role=str(user["role"]))


@router.post("/refresh", response_model=AuthResponse, status_code=200)
def refresh(user: Dict[str, Any] = Depends(get_current_user)) -> AuthResponse:
    email = str(user.get("email") or "")
    role = str(user.get("role") or "vendor")
    token = _create_access_token(email=email, role=role, is_active=True)
    return AuthResponse(accessToken=token, role=role)
