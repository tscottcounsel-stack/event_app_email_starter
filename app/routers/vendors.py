from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from backend.deps import get_current_user

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


_VENDORS: dict[int, dict] = {}
_NEXT_ID: int = 1


@router.get("")
def list_vendors(limit: int = Query(100, ge=1, le=1000)):
    return list(_VENDORS.values())[:limit]


@router.post("", status_code=201)
def create_vendor(body: Any = Body(default=None), user=Depends(get_current_user)):
    raw = body if isinstance(body, dict) else {}
    global _NEXT_ID
    vid = _NEXT_ID
    _NEXT_ID += 1
    name = raw.get("name") or raw.get("display_name") or f"vendor-{vid}"
    display_name = raw.get("display_name") or raw.get("name") or f"Vendor {vid}"
    data = {
        "id": vid,
        "name": name,
        "display_name": display_name,
        "email": raw.get("email"),
        **{
            k: v
            for k, v in raw.items()
            if k not in {"id", "name", "display_name", "email"}
        },
    }
    _VENDORS[vid] = data
    return data


@router.get("/{vendor_id}")
def get_vendor(vendor_id: int):
    v = _VENDORS.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v
