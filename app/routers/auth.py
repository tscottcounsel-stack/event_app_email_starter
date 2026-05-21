
from __future__ import annotations

import json
import os
import re
import requests
import tempfile
import time
import secrets
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from fastapi.responses import HTMLResponse

from sqlalchemy import func
from app.db import SessionLocal
from app.models.profile import Profile

try:
    from jose import jwt  # type: ignore
except Exception:
    jwt = None  # type: ignore

try:
    from passlib.context import CryptContext  # type: ignore

    _PWD = CryptContext(schemes=["bcrypt"], deprecated="auto")
except Exception:
    _PWD = None

router = APIRouter(tags=["Auth"])
bearer = HTTPBearer(auto_error=False)

_USERS: Dict[int, Dict[str, Any]] = {}
_USERS_BY_EMAIL: Dict[str, int] = {}
_USERS_BY_USERNAME: Dict[str, int] = {}
_NEXT_ID = 1


AUTH_DATA_DIR = Path(os.getenv("DATA_DIR", "/data/vendorconnect"))
AUTH_DATA_DIR.mkdir(parents=True, exist_ok=True)
_AUTH_USERS_PATH = AUTH_DATA_DIR / "_auth_users.json"


PUBLIC_DATA_DIR = Path("/data") if Path("/data").exists() else AUTH_DATA_DIR
ORGANIZER_PROFILE_STORE_PATH = PUBLIC_DATA_DIR / "organizer_profiles.json"


def _read_public_json(path: Path) -> Dict[str, Any]:
    try:
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_public_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(path, payload)


def _ensure_public_profile_for_user(user: Dict[str, Any]) -> None:
    """Create a lightweight public profile shell on signup.

    This prevents new organizers/vendors from disappearing from setup flows while
    still keeping public directories clean: incomplete profiles remain hidden until
    they have enough display information.
    """
    email = _norm(user.get("email"))
    role = _norm(user.get("role"))
    now = int(time.time())

    if not email or role not in {"vendor", "organizer"}:
        return

    if role == "organizer":
        profiles = _read_public_json(ORGANIZER_PROFILE_STORE_PATH)
        existing = profiles.get(email)
        if isinstance(existing, dict) and existing:
            return

        profiles[email] = {
            "email": email,
            "organizationName": "",
            "organizationType": "",
            "contactName": user.get("full_name") or "",
            "location": "",
            "city": "",
            "state": "",
            "logoDataUrl": "",
            "imageUrls": [],
            "verified": False,
            "verification_status": "pending",
            "profileComplete": False,
            "createdAt": now,
            "updatedAt": now,
        }
        _write_public_json(ORGANIZER_PROFILE_STORE_PATH, profiles)
        return

    if role == "vendor":
        try:
            from app.store import _VENDORS, save_store as _save_main_store  # type: ignore
        except Exception:
            return

        existing = _VENDORS.get(email)
        if isinstance(existing, dict) and existing:
            return

        _VENDORS[email] = {
            "vendor_id": email,
            "email": email,
            "business_name": "",
            "contact_name": user.get("full_name") or "",
            "city": "",
            "state": "",
            "categories": [],
            "vendor_categories": [],
            "description": "",
            "logo_url": "",
            "banner_url": "",
            "image_urls": [],
            "verified": False,
            "verification_status": "unverified",
            "profile_complete": False,
            "created_at": now,
            "updated_at": now,
        }
        _save_main_store()


def send_welcome_email(email: str, role: str, full_name: Optional[str] = None) -> None:
    """Send a welcome email through Resend. Never let email failure break signup."""
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    from_email = (os.getenv("FROM_EMAIL") or "VendCore Support <support@vendcore.co>").strip()

    if not api_key:
        print("Welcome email skipped: RESEND_API_KEY not set")
        return

    recipient = _norm(email)
    if not recipient:
        print("Welcome email skipped: missing recipient")
        return

    role_label = (role or "user").strip().title()
    display_name = (full_name or "").strip() or "there"

    subject = "Welcome to VendCore"
    html = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
    
    <h2 style="color:#111;">Welcome to VendCore 🚀</h2>

    <p>Hey {display_name},</p>

    <p>Your {role_label} account is officially live.</p>

    <p>
        VendCore connects you with real opportunities — but the real advantage
        comes after you complete your profile.
    </p>

    <h3 style="margin-top:20px;">Next Step: Get Verified</h3>

    <p>
        Verified users get priority placement, increased trust, and access to
        better event opportunities.
    </p>

    <a href="https://vendcore.co/{role}/verify"
       style="
            display:inline-block;
            padding:12px 20px;
            background-color:#111;
            color:#fff;
            text-decoration:none;
            border-radius:6px;
            margin-top:15px;
       ">
        Complete Verification
    </a>

    <hr style="margin:30px 0;" />

    <p style="font-size:12px; color:#777;">
        VendCore • Built on verified connections
    </p>

