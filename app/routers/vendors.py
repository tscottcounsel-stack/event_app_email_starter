# app/routers/vendors.py
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

# ✅ Give this router a real prefix so no route can ever be ""
router = APIRouter(prefix="/vendors", tags=["Vendors"])

# In-memory store (dev)
_VENDORS: dict[int, dict] = {}
_NEXT_ID: int = 1


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/")
def list_vendors(limit: int = Query(100, ge=1, le=1000)):
    # ✅ "/" not ""
    return list(_VENDORS.values())[:limit]


@router.get("/{vendor_id}")
def get_vendor(vendor_id: int):
    v = _VENDORS.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v


@router.post("/")
def create_vendor(payload: dict):
    global _NEXT_ID
    vendor_id = _NEXT_ID
    _NEXT_ID += 1

    v = {"id": vendor_id, **payload}
    _VENDORS[vendor_id] = v
    return v
