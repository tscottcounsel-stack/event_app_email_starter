from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from jose import jwt
except Exception:
    jwt = None

from app.auth_config import JWT_ALG, JWT_AUD, JWT_ISS, JWT_SECRET

bearer = HTTPBearer(auto_error=False)


def _decode_token_or_401(token: str) -> dict:
    if jwt is None:
        raise HTTPException(
            status_code=500,
            detail="Missing dependency for JWT. Install: python-jose[cryptography]",
        )

    try:
        return jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            audience=JWT_AUD,
            issuer=JWT_ISS,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return _decode_token_or_401(creds.credentials)


def get_current_vendor(user: dict = Depends(get_current_user)) -> dict:
    role = str(user.get("role") or "")
    if role != "vendor":
        raise HTTPException(status_code=403, detail="Vendor role required")
    return user


def get_current_organizer(user: dict = Depends(get_current_user)) -> dict:
    role = str(user.get("role") or "")
    if role != "organizer":
        raise HTTPException(status_code=403, detail="Organizer role required")
    return user