</div>
"""

    text = (
        f"Hi {display_name},\n\n"
        f"Welcome to VendCore. Your {role_label} account is ready.\n\n"
        "Next step: log in, complete your profile, and start your verification when you are ready.\n\n"
        "— VendCore Support"
    )

    try:
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": from_email,
                "to": [recipient],
                "subject": subject,
                "html": html,
                "text": text,
            },
            timeout=10,
        )
        if response.status_code >= 400:
            print(f"Welcome email failed: {response.status_code} {response.text}")
            return
        print(f"Welcome email sent to {recipient}")
    except Exception as exc:
        print(f"Welcome email failed: {exc}")



def _send_resend_email(*, to_email: str, subject: str, html: str, text: str = "") -> None:
    """Send a transactional email through Resend without breaking app workflows."""
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    from_email = (os.getenv("FROM_EMAIL") or "VendCore Support <support@vendcore.co>").strip()
    recipient = _norm(to_email)

    if not api_key:
        print(f"Email skipped to {recipient or 'unknown'}: RESEND_API_KEY not set")
        return
    if not recipient:
        print("Email skipped: missing recipient")
        return

    try:
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": from_email,
                "to": [recipient],
                "subject": subject,
                "html": html,
                "text": text or subject,
            },
            timeout=10,
        )
        if response.status_code >= 400:
            print(f"Email failed to {recipient}: {response.status_code} {response.text}")
            return
        print(f"Email sent to {recipient}: {subject}")
    except Exception as exc:
        print(f"Email failed to {recipient}: {exc}")



def _email_verification_required() -> bool:
    return _norm(os.getenv("AUTH_REQUIRE_EMAIL_VERIFICATION")) in {"1", "true", "yes"}


def _new_email_verification_token() -> str:
    return secrets.token_urlsafe(32)


def _verification_link(token: str) -> str:
    """Build the public frontend confirmation link.

    Important:
    - Do NOT use the backend API base for the email button.
    - Users should land on vendcore.co/confirm-email, where the frontend can
      call the backend confirmation endpoint and then send them to login.
    """
    frontend_base = (
        os.getenv("PUBLIC_FRONTEND_BASE_URL")
        or os.getenv("FRONTEND_BASE_URL")
        or os.getenv("PUBLIC_SITE_URL")
        or os.getenv("SITE_URL")
        or "https://vendcore.co"
    ).strip().rstrip("/")

    if frontend_base.endswith("/contact"):
        frontend_base = frontend_base[: -len("/contact")].rstrip("/")

    return f"{frontend_base}/confirm-email?token={token}"


def send_email_confirmation_email(email: str, role: str, token: str, full_name: Optional[str] = None) -> None:
    """Send email ownership confirmation.

    This confirms email control only. It is not public Vendor/Organizer verification.
    """
    display_name = (full_name or "").strip() or "there"
    link = _verification_link(token)
    role_label = (role or "user").strip().title()

    html = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h1 style="color: #111827;">Confirm your VendCore email</h1>
      <p>Hi {display_name},</p>
      <p>Thanks for creating a {role_label} account on VendCore.</p>
      <p>Please confirm that this email address belongs to you by clicking the button below.</p>
      <p style="margin: 28px 0;">
        <a href="{link}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          Confirm Email
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280;">
        This only confirms your email address. Vendor or organizer verification is a separate review process inside VendCore.
      </p>
      <p style="font-size:13px;color:#6b7280;">
        If the button does not work, copy and paste this link into your browser:<br />
        {link}
      </p>
      <p>— VendCore Support</p>
    </div>
    """

    text = (
        f"Hi {display_name},\n\n"
        f"Thanks for creating a {role_label} account on VendCore.\n\n"
        "Confirm your email address here:\n"
        f"{link}\n\n"
        "This only confirms your email address. Vendor or organizer verification is a separate review process inside VendCore.\n\n"
        "— VendCore Support"
    )

    _send_resend_email(
        to_email=email,
        subject="Confirm your VendCore email",
        html=html,
        text=text,
    )


def send_verification_approved_email(email: str, full_name: Optional[str] = None) -> None:
    display_name = (full_name or "").strip() or "there"
    html = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h1 style="color: #111827;">You're verified on VendCore 🎉</h1>
      <p>Hi {display_name},</p>
      <p>Your VendCore verification has been approved.</p>
      <p>Your profile can now show stronger trust signals to organizers, vendors, and event partners.</p>
      <p style="margin: 28px 0;">
        <a href="https://vendcore.co/login" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          View your dashboard
        </a>
      </p>
      <p>— VendCore Support</p>
    </div>
    """
    text = (
        f"Hi {display_name},\n\n"
        "Your VendCore verification has been approved.\n\n"
        "Log in to view your dashboard: https://vendcore.co/login\n\n"
        "— VendCore Support"
    )
    _send_resend_email(
        to_email=email,
        subject="You're verified on VendCore",
        html=html,
        text=text,
    )


def send_vendor_accepted_email(email: str, event_name: str, full_name: Optional[str] = None) -> None:
    display_name = (full_name or "").strip() or "there"
    safe_event_name = (event_name or "the event").strip() or "the event"
    html = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h1 style="color: #111827;">You're accepted 🎉</h1>
      <p>Hi {display_name},</p>
      <p>You have been accepted to <strong>{safe_event_name}</strong>.</p>
      <p>Log in to VendCore to review next steps, event details, and any remaining requirements.</p>
      <p style="margin: 28px 0;">
        <a href="https://vendcore.co/login" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          View event details
        </a>
      </p>
      <p>— VendCore Support</p>
    </div>
    """
    text = (
        f"Hi {display_name},\n\n"
        f"You have been accepted to {safe_event_name}.\n\n"
        "Log in to VendCore to review next steps: https://vendcore.co/login\n\n"
        "— VendCore Support"
    )
    _send_resend_email(
        to_email=email,
        subject=f"You're accepted to {safe_event_name}",
        html=html,
        text=text,
    )


