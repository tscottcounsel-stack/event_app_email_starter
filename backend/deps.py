# backend/deps.py
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from pydantic import BaseModel


class SimpleUser(BaseModel):
    id: int
    email: str
    role: str  # "organizer" | "vendor"


def _decode_token_to_user(token: str) -> SimpleUser:
    """
    Decode an access token into a SimpleUser.
    Supports two modes:
      1) Non-strict (default): accept "token-<id>" dev tokens.
      2) Strict JWT (ENABLE_STRICT_JWT=1): delegate to backend.security.decode_access_token.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # --- Non-strict fast path: accept plain "token-<id>" tokens ---
    if os.getenv("ENABLE_STRICT_JWT") != "1":
        m = re.fullmatch(r"token-(\d+)", token.strip())
        if m:
            uid = int(m.group(1))
            # We don't have a global user store here without creating a circular import,
            # so assume vendor for dev tokens; this is enough for vendor-only flows.
            return SimpleUser(id=uid, email=f"user{uid}@example.com", role="vendor")

    # --- Strict path (or non-matching token): defer to security module ---
    try:
        from backend.security import decode_access_token  # type: ignore
        data = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Normalize to SimpleUser
    if isinstance(data, dict):
        uid = data.get("id") or data.get("user_id") or 0
        email = data.get("email") or "unknown@example.com"
        role = data.get("role") or "vendor"
    else:
        uid = getattr(data, "id", 0)
        email = getattr(data, "email", "unknown@example.com")
        role = getattr(data, "role", "vendor")

    try:
        uid_int = int(uid)
    except Exception:
        uid_int = 0

    return SimpleUser(id=uid_int, email=email, role=role)


def current_user(
    request: Request,
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_user_email: Optional[str] = Header(None, alias="X-User-Email"),
) -> SimpleUser:
    """
    Auth rules:
      • If DISABLE_AUTH=1 and X-Role is provided -> bypass (no token needed).
      • Else if Authorization: Bearer <token> present -> decode via _decode_token_to_user.
      • Else 401.
    """
    bypass = os.getenv("DISABLE_AUTH") == "1"

    if bypass and x_role:
        role = x_role.strip().lower()
        if role not in ("organizer", "vendor"):
            raise HTTPException(status_code=403, detail="Invalid dev role")
        try:
            uid = int(x_user_id) if x_user_id else (1 if role == "organizer" else 2)
        except Exception:
            uid = 0
        email = x_user_email or f"{role}{uid}@dev.local"
        return SimpleUser(id=uid, email=email, role=role)

    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
            return _decode_token_to_user(token)

    raise HTTPException(status_code=401, detail="Not authenticated")


# Back-compat alias used across routers/tests
get_current_user = current_user


def require_organizer(user: SimpleUser = Depends(current_user)) -> SimpleUser:
    if user.role != "organizer":
        raise HTTPException(status_code=403, detail="Organizer role required")
    return user


def require_vendor(user: SimpleUser = Depends(current_user)) -> SimpleUser:
    if user.role != "vendor":
        raise HTTPException(status_code=403, detail="Vendor role required")
    return user
