# app/routers/vendors.py
from __future__ import annotations

import base64
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile

# Dev store (current system)
from app.store import _APPLICATIONS, _VENDORS, save_store

router = APIRouter(prefix="/vendors", tags=["Vendors"])


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_email(x: Any) -> str:
    return str(x or "").strip().lower()


def _safe_str(x: Any) -> str:
    return str(x or "").strip()


def _pick_vendor_identity(req: Request) -> Dict[str, Optional[str]]:
    """
    In this dev app, vendor identity is passed via headers.
    - x-user-email is the most reliable (organizer links use email)
    - x-user-id may exist too
    """
    email = _norm_email(req.headers.get("x-user-email"))
    vid = _safe_str(req.headers.get("x-user-id"))
    if not vid:
        vid = None
    return {"email": email or None, "vendor_id": vid}


def _vendor_key(email: Optional[str]) -> str:
    key = _norm_email(email)
    return key


def _extract_vendor_profile_from_app(app: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a vendor profile payload from whatever we have available today.
    - Prefer app["vendor_profile"] or app["vendor"] blobs if they exist
    - Always include email
    """
    email = app.get("vendor_email") or app.get("email") or ""
    vendor_id = app.get("vendor_id")  # may be string/number
    base: Dict[str, Any] = {"email": email}
    if vendor_id is not None:
        base["vendor_id"] = vendor_id

    blob = None
    if isinstance(app.get("vendor_profile"), dict):
        blob = app.get("vendor_profile")
    elif isinstance(app.get("vendor"), dict):
        blob = app.get("vendor")
    elif isinstance(app.get("profile"), dict):
        blob = app.get("profile")

    if isinstance(blob, dict):
        out = {**base, **blob}
        if not out.get("email"):
            out["email"] = email
        return out

    return base


def _find_latest_app_by_email(email: str) -> Optional[Dict[str, Any]]:
    needle = _norm_email(email)
    best: Optional[Dict[str, Any]] = None
    best_ts: str = ""
    for app in _APPLICATIONS.values():
        if _norm_email(app.get("vendor_email")) != needle:
            continue
        ts = str(app.get("updated_at") or app.get("submitted_at") or "")
        if best is None or ts > best_ts:
            best = app
            best_ts = ts
    return best


def _find_latest_app_by_vendor_id(vendor_id: str) -> Optional[Dict[str, Any]]:
    target = _safe_str(vendor_id)
    best: Optional[Dict[str, Any]] = None
    best_ts: str = ""
    for app in _APPLICATIONS.values():
        vid = app.get("vendor_id")
        if vid is None:
            continue
        if str(vid) != target:
            continue
        ts = str(app.get("updated_at") or app.get("submitted_at") or "")
        if best is None or ts > best_ts:
            best = app
            best_ts = ts
    return best


def _mirror_profile_into_matching_apps(
    *, email: Optional[str], vendor_id: Optional[str], profile: Dict[str, Any]
) -> None:
    """
    Keep legacy organizer screens (that read from _APPLICATIONS) in sync.
    This does NOT make _APPLICATIONS the source of truth anymore.
    """
    now = utc_now_iso()

    for app in _APPLICATIONS.values():
        email_match = bool(email) and _norm_email(
            app.get("vendor_email")
        ) == _norm_email(email)
        vid_match = (
            bool(vendor_id)
            and app.get("vendor_id") is not None
            and str(app.get("vendor_id")) == str(vendor_id)
        )
        if not (email_match or vid_match):
            continue

        if email and not _norm_email(app.get("vendor_email")):
            app["vendor_email"] = email

        if vendor_id and app.get("vendor_id") is None:
            app["vendor_id"] = vendor_id

        app["vendor_profile"] = profile
        app["updated_at"] = now


def _save_vendor_profile(
    email: str, vendor_id: Optional[str], profile: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Save to _VENDORS as source of truth, and mirror to apps for legacy views.
    """
    now = utc_now_iso()
    key = _vendor_key(email)

    profile = dict(profile or {})
    profile["email"] = email
    if vendor_id:
        profile.setdefault("vendor_id", vendor_id)

    profile["updatedAt"] = now

    _VENDORS[key] = profile
    save_store()

    _mirror_profile_into_matching_apps(
        email=email, vendor_id=vendor_id, profile=profile
    )
    return profile


def _uploads_dir() -> str:
    base_dir = os.path.dirname(os.path.abspath(__file__))  # .../app/routers
    app_dir = os.path.abspath(os.path.join(base_dir, ".."))  # .../app
    root_dir = os.path.abspath(os.path.join(app_dir, ".."))  # project root
    return os.path.join(root_dir, "uploads")


def _safe_ext(filename: str) -> str:
    name = (filename or "").strip()
    _, ext = os.path.splitext(name)
    ext = ext.lower()
    if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
        return ext
    return ".jpg"


# ----------------------------
# Public / Organizer lookups
# ----------------------------


@router.get("/by-email/{email}")
def get_vendor_by_email(email: str):
    key = _vendor_key(email)
    v = _VENDORS.get(key)
    return v or {}


# ----------------------------
# ✅ IMPORTANT: /vendors/me MUST be defined BEFORE /vendors/{vendor_id}
# ----------------------------


@router.get("/me")
def get_my_vendor_profile(request: Request):
    ident = _pick_vendor_identity(request)
    email = ident["email"]
    vid = ident["vendor_id"]

    if not email and not vid:
        raise HTTPException(
            status_code=400,
            detail="Missing vendor identity (x-user-email or x-user-id).",
        )

    # Source of truth: _VENDORS by email
    if email:
        v = _VENDORS.get(_vendor_key(email))
        if v:
            return v

    # Fallback: derive from apps
    best: Optional[Dict[str, Any]] = None
    if email:
        best = _find_latest_app_by_email(email)
    if not best and vid:
        best = _find_latest_app_by_vendor_id(vid)

    if not best:
        return {"email": email or "", "vendor_id": vid}

    return _extract_vendor_profile_from_app(best)


@router.put("/me")
def put_my_vendor_profile(request: Request, body: Dict[str, Any] = Body(default={})):
    ident = _pick_vendor_identity(request)

    email = ident["email"] or _norm_email(
        body.get("email") or body.get("vendor_email") or ""
    )
    vid = ident["vendor_id"] or _safe_str(body.get("vendor_id") or "")

    if not email:
        raise HTTPException(
            status_code=400, detail="Email is required (x-user-email header preferred)."
        )

    incoming = body.get("vendor_profile")
    profile = incoming if isinstance(incoming, dict) else dict(body)

    profile["email"] = email
    if vid:
        profile.setdefault("vendor_id", vid)

    saved = _save_vendor_profile(email=email, vendor_id=vid or None, profile=profile)
    return saved


@router.put("/me/logo")
async def put_my_vendor_logo(request: Request, file: UploadFile = File(...)):
    """
    Save logo to disk under /uploads and store logoUrl in _VENDORS.
    Also stores logoDataUrl as a fallback (optional but helpful in dev).
    """
    ident = _pick_vendor_identity(request)
    email = ident["email"]
    vid = ident["vendor_id"]

    if not email and not vid:
        raise HTTPException(
            status_code=400,
            detail="Missing vendor identity (x-user-email or x-user-id).",
        )

    if not email:
        raise HTTPException(
            status_code=400, detail="x-user-email header is required for logo upload."
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")

    up_dir = _uploads_dir()
    os.makedirs(up_dir, exist_ok=True)

    ext = _safe_ext(file.filename or "")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    safe_email = email.replace("@", "_at_").replace(".", "_")
    fname = f"vendor_{safe_email}_logo_{ts}{ext}"
    fpath = os.path.join(up_dir, fname)

    with open(fpath, "wb") as f:
        f.write(content)

    logo_url = f"/uploads/{fname}"

    ctype = file.content_type or "application/octet-stream"
    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{ctype};base64,{b64}"

    current = _VENDORS.get(_vendor_key(email)) or {"email": email}
    if vid:
        current.setdefault("vendor_id", vid)

    current["logoUrl"] = logo_url
    current["logoDataUrl"] = data_url
    saved = _save_vendor_profile(email=email, vendor_id=vid or None, profile=current)

    return {"ok": True, "logoUrl": logo_url, "profile": saved}


# ----------------------------
# Vendor ID lookup (must be LAST)
# ----------------------------


@router.get("/{vendor_id}")
def get_vendor(vendor_id: int):
    """
    Current system has no vendor table.
    For now, resolve vendor_id by scanning applications.vendor_id.
    """
    best = _find_latest_app_by_vendor_id(str(vendor_id))
    if not best:
        raise HTTPException(status_code=404, detail="Vendor not found")

    email = _norm_email(best.get("vendor_email"))
    if email:
        v = _VENDORS.get(_vendor_key(email))
        if v:
            return v

    return _extract_vendor_profile_from_app(best)
