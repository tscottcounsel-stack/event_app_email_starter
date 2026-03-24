# app/security.py
from __future__ import annotations

import os

from fastapi import Header, HTTPException, status

# Header key to read (case-insensitive). Keep in sync with main.py's RL_HEADER.
API_KEY_HEADER = os.getenv("RATE_LIMIT_HEADER", "x-api-key").lower()
# The expected key value (set in your env or .env for local dev)
EXPECTED_API_KEY = os.getenv("API_KEY", "dev-123")


async def require_api_key(
    x_api_key: str | None = Header(default=None, alias="x-api-key")
):
    """
    Simple header-based API key guard.
    Accepts the key in `x-api-key` (case-insensitive).
    """
    # If caller chose to use a different header name, try that too.
    provided = x_api_key
    if provided is None and API_KEY_HEADER != "x-api-key":
        # FastAPI lower-cases header param names; alias must be static.
        # So we read the env-named header at runtime via request state in main if needed.
        # For simplicity, stick to "x-api-key".
        pass

    if not provided or provided != EXPECTED_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    # success: just return None
