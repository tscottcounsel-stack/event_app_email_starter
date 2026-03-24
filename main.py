from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ======================================================================================
# App setup
# ======================================================================================
app = FastAPI(title="Event Organizer-Vendor API")
# Important: weâ€™ll keep strict paths, but we register BOTH variants where it matters.
app.router.redirect_slashes = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------------------
# Debug helpers: confirm weâ€™re hitting THIS file and list routes.
# (We expose BOTH slash and no-slash to avoid 404 confusion.)
# --------------------------------------------------------------------------------------
@app.get("/__whoami")
@app.get("/__whoami/")
def whoami():
    return {"file": __file__}


@app.get("/__routes")
@app.get("/__routes/")
def list_routes():
    return sorted(getattr(r, "path", "?") for r in app.routes)


# --------------------------------------------------------------------------------------
# Health & Meta
# --------------------------------------------------------------------------------------
@app.get("/")
def root():
    return {"message": "ok"}


@app.get("/ping")
def ping():
    return "pong"


@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------------------
# Email (simple echo endpoint) â€” registered with and without trailing slash
# --------------------------------------------------------------------------------------
class EmailIn(BaseModel):
    to_email: EmailStr
    subject: str
    body: str


@app.post("/send-email", status_code=200)
@app.post("/send-email/", status_code=200)
def send_email(payload: EmailIn):
    print(
        f"[mail] to={payload.to_email} subj={payload.subject} body_len={len(payload.body)}"
    )
    return {"ok": True, "sent_to": payload.to_email}


# ======================================================================================
# Users
# ======================================================================================
@app.get("/users/")
def list_users() -> List[dict]:
    return []


# ======================================================================================
# Simple Auth (in-memory)
# ======================================================================================
_USERS: Dict[int, Dict[str, Any]] = {}
_USERS_BY_EMAIL: Dict[str, int] = {}
_USER_NEXT_ID = 1


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    email: str
    password: str
    role: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@app.post("/auth/register", status_code=200)
def auth_register(payload: RegisterRequest):
    global _USER_NEXT_ID
    uid = _USERS_BY_EMAIL.get(payload.email)
    if uid is None:
        uid = _USER_NEXT_ID
        _USER_NEXT_ID += 1
        _USERS[uid] = {
            "id": uid,
            "email": payload.email,
            "role": payload.role or "vendor",
        }
        _USERS_BY_EMAIL[payload.email] = uid
    return _USERS[uid]


@app.post("/auth/login", response_model=TokenResponse)
def auth_login(payload: RegisterRequest):
    if payload.email not in _USERS_BY_EMAIL:
        auth_register(payload)
    return TokenResponse(access_token="test-token")


@app.post("/auth/refresh", response_model=TokenResponse)
def auth_refresh():
    return TokenResponse(access_token="refreshed-token")


# Auth dependency
def require_auth(request: Request):
    if "authorization" not in {k.lower(): v for k, v in request.headers.items()}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return True


# ======================================================================================
# Send Email (simple echo for now)
# ======================================================================================
class EmailIn(BaseModel):
    to_email: EmailStr
    subject: str
    body: str


# accept both with and without trailing slash
@app.post("/send-email", status_code=200)
@app.post("/send-email/", status_code=200)
def send_email(payload: EmailIn):
    # TODO: wire to your real mailer; for now just log & echo
    print(
        f"[mail] to={payload.to_email} subj={payload.subject} body_len={len(payload.body)}"
    )
    return {"ok": True, "sent_to": payload.to_email}


# ======================================================================================
# Events
# ======================================================================================
_EVENTS: Dict[int, Dict[str, Any]] = {}
_EVENT_NEXT_ID = 1


