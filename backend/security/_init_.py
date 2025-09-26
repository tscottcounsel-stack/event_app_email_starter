# backend/security/__init__.py
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode(s + pad)


def create_access_token(user: Any) -> str:
    """
    If ENABLE_STRICT_JWT=1 and JWT_SECRET is set:
      - return a signed HS256 JWT with id/email/role
    Else:
      - return a simple dev token: "token-<id>"
    """
    uid = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
    email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    role = getattr(user, "role", None) or (user.get("role") if isinstance(user, dict) else None)

    strict = os.getenv("ENABLE_STRICT_JWT") in ("1", "true", "True")
    secret = os.getenv("JWT_SECRET")

    if strict and secret:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {"sub": str(uid), "email": email, "role": role, "iat": int(time.time())}
        header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode())
        payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
        signing_input = f"{header_b64}.{payload_b64}".encode()
        sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
        return f"{header_b64}.{payload_b64}.{_b64url(sig)}"

    # Dev token keeps tests simple and works offline
    return f"token-{uid}"


def decode_access_token(token: str) -> Dict[str, Any]:
    """
    Accept BOTH:
      - Dev tokens: "token-<id>"  -> resolve id/email/role (best effort)
      - JWT (HS256) if strict mode -> validate HMAC
    Always returns: {"id": int, "email": str, "role": str}
    """
    if not token:
        raise Exception("empty token")

    # --- Dev token: token-<id> ---
    if token.startswith("token-"):
        try:
            uid = int(token.split("-", 1)[1])
        except Exception as e:
            raise Exception("bad dev token") from e

        email = f"user{uid}@local"
        role = "vendor"

        # Enrich from auth’s in-memory store if available
        try:
            from backend.routers.auth import _get_user_by_id  # type: ignore
            u = _get_user_by_id(uid)
            if u:
                email = u.get("email", email)
                role = u.get("role", role)
        except Exception:
            pass

        return {"id": uid, "email": email, "role": role}

    # --- JWT (HS256) ---
    parts = token.split(".")
    if len(parts) != 3:
        raise Exception("bad token format")

    header_b64, payload_b64, sig_b64 = parts
    secret = os.getenv("JWT_SECRET") or "dev-secret"
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected_sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    provided_sig = _b64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, provided_sig):
        raise Exception("bad signature")

    payload = json.loads(_b64url_decode(payload_b64).decode())
    uid = int(payload.get("sub") or payload.get("id") or 0)
    email = payload.get("email", "unknown@example.com")
    role = payload.get("role", "vendor")
    return {"id": uid, "email": email, "role": role}
