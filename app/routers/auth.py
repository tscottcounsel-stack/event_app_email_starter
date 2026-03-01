# app/routers/auth.py
from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict

# Optional JWT + bcrypt (works without them in dev)
try:
    from jose import jwt  # type: ignore
except Exception:
    jwt = None  # type: ignore

try:
    from passlib.context import CryptContext  # type: ignore

    _PWD = CryptContext(schemes=["bcrypt"], deprecated="auto")
except Exception:
    _PWD = None

router = APIRouter(tags=["Auth"])
bearer = HTTPBearer(auto_error=False)

# -------------------------------------------------------------------
# In-memory user store (dev)
# -------------------------------------------------------------------

_USERS: Dict[int, Dict[str, Any]] = {}
_USERS_BY_EMAIL: Dict[str, int] = {}
_USERS_BY_USERNAME: Dict[str, int] = {}
_NEXT_ID = 1


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _index_user(u: Dict[str, Any]) -> None:
    e = _norm(u.get("email"))
    if e:
        _USERS_BY_EMAIL[e] = int(u["id"])
    un = _norm(u.get("username"))
    if un:
        _USERS_BY_USERNAME[un] = int(u["id"])


# -------------------------------------------------------------------
# Password hashing
# -------------------------------------------------------------------


def _hash_password(pw: str) -> str:
    if _PWD:
        return _PWD.hash(pw)
    # dev fallback
    return "plain$" + pw


def _verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    if _PWD:
        try:
            return _PWD.verify(pw, hashed)
        except Exception:
            return False
    if hashed.startswith("plain$"):
        return hashed == ("plain$" + pw)
    return False


def _add_user(
    *,
    user_id: int,
    email: str,
    password: str,
    role: str,
    username: Optional[str] = None,
) -> None:
    u = {
        "id": int(user_id),
        "email": _norm(email),
        "username": _norm(username or email),
        "password_hash": _hash_password(password),
        "role": role,
        "is_active": True,
    }
    _USERS[int(user_id)] = u
    _index_user(u)


def _seed_dev_users() -> None:
    """
    Seeds known dev accounts.
    Disable with AUTH_DISABLE_DEV_SEED=1
    """
    global _NEXT_ID
    if _norm(os.getenv("AUTH_DISABLE_DEV_SEED")) in ("1", "true", "yes"):
        return

    seed = [
        (13, "organizer@example.com", "organizer123", "organizer"),
        (14, "vendor@example.com", "vendor123", "vendor"),
        (15, "admin@example.com", "admin123", "admin"),
        (5, "pytest_vendor@example.com", "vendor123", "vendor"),
        (16, "vendor1@example.com", "vendor123", "vendor"),
        (17, "sammys@example.com", "aabbcc1", "vendor"),  # convenient
    ]

    for uid, email, pw, role in seed:
        if _norm(email) in _USERS_BY_EMAIL:
            continue
        _add_user(user_id=uid, email=email, password=pw, role=role, username=email)

    if _USERS:
        _NEXT_ID = max(_USERS.keys()) + 1


_seed_dev_users()

# -------------------------------------------------------------------
# JWT
# -------------------------------------------------------------------

_JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
_JWT_ALG = os.getenv("JWT_ALG", "HS256")
_JWT_TTL_SECONDS = int(os.getenv("JWT_TTL_SECONDS", "86400"))
_AUD = "event-app-clients"
_ISS = "event-app"


def _create_access_token(*, email: str, role: str, is_active: bool) -> str:
    if jwt is None:
        # dev fallback token (NOT a real JWT)
        return f"devtoken:{email}:{role}:{int(time.time())}"

    now = int(time.time())
    payload = {
        "sub": email,  # use email as sub in this dev app
        "email": email,
        "role": role,
        "is_active": bool(is_active),
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
        "iss": _ISS,
        "aud": _AUD,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


def _decode_token(token: str) -> Dict[str, Any]:
    if jwt is None:
        if token.startswith("devtoken:"):
            parts = token.split(":")
            email = parts[1] if len(parts) > 1 else ""
            role = parts[2] if len(parts) > 2 else "vendor"
            return {"email": email, "role": role, "is_active": True}
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG], audience=_AUD)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    payload = _decode_token(creds.credentials)
    email = str(payload.get("email") or payload.get("sub") or "").strip().lower()
    role = str(payload.get("role") or "vendor").strip().lower()
    is_active = bool(payload.get("is_active", True))

    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    return {"email": email, "role": role, "is_active": is_active}


# -------------------------------------------------------------------
# Models
# -------------------------------------------------------------------


class LoginRequest(BaseModel):
    """
    Frontend currently sends: email, password, role, username
    """

    model_config = ConfigDict(extra="allow")
    email: Optional[str] = None
    username: Optional[str] = None
    password: str
    role: Optional[str] = None


class AuthResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accessToken: str
    role: str
    email: str  # IMPORTANT: frontend needs this to display correct identity


# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------


@router.post("/login", response_model=AuthResponse, status_code=200)
def login(payload: LoginRequest) -> AuthResponse:
    _seed_dev_users()

    identifier = _norm(payload.email) or _norm(payload.username)
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username required")

    master_pw = os.getenv("AUTH_DEV_MASTER_PASSWORD", "aabbcc1")

    user_id = _USERS_BY_EMAIL.get(identifier) or _USERS_BY_USERNAME.get(identifier)

    global _NEXT_ID

    # Dev convenience: auto-create user if master password used
    if not user_id:
        if payload.password == master_pw:
            role = _norm(payload.role) or "vendor"
            if role not in ("vendor", "organizer", "admin"):
                role = "vendor"
            user_id = int(_NEXT_ID)
            _NEXT_ID += 1
            _add_user(
                user_id=user_id,
                email=identifier,
                password=master_pw,
                role=role,
                username=identifier,
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")

    user = _USERS[int(user_id)]

    # Master password bypass for existing users (dev)
    if payload.password != master_pw:
        if not _verify_password(payload.password, user.get("password_hash", "")):
            raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")

    token = _create_access_token(
        email=str(user["email"]), role=str(user["role"]), is_active=True
    )
    return AuthResponse(
        accessToken=token, role=str(user["role"]), email=str(user["email"])
    )


@router.post("/refresh", response_model=AuthResponse, status_code=200)
def refresh(user: Dict[str, Any] = Depends(get_current_user)) -> AuthResponse:
    email = str(user.get("email") or "")
    role = str(user.get("role") or "vendor")
    token = _create_access_token(email=email, role=role, is_active=True)
    return AuthResponse(accessToken=token, role=role, email=email)