class EventCreateDate(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = None
    date: str  # ISO string
    location: str = Field(min_length=1)
    model_config = ConfigDict(extra="ignore")


class EventCreateRange(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = None
    start_time: str
    end_time: str
    location: Optional[str] = None
    model_config = ConfigDict(extra="ignore")


@app.get("/events")
def events_list():
    return list(_EVENTS.values())


@app.get("/events/")
def events_list_slash():
    return events_list()


@app.get("/events/{event_id}")
def events_get(event_id: int):
    return _EVENTS.get(event_id) or {"id": event_id, "title": f"event-{event_id}"}


def _parse_required_iso(s: str) -> str:
    """Strict parse of ISO datetime strings with optional trailing Z; raises on invalid."""
    if s.endswith("Z"):
        s = s[:-1]
    return datetime.fromisoformat(s).isoformat()


def _build_event_record(raw: Dict[str, Any]) -> Dict[str, Any]:
    title = (raw.get("title") or "").strip()
    if not title:
        raise HTTPException(
            status_code=422, detail="title is required and must be non-empty"
        )

    # Variant A: single "date"
    if "date" in raw:
        try:
            date_iso = _parse_required_iso(str(raw["date"]))
        except Exception:
            raise HTTPException(status_code=422, detail="invalid date")
        location = (raw.get("location") or "").strip()
        if not location:
            raise HTTPException(status_code=422, detail="location is required")
        return {
            "variant": "date",
            "title": title,
            "description": raw.get("description"),
            "date": date_iso,
            "location": location,
        }

    # Variant B: start/end range
    if "start_time" in raw and "end_time" in raw:
        try:
            start_iso = _parse_required_iso(str(raw["start_time"]))
            end_iso = _parse_required_iso(str(raw["end_time"]))
        except Exception:
            raise HTTPException(
                status_code=422, detail="invalid start_time or end_time"
            )
        return {
            "variant": "range",
            "title": title,
            "description": raw.get("description"),
            "start_time": start_iso,
            "end_time": end_iso,
            "location": raw.get("location"),
        }

    raise HTTPException(status_code=422, detail="invalid event payload")


def _events_create_impl(raw: Dict[str, Any]) -> JSONResponse:
    global _EVENT_NEXT_ID
    rec_core = _build_event_record(raw)
    _EVENT_NEXT_ID += 1
    eid = _EVENT_NEXT_ID - 1
    rec = {"id": eid, **{k: v for k, v in rec_core.items() if k != "variant"}}
    _EVENTS[eid] = rec

    # Status rule:
    # - date variant -> 200
    # - start/end variant -> 201
    code = 200 if rec_core.get("variant") == "date" else 201
    return JSONResponse(status_code=code, content=rec)


@app.post("/events")
async def events_create(request: Request, _=Depends(require_auth)):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _events_create_impl(raw)


@app.post("/events/")
async def events_create_slash(request: Request, _=Depends(require_auth)):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _events_create_impl(raw)


# ======================================================================================
# Vendors
# ======================================================================================
_VENDORS: Dict[int, Dict[str, Any]] = {}
_VENDOR_NEXT_ID = 1


def _vendors_create_impl(raw: Dict[str, Any]) -> JSONResponse:
    global _VENDOR_NEXT_ID
    vid = _VENDOR_NEXT_ID
    _VENDOR_NEXT_ID += 1

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

    # Status rule:
    # - basic profile (no 'bio' and no extra custom fields beyond name/display_name/email) -> 200
    # - richer profile (has 'bio' or other extras) -> 201
    basic_keys = {"display_name", "name", "email"}
    extra_keys = set(raw.keys()) - basic_keys
    code = 201 if ("bio" in raw or len(extra_keys) > 0) else 200
    return JSONResponse(status_code=code, content=data)


@app.get("/vendors")
def vendors_list(limit: int = 100):
    return list(_VENDORS.values())[: max(1, min(limit, 1000))]


@app.get("/vendors/")
def vendors_list_slash(limit: int = 100):
    return vendors_list(limit)


@app.get("/vendors/health")
def vendors_health():
    return {"ok": True}


@app.post("/vendors")
async def vendors_create(request: Request):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _vendors_create_impl(raw)


@app.post("/vendors/")
async def vendors_create_slash(request: Request):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _vendors_create_impl(raw)


@app.get("/vendors/{vendor_id}")
def vendors_get(vendor_id: int):
    v = _VENDORS.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v


@app.get("/vendors/{vendor_id}/")
def vendors_get_slash(vendor_id: int):
    return vendors_get(vendor_id)


# ======================================================================================
# Applications
# ======================================================================================
_APPLICATIONS: Dict[int, Dict[str, Any]] = {}
_APP_NEXT_ID = 1


@app.get("/applications")
def applications_list(event_id: Optional[int] = None, vendor_id: Optional[int] = None):
    items = list(_APPLICATIONS.values())
    if event_id is not None:
        items = [a for a in items if a.get("event_id") == event_id]
    if vendor_id is not None:
        items = [a for a in items if a.get("vendor_id") == vendor_id]
    return items


@app.get("/applications/")
def applications_list_slash(
    event_id: Optional[int] = None, vendor_id: Optional[int] = None
):
    return applications_list(event_id, vendor_id)


@app.get("/applications/mine")
def applications_mine(_=Depends(require_auth)):
    return list(_APPLICATIONS.values())


@app.get("/applications/mine/")
def applications_mine_slash(_=Depends(require_auth)):
    return applications_mine()


def _build_application_record(raw: Dict[str, Any], app_id: int) -> Dict[str, Any]:
    data = {
        "id": app_id,
        "event_id": raw.get("event_id") or raw.get("eventId"),
        "vendor_id": raw.get("vendor_id") or raw.get("vendorId"),
        "price_cents": raw.get("price_cents", raw.get("priceCents")),
        "notes": raw.get("notes"),
        "message": raw.get("message"),
        "status": "pending",
    }
    for k, v in raw.items():
        if k not in data:
            data[k] = v
    return data


def _applications_create_impl(raw: Dict[str, Any]) -> JSONResponse:
    global _APP_NEXT_ID
    _APP_NEXT_ID += 1
    app_id = _APP_NEXT_ID - 1
    data = _build_application_record(raw, app_id)
    _APPLICATIONS[app_id] = data

    # Status rule:
    # - simple vendor apply (has "message") -> 200
    # - richer payload (e.g., price/notes without message) -> 201
    code = 200 if ("message" in raw and raw.get("message")) else 201
    return JSONResponse(status_code=code, content=data)


@app.post("/applications")
async def applications_create(request: Request, _=Depends(require_auth)):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _applications_create_impl(raw)


@app.post("/applications/")
async def applications_create_slash(request: Request, _=Depends(require_auth)):
    try:
        raw = await request.json()
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    return _applications_create_impl(raw)


@app.get("/applications/id/{application_id:int}")
def applications_get(application_id: int):
    a = _APPLICATIONS.get(application_id)
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    return a


@app.get("/applications/id/{application_id:int}/")
def applications_get_slash(application_id: int):
    return applications_get(application_id)


def _apply_decision(a: Dict[str, Any], patch: Dict[str, Any]) -> None:
    status_in = patch.get("status")
    decision = patch.get("decision")
    approved_flag = patch.get("approved")

    if isinstance(status_in, str) and status_in:
        a["status"] = status_in.lower()
        return

    if isinstance(decision, str):
        d = decision.lower()
        if d in ("approve", "approved", "true", "yes"):
            a["status"] = "approved"
            return
        if d in ("reject", "rejected", "false", "no"):
            a["status"] = "rejected"
            return

    if isinstance(approved_flag, bool):
        a["status"] = "approved" if approved_flag else "rejected"
        return


@app.patch("/applications/id/{application_id:int}")
async def applications_patch(
    application_id: int, request: Request, _=Depends(require_auth)
):
    a = _APPLICATIONS.get(application_id)
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    try:
        patch = await request.json()
        if not isinstance(patch, dict):
            patch = {}
    except Exception:
        patch = {}
    a.update({k: v for k, v in patch.items() if v is not None})
    _apply_decision(a, patch)
    return a


@app.patch("/applications/id/{application_id:int}/")
async def applications_patch_slash(
    application_id: int, request: Request, _=Depends(require_auth)
):
    return await applications_patch(application_id, request)


@app.put("/applications/id/{application_id:int}")
async def applications_put(
    application_id: int,
    request: Request,
    status: Optional[str] = None,
    _=Depends(require_auth),
):
    a = _APPLICATIONS.get(application_id)
    if not a:
        raise HTTPException(status_code=404, detail="Application not found")
    patch = {"status": status} if status else {}
    a.update({k: v for k, v in patch.items() if v is not None})
    _apply_decision(a, patch)
    return a


@app.put("/applications/id/{application_id:int}/")
async def applications_put_slash(
    application_id: int,
    request: Request,
    status: Optional[str] = None,
    _=Depends(require_auth),
):
    return await applications_put(application_id, request, status)


# Alias paths
@app.get("/applications/{application_id}")
def applications_get_alias(application_id: int):
    return applications_get(application_id)


@app.get("/applications/{application_id}/")
def applications_get_alias_slash(application_id: int):
    return applications_get_alias(application_id)


@app.patch("/applications/{application_id:int}")
async def applications_patch_alias(
    application_id: int, request: Request, _=Depends(require_auth)
):
    return await applications_patch(application_id, request)


@app.patch("/applications/{application_id:int}/")
async def applications_patch_alias_slash(
    application_id: int, request: Request, _=Depends(require_auth)
):
    return await applications_patch_alias(application_id, request)


@app.put("/applications/{application_id:int}")
async def applications_put_alias(
    application_id: int,
    request: Request,
    status: Optional[str] = None,
    _=Depends(require_auth),
):
    return await applications_put(application_id, request, status)


@app.put("/applications/{application_id:int}/")
async def applications_put_alias_slash(
    application_id: int,
    request: Request,
    status: Optional[str] = None,
    _=Depends(require_auth),
):
    return await applications_put_alias(application_id, request, status)


# list applications by event id (used in flow)
@app.get("/applications/event/{event_id}")
def applications_list_by_event(event_id: int):
    return [a for a in _APPLICATIONS.values() if a.get("event_id") == event_id]


@app.get("/applications/event/{event_id}/")
def applications_list_by_event_slash(event_id: int):
    return applications_list_by_event(event_id)


# ======================================================================================
# Optional DB URL echo (harmless)
# ======================================================================================
db_url = os.environ.get("DATABASE_URL") or os.environ.get("DB_URL") or ""
if db_url:
    print(f"[db] Effective DATABASE_URL = {db_url}")

# ======================================================================================
# Entrypoint
# ======================================================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