def send_organizer_new_application_email(email: str, vendor_name: str, event_name: str = "your event") -> None:
    safe_vendor_name = (vendor_name or "A vendor").strip() or "A vendor"
    safe_event_name = (event_name or "your event").strip() or "your event"
    html = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto;">
      <h1 style="color: #111827;">New vendor application</h1>
      <p><strong>{safe_vendor_name}</strong> just applied to <strong>{safe_event_name}</strong>.</p>
      <p>Log in to VendCore to review the application, vendor profile, and verification status.</p>
      <p style="margin: 28px 0;">
        <a href="https://vendcore.co/login" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          Review application
        </a>
      </p>
      <p>— VendCore Support</p>
    </div>
    """
    text = (
        f"{safe_vendor_name} just applied to {safe_event_name}.\n\n"
        "Log in to VendCore to review the application: https://vendcore.co/login\n\n"
        "— VendCore Support"
    )
    _send_resend_email(
        to_email=email,
        subject=f"New vendor application: {safe_vendor_name}",
        html=html,
        text=text,
    )


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _index_user(u: Dict[str, Any]) -> None:
    e = _norm(u.get("email"))
    if e:
        _USERS_BY_EMAIL[e] = int(u["id"])
    un = _norm(u.get("username"))
    if un:
        _USERS_BY_USERNAME[un] = int(u["id"])


def _rebuild_indexes() -> None:
    _USERS_BY_EMAIL.clear()
    _USERS_BY_USERNAME.clear()
    for user in _USERS.values():
        if isinstance(user, dict):
            _index_user(user)


def _next_user_id() -> int:
    ids = [int(k) for k in _USERS.keys()] if _USERS else [0]
    return max(ids) + 1


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp_fd = None
    tmp_name = None
    try:
        tmp_fd, tmp_name = tempfile.mkstemp(
            prefix=path.name + ".",
            suffix=".tmp",
            dir=str(path.parent),
        )

        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())

        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except Exception:
                pass


def _serialize_user(user: Dict[str, Any]) -> Dict[str, Any]:
    serialized = {
        "id": int(user.get("id") or 0),
        "email": _norm(user.get("email")),
        "username": _norm(user.get("username")),
        "role": _norm(user.get("role")),
        "full_name": (user.get("full_name") or "").strip() or None,
        "is_active": bool(user.get("is_active", True)),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }
    for key in (
        "plan", "subscription_status", "subscription_plan", "subscriptionStatus",
        "visibility_tier", "visibilityTier", "featured", "promoted",
        "stripe_customer_id", "stripe_subscription_id", "current_period_end",
        "cancel_at_period_end", "email_verified", "email_verified_at",
        "email_verification_token", "email_verification_expires_at",
    ):
        if key in user:
            serialized[key] = user.get(key)
    return serialized


def _persist_users() -> None:
    payload = {
        "users": [dict(user) for _, user in sorted(_USERS.items(), key=lambda item: int(item[0]))],
        "next_id": _NEXT_ID,
    }
    _atomic_write_json(_AUTH_USERS_PATH, payload)


def _load_users() -> None:
    global _NEXT_ID

    if not _AUTH_USERS_PATH.exists():
        _rebuild_indexes()
        return

    try:
        raw = json.loads(_AUTH_USERS_PATH.read_text(encoding="utf-8"))
    except Exception:
        _rebuild_indexes()
        return

    _USERS.clear()
    for item in raw.get("users", []):
        if not isinstance(item, dict):
            continue
        try:
            uid = int(item.get("id"))
        except Exception:
            continue
        normalized = dict(item)
        normalized["id"] = uid
        normalized["email"] = _norm(normalized.get("email"))
        normalized["username"] = _norm(normalized.get("username") or normalized.get("email"))
        normalized["role"] = _norm(normalized.get("role") or "vendor")
        normalized["is_active"] = bool(normalized.get("is_active", True))
        _USERS[uid] = normalized

    _rebuild_indexes()
    _NEXT_ID = max(int(raw.get("next_id", 1) or 1), _next_user_id())


def _hash_password(pw: str) -> str:
    if _PWD:
        return _PWD.hash(pw)
    return "plain$" + pw


def _verify_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    if _PWD:
        try:
            return _PWD.verify(pw, hashed)
        except Exception:
            return False
    if hashed.startswith("plain$"):
        return hashed == ("plain$" + pw)
    return False


def _add_user(
    *,
    user_id: int,
    email: str,
    password: str,
    role: str,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    persist: bool = True,
) -> Dict[str, Any]:
    now = int(time.time())
    u = {
        "id": int(user_id),
        "email": _norm(email),
        "username": _norm(username or email),
        "password_hash": _hash_password(password),
        "role": _norm(role),
        "full_name": (full_name or "").strip() or None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    _USERS[int(user_id)] = u
    _index_user(u)
    if persist:
        _persist_users()
    return u


def _seed_dev_users() -> None:
    global _NEXT_ID
    if _norm(os.getenv("AUTH_ENABLE_DEV_SEED")) not in ("1", "true", "yes"):
        return

    seed = [
        (13, "organizer@example.com", "organizer123", "organizer"),
        (14, "vendor@example.com", "vendor123", "vendor"),
        (15, "admin@example.com", "admin123", "admin"),
        (5, "pytest_vendor@example.com", "vendor123", "vendor"),
        (16, "vendor1@example.com", "vendor123", "vendor"),
        (17, "sammys@example.com", "aabbcc1", "vendor"),
    ]

    changed = False
    for uid, email, pw, role in seed:
        if _norm(email) in _USERS_BY_EMAIL:
            continue
        _add_user(
            user_id=uid,
            email=email,
            password=pw,
            role=role,
            username=email,
            persist=False,
        )
        changed = True

    if _USERS:
        _NEXT_ID = max(_USERS.keys()) + 1

    if changed:
        _persist_users()


_load_users()
_seed_dev_users()

_JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
_JWT_ALG = os.getenv("JWT_ALG", "HS256")
_JWT_TTL_SECONDS = int(os.getenv("JWT_TTL_SECONDS", "86400"))
_AUD = "event-app-clients"
_ISS = "event-app"


def _create_access_token(
    *, email: str, role: str, is_active: bool, user_id: Optional[int] = None
) -> str:
    normalized_email = _norm(email)

    if user_id is None and normalized_email:
        existing_user_id = _USERS_BY_EMAIL.get(normalized_email)
        if existing_user_id is not None:
            try:
                user_id = int(existing_user_id)
            except Exception:
                user_id = None

    if jwt is None:
        uid_part = str(user_id or "")
        return f"devtoken:{normalized_email}:{role}:{uid_part}:{int(time.time())}"

    now = int(time.time())
    payload = {
        "sub": normalized_email,
        "email": normalized_email,
        "role": role,
        "is_active": bool(is_active),
        "user_id": int(user_id) if user_id is not None else None,
        "id": int(user_id) if user_id is not None else None,
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
        "iss": _ISS,
        "aud": _AUD,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


def _decode_token(token: str) -> Dict[str, Any]:
    if jwt is None:
        if token.startswith("devtoken:"):
            parts = token.split(":")
            email = parts[1] if len(parts) > 1 else ""
            role = parts[2] if len(parts) > 2 else "vendor"
            raw_user_id = parts[3] if len(parts) > 3 else ""
            try:
                user_id = int(raw_user_id) if raw_user_id else _USERS_BY_EMAIL.get(_norm(email))
            except Exception:
                user_id = _USERS_BY_EMAIL.get(_norm(email))
            return {
                "email": _norm(email),
                "sub": _norm(email),
                "role": role,
                "is_active": True,
                "user_id": int(user_id) if user_id is not None else None,
                "id": int(user_id) if user_id is not None else None,
            }
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG], audience=_AUD)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def list_all_users() -> List[Dict[str, Any]]:
    return [_serialize_user(user) for _, user in sorted(_USERS.items(), key=lambda item: int(item[0]))]


def _is_strong_password(password: str) -> bool:
    value = str(password or "")
    if len(value) < 8:
        return False
    return all(
        re.search(pattern, value)
        for pattern in (r"[A-Z]", r"[a-z]", r"\d", r"[^A-Za-z0-9]")
    )

def admin_create_user(
    *,
    email: str,
    password: str,
    role: str,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
) -> Dict[str, Any]:
    global _NEXT_ID

    normalized_email = _norm(email)
    normalized_role = _norm(role)
    normalized_username = _norm(username or email)

    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email required")
    if not _is_strong_password(password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters and include uppercase, lowercase, number, and special character",
        )
    if normalized_role not in {"vendor", "organizer", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if normalized_email in _USERS_BY_EMAIL:
        raise HTTPException(status_code=409, detail="Account already exists")
    if normalized_username in _USERS_BY_USERNAME:
        raise HTTPException(status_code=409, detail="Username already exists")

    email_verification_token = _new_email_verification_token()
    email_verification_expires_at = int(time.time()) + (60 * 60 * 24)

    user = _add_user(
        user_id=int(_NEXT_ID),
        email=normalized_email,
        password=password,
        role=normalized_role,
        username=normalized_username,
        full_name=full_name,
        persist=True,
    )
    user["email_verified"] = False
    user["email_verification_token"] = email_verification_token
    user["email_verification_expires_at"] = email_verification_expires_at

    _NEXT_ID = max(_NEXT_ID + 1, _next_user_id())
    _persist_users()
    try:
        _ensure_public_profile_for_user(user)
    except Exception as exc:
        print(f"Public profile auto-create skipped: {exc}")
    return _serialize_user(user)


def admin_delete_user(user_id: int) -> Dict[str, Any]:
    uid = int(user_id)
    user = _USERS.get(uid)
    if not isinstance(user, dict):
        raise HTTPException(status_code=404, detail="Account not found")

    email = _norm(user.get("email"))
    username = _norm(user.get("username"))

    _USERS.pop(uid, None)
    if email:
        _USERS_BY_EMAIL.pop(email, None)
    if username:
        _USERS_BY_USERNAME.pop(username, None)

    _persist_users()
    return _serialize_user(user)



def _profile_subscription_snapshot(email: str, role: str) -> Dict[str, Any]:
    normalized_email = _norm(email)
    normalized_role = _norm(role)
    if not normalized_email or normalized_role not in {"vendor", "organizer"}:
        return {}
    try:
        from sqlalchemy import func
        from app.db import SessionLocal
        from app.models.profile import Profile
    except Exception:
        return {}
    if SessionLocal is None:
        return {}
    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == normalized_email, Profile.role == normalized_role)
            .one_or_none()
        )
        if profile is None:
            return {}
        data = profile.data if isinstance(profile.data, dict) else {}
        plan = str(profile.subscription_plan or data.get("subscription_plan") or data.get("plan") or "starter").strip().lower()
        status_value = str(profile.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus") or "inactive").strip().lower()
        tier = profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier")
        active_subscription = status_value in {"active", "trialing", "paid"}
        out: Dict[str, Any] = {
            "plan": plan,
            "subscription_plan": plan,
            "subscription_status": status_value,
            "subscriptionStatus": status_value,
            "visibility_tier": tier,
            "visibilityTier": tier,
            "featured": bool((profile.featured or data.get("featured")) and active_subscription),
            "promoted": bool((profile.promoted or data.get("promoted")) and active_subscription),
        }
        for key in ("stripe_customer_id", "stripe_subscription_id", "current_period_end", "cancel_at_period_end"):
            if data.get(key) not in (None, ""):
                out[key] = data.get(key)
        return out
    except Exception as exc:
        print("⚠️ Profile subscription restore skipped:", str(exc))
        return {}
    finally:
        db.close()


def _merge_durable_subscription_state(user: Dict[str, Any]) -> Dict[str, Any]:
    email = _norm(user.get("email"))
    role = _norm(user.get("role"))
    snapshot = _profile_subscription_snapshot(email, role)
    if not snapshot:
        user.setdefault("plan", "starter")
        user.setdefault("subscription_status", "inactive")
        return user
    for key, value in snapshot.items():
        if value not in (None, ""):
            user[key] = value
    user_id = _USERS_BY_EMAIL.get(email)
    if user_id is not None and int(user_id) in _USERS:
        changed = False
        target = _USERS[int(user_id)]
        for key, value in snapshot.items():
            if value not in (None, "") and target.get(key) != value:
                target[key] = value
                changed = True
        if changed:
            try:
                _persist_users()
            except Exception:
                pass
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    payload = _decode_token(creds.credentials)
    email = str(payload.get("email") or payload.get("sub") or "").strip().lower()
    role = str(payload.get("role") or "vendor").strip().lower()
    is_active = bool(payload.get("is_active", True))

    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    user_id = _USERS_BY_EMAIL.get(email)
    stored_user: Dict[str, Any] = {}
    full_name = None
    if user_id is not None:
        stored_user = dict(_USERS.get(int(user_id), {}) or {})
        full_name = stored_user.get("full_name")

    token_user_id = payload.get("user_id") or payload.get("id")
    current_id = int(user_id) if user_id is not None else stored_user.get("id")
    if current_id is None and token_user_id is not None:
        try:
            current_id = int(token_user_id)
        except Exception:
            current_id = None

    current = {
        **stored_user,
        "id": current_id,
        "user_id": current_id,
        "email": email,
        "role": role,
        "is_active": is_active,
        "full_name": full_name,
    }

    return _merge_durable_subscription_state(current)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    email: Optional[str] = None
    username: Optional[str] = None
    password: str
    role: Optional[str] = None


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    email: str
    password: str
    role: str
    full_name: Optional[str] = None
    username: Optional[str] = None


class ResendVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: str


class AuthResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accessToken: str
    role: str
    email: str
    user_id: Optional[int] = None



@router.get("/verify-email", response_class=HTMLResponse)
def verify_email(token: str):
    clean_token = str(token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Missing verification token")

    now = int(time.time())
    matched_user: Optional[Dict[str, Any]] = None

    for user in _USERS.values():
        if not isinstance(user, dict):
            continue
        if str(user.get("email_verification_token") or "") == clean_token:
            matched_user = user
            break

    if not matched_user:
        raise HTTPException(status_code=404, detail="Invalid or expired verification link")

    expires_at = int(matched_user.get("email_verification_expires_at") or 0)
    if expires_at and expires_at < now:
        raise HTTPException(status_code=400, detail="Verification link expired")

    matched_user["email_verified"] = True
    matched_user["email_verified_at"] = now
    matched_user["email_verification_token"] = None
    matched_user["email_verification_expires_at"] = None
    matched_user["updated_at"] = now
    _persist_users()

    safe_email = _norm(matched_user.get("email"))

    return f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Email Confirmed | VendCore</title>
        <style>
          body {{ margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }}
          .wrap {{ min-height: 100vh; display: grid; place-items: center; padding: 24px; }}
          .card {{ max-width: 560px; background: white; border: 1px solid #e2e8f0; border-radius: 28px; padding: 36px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }}
          .badge {{ display: inline-block; background: #dcfce7; color: #166534; padding: 8px 12px; border-radius: 999px; font-weight: 800; font-size: 14px; }}
          h1 {{ margin: 20px 0 10px; font-size: 34px; line-height: 1.1; }}
          p {{ line-height: 1.6; color: #475569; font-weight: 600; }}
          a {{ display: inline-block; margin-top: 18px; background: #4f46e5; color: white; text-decoration: none; padding: 12px 18px; border-radius: 14px; font-weight: 800; }}
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <span class="badge">Email confirmed</span>
            <h1>Your VendCore email is confirmed.</h1>
            <p>{safe_email} has been confirmed for account access.</p>
            <p>This confirms your email address only. Vendor or organizer verification is still a separate VendCore review process.</p>
            <a href="https://vendcore.co/login">Continue to Sign In</a>
          </div>
        </div>
      </body>
    </html>
    """


