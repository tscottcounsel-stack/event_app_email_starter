# app/routers/applications.py
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.store import _APPLICATIONS, _EVENTS, next_application_id, save_store

router = APIRouter(tags=["Applications"])


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _canon_str(v: Optional[Any]) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _canon_email(v: Optional[Any]) -> Optional[str]:
    s = _canon_str(v)
    return s.lower() if s else None


# ---------------- Identity extraction ----------------


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _decode_jwt_payload(token: str) -> Dict[str, Any]:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
        return payload
    except Exception:
        return {}


def extract_identity(req: Request) -> Dict[str, Optional[str]]:
    email = req.headers.get("x-user-email")
    user_id = req.headers.get("x-user-id")

    if email or user_id:
        return {
            "vendor_email": _canon_email(email),
            "vendor_id": _canon_str(user_id),
        }

    auth = req.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1]
        payload = _decode_jwt_payload(token)
        return {
            "vendor_email": _canon_email(payload.get("email")),
            "vendor_id": _canon_str(payload.get("sub")),
        }

    return {"vendor_email": None, "vendor_id": None}


def _vendor_matches(
    app: Dict[str, Any], vendor_id: Optional[str], vendor_email: Optional[str]
) -> bool:
    if vendor_id and _canon_str(app.get("vendor_id")) == vendor_id:
        return True
    if vendor_email and _canon_email(app.get("vendor_email")) == vendor_email:
        return True
    return False


# -------------------------------------------------------------------
# Models
# -------------------------------------------------------------------


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    notes: Optional[str] = None
    boothId: Optional[str] = None
    booth_id: Optional[str] = None
    appId: Optional[str] = None
    app_id: Optional[str] = None
    checked: Optional[Dict[str, bool]] = None


# -------------------------------------------------------------------
# Submit (IDEMPOTENT UPSERT)
# -------------------------------------------------------------------


@router.post("/applications/events/{event_id}/apply")
def submit_application(
    event_id: int,
    request: Request,
    payload: ApplicationCreate = Body(...),
):
    print("HIT submit_application (clean idempotent version)")

    get_event_or_404(event_id)

    ident = extract_identity(request)
    vendor_id = ident["vendor_id"]
    vendor_email = ident["vendor_email"]

    booth_id = _canon_str(payload.booth_id or payload.boothId)
    app_ref = _canon_str(payload.app_id or payload.appId)

    now = utc_now_iso()

    # ----------- UPSERT LOGIC -----------
    for existing in _APPLICATIONS.values():
        if int(existing.get("event_id")) != int(event_id):
            continue

        if booth_id and _canon_str(existing.get("booth_id")) != booth_id:
            continue

        if not _vendor_matches(existing, vendor_id, vendor_email):
            continue

        # UPDATE existing instead of duplicate error
        existing["notes"] = payload.notes or existing.get("notes", "")
        existing["checked"] = payload.checked or existing.get("checked", {})
        existing["status"] = "submitted"
        existing["updated_at"] = now
        existing["vendor_email"] = vendor_email
        existing["vendor_id"] = vendor_id
        existing["app_ref"] = app_ref

        save_store()
        return {"ok": True, "application": existing, "upserted": True}

    # ----------- CREATE NEW -----------
    app_id = next_application_id()

    app = {
        "id": app_id,
        "event_id": int(event_id),
        "booth_id": booth_id,
        "app_ref": app_ref,
        "notes": payload.notes or "",
        "checked": payload.checked or {},
        "status": "submitted",
        "submitted_at": now,
        "updated_at": now,
        "vendor_email": vendor_email,
        "vendor_id": vendor_id,
    }

    _APPLICATIONS[app_id] = app
    save_store()

    return {"ok": True, "application": app, "upserted": False}


# -------------------------------------------------------------------
# Organizer list
# -------------------------------------------------------------------


@router.get("/organizer/events/{event_id}/applications")
def list_event_applications(event_id: int):
    get_event_or_404(event_id)

    apps = [
        a for a in _APPLICATIONS.values() if int(a.get("event_id")) == int(event_id)
    ]

    apps.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)
    return {"event_id": event_id, "applications": apps}


# -------------------------------------------------------------------
# Vendor list
# -------------------------------------------------------------------


@router.get("/vendor/applications")
def list_vendor_applications(request: Request):
    ident = extract_identity(request)
    vendor_id = ident["vendor_id"]
    vendor_email = ident["vendor_email"]

    if not vendor_id and not vendor_email:
        return {"applications": []}

    apps = [
        a for a in _APPLICATIONS.values() if _vendor_matches(a, vendor_id, vendor_email)
    ]

    apps.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)
    return {"applications": apps}


# -------------------------------------------------------------------
# Organizer update status
# -------------------------------------------------------------------


@router.post("/organizer/applications/{application_id}/status")
def update_application_status(application_id: int, payload: Dict[str, Any] = Body(...)):
    app = _APPLICATIONS.get(application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    status = payload.get("status")
    if status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid status")

    app["status"] = status
    app["updated_at"] = utc_now_iso()
    save_store()

    return {"ok": True, "application": app}
