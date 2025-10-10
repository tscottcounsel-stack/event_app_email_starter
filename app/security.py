# app/security.py
from __future__ import annotations
import os
from fastapi import Header, HTTPException, status

API_KEY_ENV = "API_KEY"
HEADER_NAME = "x-api-key"

def require_api_key(x_api_key: str | None = Header(default=None, alias=HEADER_NAME)):
    expected = os.getenv(API_KEY_ENV)
    if not expected:  # auth disabled if no key set
        return
    if not x_api_key or x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
