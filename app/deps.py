# app/deps.py
from __future__ import annotations

import os
from typing import Callable, Iterable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# Prefer your own auth utils
try:
    from app.auth_utils import decode_access_token as _decode_jwt  # (token) -> dict
except Exception:
    _decode_jwt = None

# Optional fallback if your auth_utils lacks decode; keep in sync with your create_access_token
try:
    import jwt  # PyJWT
except Exception:  # pragma: no cover
    jwt = None

_bearer = HTTPBearer(auto_error=True)

def _decode_token_or_401(token: str) -> dict:
    if _decode_jwt:
        try:
            payload = _decode_jwt(token)
            if not isinstance(payload, dict):
                raise ValueError("bad payload")
            return payload
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    # Fallback decode via env (must match your create_access_token)
    if not jwt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="jwt not available")
    secret = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", "change-me"))
    alg = os.getenv("JWT_ALG", "HS256")
    try:
        return jwt.decode(token, secret, algorithms=[alg])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")

def require_identity(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """
    Returns {'id': int, 'role': str, ...} from the JWT.
    """
    payload = _decode_token_or_401(creds.credentials)
    uid = payload.get("sub") or payload.get("user_id") or payload.get("uid")
    role = payload.get("role")
    try:
        uid = int(uid)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token subject")
    if not role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token role")
    return {"id": uid, "role": role, **payload}

def role_required(*allowed: Iterable[str]) -> Callable:
    """
    Usage: dependencies=[Depends(role_required("organizer","admin"))]
    """
    allowed_set = set(allowed)
    def _dep(identity: dict = Depends(require_identity)) -> None:
        if identity.get("role") not in allowed_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    return _dep
