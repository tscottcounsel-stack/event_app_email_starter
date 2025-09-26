# backend/routers/authx.py

from __future__ import annotations
import os, time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

print(f"[authx] loaded from {__file__}")

# ------------------------------------------------------------------------------
# Settings
# ------------------------------------------------------------------------------
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_MINUTES = int(os.getenv("REFRESH_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))  # 7 days
AUTH_AUTO_REGISTER_ON_LOGIN = os.getenv("AUTH_AUTO_REGISTER_ON_LOGIN", "1") == "1"

# ------------------------------------------------------------------------------
# Crypto helpers
# ------------------------------------------------------------------------------
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _hash_password(plain: str) -> str:
    return _pwd.hash(plain)

def _verify_password(plain: str, stored: str) -> bool:
    try:
        return _pwd.verify(plain, stored)
    except Exception:
        # Allow legacy/plaintext rows during dev
        return plain == (stored or "")

def _now_ts() -> int:
    return int(time.time())

def _encode_jwt(claims: Dict[str, Any], minutes: int) -> str:
    iat = _now_ts()
    exp = iat + int(minutes * 60)
    payload = {**claims, "iat": iat, "exp": exp}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

# ------------------------------------------------------------------------------
# Models
# ------------------------------------------------------------------------------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    role: str = "vendor"

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class TokenRefreshRequest(BaseModel):
    refresh_token: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: str = "vendor"

# ------------------------------------------------------------------------------
# In-memory repo
# ------------------------------------------------------------------------------
_mem: Dict[str, Dict[str, Any]] = {}
_seq = 0

def _get_user(email: str) -> Optional[Dict[str, Any]]:
    return _mem.get(email)

def _create_user(email: str, role: str, password_hash: str) -> Dict[str, Any]:
    global _seq
    _seq += 1
    u = {"id": _seq, "email": email, "role": role, "password_hash": password_hash}
    _mem[email] = u
    return u

def _issue_tokens_for_user(user_id: int) -> Dict[str, str]:
    return {
        "access_token": _encode_jwt({"sub": str(user_id), "typ": "access"}, ACCESS_TOKEN_EXPIRE_MINUTES),
        "refresh_token": _encode_jwt({"sub": str(user_id), "typ": "refresh"}, REFRESH_TOKEN_EXPIRE_MINUTES),
        "token_type": "bearer",
    }

# ------------------------------------------------------------------------------
# Router
# ------------------------------------------------------------------------------
router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/_diag")
def diag():
    return {
        "repo": "memory",
        "users": list(_mem.keys()),
        "alg": ALGORITHM,
        "access_min": ACCESS_TOKEN_EXPIRE_MINUTES,
        "refresh_min": REFRESH_TOKEN_EXPIRE_MINUTES,
        "auto_register_on_login": AUTH_AUTO_REGISTER_ON_LOGIN,
    }

@router.get("/_users")
def _users():
    # Dev-only: shows stored users (id/email/role only)
    return [{"id": u["id"], "email": e, "role": u.get("role", "vendor")} for e, u in _mem.items()]

@router.get("/_versions")
def _versions():
    def _ver(mod, attr="__version__", default="unknown"):
        try:
            return getattr(__import__(mod), attr, default)
        except Exception:
            return default
    # bcrypt sometimes stores version in bcrypt.__about__.__version__
    try:
        import bcrypt  # type: ignore
        bver = getattr(bcrypt, "__version__", None)
        if not bver:
            bver = getattr(getattr(bcrypt, "__about__", object), "__version__", "unknown")
    except Exception:
        bver = "unavailable"
    return {
        "fastapi": _ver("fastapi"),
        "pydantic": _ver("pydantic"),
        "python_jose": _ver("jose"),
        "passlib": _ver("passlib"),
        "bcrypt": bver,
    }

@router.post("/register", response_model=UserOut)
def register(payload: UserCreate):
    existing = _get_user(payload.email)
    if existing:
        return UserOut(id=existing["id"], email=existing["email"], role=existing.get("role", "vendor"))
    u = _create_user(payload.email, payload.role, _hash_password(payload.password))
    return UserOut(id=u["id"], email=u["email"], role=u.get("role", "vendor"))

@router.post("/login", response_model=Token)
def login(body: LoginRequest = Body(...)):
    try:
        u = _get_user(body.email)
        if not u:
            if not AUTH_AUTO_REGISTER_ON_LOGIN:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
            u = _create_user(body.email, "vendor", _hash_password(body.password))

        stored = u.get("password_hash") or u.get("password") or ""
        if not isinstance(stored, str):
            stored = str(stored)

        try:
            if not _verify_password(body.password, stored):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"verify_password_error: {type(e).__name__}: {e}")

        # Return a plain dict to avoid any serialization quirks
        return _issue_tokens_for_user(u["id"])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"auth_login_crash: {type(e).__name__}: {e}")

@router.post("/refresh", response_model=Token)
def refresh(body: TokenRefreshRequest):
    try:
        payload = jwt.decode(body.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"invalid_refresh_token: {type(e).__name__}")

    if payload.get("typ") != "refresh" or not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token_payload")

    try:
        user_id = int(payload["sub"])
        out = {
            "access_token": _encode_jwt({"sub": str(user_id), "typ": "access"}, ACCESS_TOKEN_EXPIRE_MINUTES),
            "refresh_token": body.refresh_token,
            "token_type": "bearer",
        }
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"refresh_issue_error: {type(e).__name__}: {e}")

