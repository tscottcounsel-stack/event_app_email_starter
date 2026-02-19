# app/routers/vendors.py
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile

from app.store import _APPLICATIONS  # source of truth in current dev store

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


def _extract_vendor_profile_from_app(app: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a vendor profile payload from whatever we have available today.
    - Prefer app["vendor_profile"] or app["vendor"] blobs if they exist
    - Always include email
    """
    email = app.get("vendor_email") or app.get("email") or ""
    vendor_id = app.get("vendor_id")  # may be string/number
    base: Dict[str, Any] = {
        "email": email,
    }
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


def _apply_profile_to_matching_apps(
    *,
    email: Optional[str],
    vendor_id: Optional[str],
    profile: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Update ALL matching applications so organizer view (which reads from _APPLICATIONS)
    immediately reflects the newest vendor profile.
    """
    now = utc_now_iso()
    updated_any = False

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

        # Ensure vendor_email exists (organizer routes are email-based)
        if email and not _norm_email(app.get("vendor_email")):
            app["vendor_email"] = email

        # Ensure vendor_id exists if we have it
        if vendor_id and app.get("vendor_id") is None:
            app["vendor_id"] = vendor_id

        app["vendor_profile"] = profile
        app["updated_at"] = now
        updated_any = True

    if not updated_any:
        # No applications exist yet for this vendor; return profile anyway.
        # Organizer side won't have anything to show until an application exists.
        pass

    # Return a server-ish payload
    out = dict(profile)
    if email and not out.get("email"):
        out["email"] = email
    if vendor_id is not None and "vendor_id" not in out:
        out["vendor_id"] = vendor_id
    out["updated_at"] = now
    return out


@router.get("/by-email/{email}")
def get_vendor_by_email(email: str):
    needle = _norm_email(email)
    if not needle:
        raise HTTPException(status_code=400, detail="Email is required")

    best = _find_latest_app_by_email(needle)
    if not best:
        raise HTTPException(status_code=404, detail="Vendor not found by email")

    return _extract_vendor_profile_from_app(best)


@router.get("/{vendor_id}")
def get_vendor(vendor_id: int):
    """
    Current system has no vendor table.
    For now, resolve vendor_id by scanning applications.vendor_id.
    """
    best = _find_latest_app_by_vendor_id(str(vendor_id))
    if not best:
        raise HTTPException(status_code=404, detail="Vendor not found")

    return _extract_vendor_profile_from_app(best)


# ---------------- NEW: /vendors/me ----------------


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

    best: Optional[Dict[str, Any]] = None
    if email:
        best = _find_latest_app_by_email(email)
    if not best and vid:
        best = _find_latest_app_by_vendor_id(vid)

    if not best:
        # Return a minimal profile instead of 404 so UI can still render setup page.
        return {"email": email or "", "vendor_id": vid}

    return _extract_vendor_profile_from_app(best)


@router.put("/me")
def put_my_vendor_profile(request: Request, body: Dict[str, Any] = Body(default={})):
    ident = _pick_vendor_identity(request)
    email = ident["email"] or _norm_email(
        body.get("email") or body.get("vendor_email") or ""
    )
    vid = ident["vendor_id"] or _safe_str(body.get("vendor_id") or "")

    if not email and not vid:
        raise HTTPException(
            status_code=400, detail="Email is required (x-user-email header preferred)."
        )

    # Accept either { vendor_profile: {...} } or a flat body
    incoming = body.get("vendor_profile")
    profile = incoming if isinstance(incoming, dict) else dict(body)

    # Ensure email is present in the profile blob too
    if email and not _norm_email(profile.get("email")):
        profile["email"] = email

    # Store vendor_id if known
    if vid and not _safe_str(profile.get("vendor_id")):
        profile["vendor_id"] = vid

    saved = _apply_profile_to_matching_apps(
        email=email, vendor_id=vid or None, profile=profile
    )
    return saved


@router.put("/me/logo")
async def put_my_vendor_logo(request: Request, file: UploadFile = File(...)):
    """
    Store logo as a data URL inside vendor_profile so both vendor + organizer views
    can render it without needing a blob store in dev.
    """
    ident = _pick_vendor_identity(request)
    email = ident["email"]
    vid = ident["vendor_id"]

    if not email and not vid:
        raise HTTPException(
            status_code=400,
            detail="Missing vendor identity (x-user-email or x-user-id).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")

    ctype = file.content_type or "application/octet-stream"
    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{ctype};base64,{b64}"

    # Start from latest profile (if any), then set logo
    best: Optional[Dict[str, Any]] = None
    if email:
        best = _find_latest_app_by_email(email)
    if not best and vid:
        best = _find_latest_app_by_vendor_id(vid)

    existing_profile: Dict[str, Any] = {}
    if best:
        existing_profile = _extract_vendor_profile_from_app(best)
        # strip server-injected keys to keep blob clean
        existing_profile.pop("updated_at", None)

    existing_profile["logoDataUrl"] = data_url

    saved = _apply_profile_to_matching_apps(
        email=email, vendor_id=vid or None, profile=existing_profile
    )
    return {"ok": True, "logoDataUrl": data_url, "profile": saved}