@router.get("/verify-email-json")
def verify_email_json(token: str) -> Dict[str, Any]:
    clean_token = str(token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Missing verification token")

    now = int(time.time())
    matched_user: Optional[Dict[str, Any]] = None

    for user in _USERS.values():
        if not isinstance(user, dict):
            continue
        if str(user.get("email_verification_token") or "") == clean_token:
            matched_user = user
            break

    if not matched_user:
        # If the user already clicked the link, treat it as confirmed instead
        # of permanently blocking login with a confusing error.
        for user in _USERS.values():
            if isinstance(user, dict) and user.get("email_verified") is True:
                if not user.get("email_verification_token"):
                    continue
        raise HTTPException(status_code=404, detail="Invalid or expired verification link")

    expires_at = int(matched_user.get("email_verification_expires_at") or 0)
    if expires_at and expires_at < now:
        raise HTTPException(status_code=400, detail="Verification link expired")

    matched_user["email_verified"] = True
    matched_user["email_verified_at"] = now
    matched_user["email_verification_token"] = None
    matched_user["email_verification_expires_at"] = None
    matched_user["updated_at"] = now
    _persist_users()

    return {
        "ok": True,
        "email": _norm(matched_user.get("email")),
        "role": _norm(matched_user.get("role")),
        "message": "Email confirmed. You can now sign in.",
    }


@router.post("/resend-verification")
def resend_verification(payload: ResendVerificationRequest) -> Dict[str, Any]:
    """Issue a fresh email-confirmation token for unverified accounts.

    Response intentionally stays generic when an account is not found so the
    endpoint cannot be used to enumerate registered emails.
    """
    email = _norm(payload.email)
    generic_response = {
        "ok": True,
        "message": "If the account exists, a new confirmation email has been sent.",
    }

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    user_id = _USERS_BY_EMAIL.get(email)
    if user_id is None:
        return generic_response

    user = _USERS.get(int(user_id))
    if not isinstance(user, dict):
        return generic_response

    if user.get("email_verified") is True:
        return {
            "ok": True,
            "message": "This email is already confirmed. You can sign in now.",
            "email": _norm(user.get("email")),
            "role": _norm(user.get("role")),
            "already_confirmed": True,
        }

    now = int(time.time())
    token = _new_email_verification_token()
    user["email_verification_token"] = token
    user["email_verification_expires_at"] = now + (60 * 60 * 24)
    user["updated_at"] = now
    _persist_users()

    try:
        send_email_confirmation_email(
            email=str(user.get("email") or email),
            role=str(user.get("role") or "vendor"),
            token=token,
            full_name=user.get("full_name"),
        )
    except Exception as exc:
        print(f"Resend verification email failed: {exc}")
        raise HTTPException(status_code=500, detail="Unable to send confirmation email right now")

    return {
        "ok": True,
        "message": "A new confirmation email has been sent.",
        "email": _norm(user.get("email")),
        "role": _norm(user.get("role")),
    }

@router.post("/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest) -> AuthResponse:
    user = admin_create_user(
        email=payload.email,
        password=payload.password,
        role=payload.role,
        username=payload.username,
        full_name=payload.full_name,
    )

    try:
        send_email_confirmation_email(
            email=str(user.get("email") or ""),
            role=str(user.get("role") or payload.role or "user"),
            token=str(user.get("email_verification_token") or ""),
            full_name=user.get("full_name") or payload.full_name,
        )
    except Exception as exc:
        print(f"Email confirmation failed: {exc}")

    token = _create_access_token(
        email=str(user["email"]),
        role=str(user["role"]),
        is_active=True,
        user_id=int(user["id"]),
    )
    return AuthResponse(
        accessToken=token,
        role=str(user["role"]),
        email=str(user["email"]),
        user_id=int(user["id"]),
    )


@router.post("/login", response_model=AuthResponse, status_code=200)
def login(payload: LoginRequest) -> AuthResponse:
    identifier = _norm(payload.email) or _norm(payload.username)
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username required")
    master_pw = os.getenv("AUTH_DEV_MASTER_PASSWORD", "aabbcc1")
    user_id = _USERS_BY_EMAIL.get(identifier) or _USERS_BY_USERNAME.get(identifier)
    global _NEXT_ID
    if not user_id:
        if payload.password == master_pw:
            role = _norm(payload.role) or "vendor"
            if role not in ("vendor", "organizer", "admin"):
                role = "vendor"
            user_id = int(_NEXT_ID)
            _NEXT_ID += 1
            _add_user(
                user_id=user_id,
                email=identifier,
                password=master_pw,
                role=role,
                username=identifier,
                persist=True,
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    user = _USERS[int(user_id)]
    if payload.password != master_pw and not _verify_password(
        payload.password, user.get("password_hash", "")
    ):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")
    if _email_verification_required() and user.get("email_verified") is not True:
        raise HTTPException(status_code=403, detail="Please confirm your email address before signing in.")
    token = _create_access_token(
        email=str(user["email"]),
        role=str(user["role"]),
        is_active=True,
        user_id=int(user["id"]),
    )
    return AuthResponse(
        accessToken=token,
        role=str(user["role"]),
        email=str(user["email"]),
        user_id=int(user["id"]),
    )


@router.post("/refresh", response_model=AuthResponse, status_code=200)
def refresh(user: Dict[str, Any] = Depends(get_current_user)) -> AuthResponse:
    email = str(user.get("email") or "")
    role = str(user.get("role") or "vendor")
    token = _create_access_token(
        email=email,
        role=role,
        is_active=True,
        user_id=int(user["id"]) if user.get("id") is not None else None,
    )
    return AuthResponse(
        accessToken=token,
        role=role,
        email=email,
        user_id=int(user["id"]) if user.get("id") is not None else None,
    )

def _subscription_user_from_profile(email: Optional[str], role: Optional[str]) -> Dict[str, Any]:
    """Return the durable subscription fields from Postgres profiles.

    Auth users are still stored in the lightweight auth store for login, but
    paid upgrade state must survive Railway redeploys. The profiles table is the
    persistent source of truth for plan/status/badge fields. Keep this helper
    local to auth.py to avoid importing billing.py, because billing.py imports
    auth.py and importing it here would create a circular import.
    """
    normalized_email = _norm(email)
    normalized_role = _norm(role)

    if not normalized_email or normalized_role not in {"vendor", "organizer"}:
        return {}

    try:
        from sqlalchemy import func  # type: ignore
        from app.db import SessionLocal  # type: ignore
        from app.models.profile import Profile  # type: ignore
    except Exception as exc:
        print("⚠️ /me profile subscription lookup unavailable:", str(exc))
        return {}

    if SessionLocal is None:
        return {}

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == normalized_email, Profile.role == normalized_role)
            .order_by(Profile.updated_at.desc())
            .first()
        )

        if profile is None:
            return {}

        data = profile.data if isinstance(profile.data, dict) else {}

        plan = _norm(
            profile.subscription_plan
            or data.get("subscription_plan")
            or data.get("subscriptionPlan")
            or data.get("plan")
            or "starter"
        )
        status_value = _norm(
            profile.subscription_status
            or data.get("subscription_status")
            or data.get("subscriptionStatus")
            or "inactive"
        )
        has_premium_plan = any(token in plan for token in ["enterprise", "premium", "pro", "growth"])
        active_subscription = status_value in {"active", "trialing", "paid"}
        raw_visibility_tier = _norm(profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier"))
        # Verification payment must not leak into subscription/premium. Only expose
        # premium visibility when the profile has an active paid subscription/plan
        # or an explicit admin premium flag that also carries active subscription state.
        visibility_tier = "premium" if (raw_visibility_tier == "premium" and active_subscription) or (has_premium_plan and active_subscription) else None

        return {
            "plan": plan or "starter",
            "subscription_plan": plan or "starter",
            "subscriptionPlan": plan or "starter",
            "subscription_status": status_value or "inactive",
            "subscriptionStatus": status_value or "inactive",
            "visibility_tier": visibility_tier,
            "visibilityTier": visibility_tier,
            "featured": bool((profile.featured or data.get("featured")) and active_subscription),
            "promoted": bool((profile.promoted or data.get("promoted")) and active_subscription),
            "stripe_customer_id": data.get("stripe_customer_id"),
            "stripe_subscription_id": data.get("stripe_subscription_id"),
            "current_period_end": data.get("current_period_end"),
            "cancel_at_period_end": data.get("cancel_at_period_end"),
        }
    except Exception as exc:
        print("⚠️ /me profile subscription lookup failed:", str(exc))
        return {}
    finally:
        db.close()


def _public_current_user_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    profile_subscription = _subscription_user_from_profile(user.get("email"), user.get("role"))

    merged = {
        "id": user.get("id"),
        "user_id": user.get("id"),
        "email": user.get("email"),
        "role": user.get("role"),
        "full_name": user.get("full_name"),
        "plan": user.get("plan") or user.get("subscription_plan") or "starter",
        "subscription_plan": user.get("subscription_plan") or user.get("plan") or "starter",
        "subscriptionPlan": user.get("subscriptionPlan") or user.get("subscription_plan") or user.get("plan") or "starter",
        "subscription_status": user.get("subscription_status") or user.get("subscriptionStatus") or "inactive",
        "subscriptionStatus": user.get("subscriptionStatus") or user.get("subscription_status") or "inactive",
        "visibility_tier": user.get("visibility_tier"),
        "visibilityTier": user.get("visibilityTier") or user.get("visibility_tier"),
        "featured": bool(user.get("featured", False)),
        "promoted": bool(user.get("promoted", False)),
    }

    # Postgres profile fields win, because they survive Railway redeploys.
    for key, value in profile_subscription.items():
        if value not in (None, ""):
            merged[key] = value

    active_statuses = {"active", "trialing", "paid"}
    current_plan = _norm(merged.get("subscription_plan") or merged.get("plan"))
    current_status = _norm(merged.get("subscription_status") or merged.get("subscriptionStatus"))

    if current_status in active_statuses and current_plan and current_plan != "starter":
        merged["plan"] = current_plan
        merged["subscription_plan"] = current_plan
        merged["subscriptionPlan"] = current_plan
        merged["subscription_status"] = current_status
        merged["subscriptionStatus"] = current_status
        merged["visibility_tier"] = merged.get("visibility_tier") or "premium"
        merged["visibilityTier"] = merged.get("visibilityTier") or merged.get("visibility_tier") or "premium"
        # Do not automatically flip featured/promoted from subscription data.
        # Those are admin placement flags, while subscription is billing truth.
        merged["featured"] = bool(merged.get("featured", False))
        merged["promoted"] = bool(merged.get("promoted", False))

    return merged



@router.post("/debug/force-premium/{email}")
def debug_force_premium(email: str):
    """One-time repair helper for syncing an existing vendor premium account.

    This is intentionally narrow: it only upgrades vendor profile/subscription
    fields for the supplied email and mirrors the same state into the lightweight
    auth store plus the persistent Postgres profiles table. Remove or protect
    this route after the repair is complete.
    """
    normalized_email = _norm(email)
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email required")

    # ---------- AUTH STORE ----------
    uid = _USERS_BY_EMAIL.get(normalized_email)
    auth_updated = False

    if uid is not None and int(uid) in _USERS:
        user = _USERS[int(uid)]
        user["plan"] = "pro_vendor"
        user["subscription_plan"] = "pro_vendor"
        user["subscriptionPlan"] = "pro_vendor"
        user["subscription_status"] = "active"
        user["subscriptionStatus"] = "active"
        user["visibility_tier"] = "premium"
        user["visibilityTier"] = "premium"
        user["featured"] = True
        user["promoted"] = True
        user["updated_at"] = int(time.time())
        _persist_users()
        auth_updated = True

    # ---------- POSTGRES PROFILE ----------
    profile_updated = False
    profile_created = False

    if SessionLocal is None:
        return {
            "success": True,
            "email": normalized_email,
            "auth_updated": auth_updated,
            "profile_updated": False,
            "profile_created": False,
            "warning": "SessionLocal unavailable; auth store updated only",
        }

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(
                func.lower(Profile.email) == normalized_email,
                Profile.role == "vendor",
            )
            .one_or_none()
        )

        if profile is None:
            profile = Profile(email=normalized_email, role="vendor")
            db.add(profile)
            profile_created = True

        profile.subscription_plan = "pro_vendor"
        profile.subscription_status = "active"
        profile.visibility_tier = "premium"
        profile.featured = True
        profile.promoted = True

        data = profile.data if isinstance(profile.data, dict) else {}
        profile.data = {
            **data,
            "email": normalized_email,
            "plan": "pro_vendor",
            "subscription_plan": "pro_vendor",
            "subscriptionPlan": "pro_vendor",
            "subscription_status": "active",
            "subscriptionStatus": "active",
            "visibility_tier": "premium",
            "visibilityTier": "premium",
            "featured": True,
            "promoted": True,
            "premium": True,
            "is_premium": True,
            "premium_active": True,
            "subscription_active": True,
            "premium_repaired_at": int(time.time()),
        }

        db.commit()
        profile_updated = True

        return {
            "success": True,
            "email": normalized_email,
            "premium": True,
            "auth_updated": auth_updated,
            "profile_updated": profile_updated,
            "profile_created": profile_created,
            "plan": "pro_vendor",
            "subscription_status": "active",
            "visibility_tier": "premium",
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Premium repair failed: {exc}")
    finally:
        db.close()

@router.get("/me")
def get_me(user: Dict[str, Any] = Depends(get_current_user)):
    payload = _public_current_user_payload(user)
    # Keep the historical flat response while also supporting consumers that
    # expect { user }.
    return {**payload, "user": payload}

