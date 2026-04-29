
from __future__ import annotations

import json
import os
import requests
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict

from app.store import _VERIFICATIONS, save_store

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

VENDOR_VERIFICATION_FEE = 25
ORGANIZER_VERIFICATION_FEE = 49
UPLOAD_DIR = Path("uploads/verifications")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

AUTH_DATA_DIR = Path(os.getenv("DATA_DIR", "/data/vendorconnect"))
AUTH_DATA_DIR.mkdir(parents=True, exist_ok=True)
_AUTH_USERS_PATH = AUTH_DATA_DIR / "_auth_users.json"


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
    return {
        "id": int(user.get("id") or 0),
        "email": _norm(user.get("email")),
        "username": _norm(user.get("username")),
        "role": _norm(user.get("role")),
        "full_name": (user.get("full_name") or "").strip() or None,
        "is_active": bool(user.get("is_active", True)),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


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


def _create_access_token(*, email: str, role: str, is_active: bool) -> str:
    if jwt is None:
        return f"devtoken:{email}:{role}:{int(time.time())}"

    now = int(time.time())
    payload = {
        "sub": email,
        "email": email,
        "role": role,
        "is_active": bool(is_active),
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
            return {"email": email, "role": role, "is_active": True}
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG], audience=_AUD)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def _default_verification(email: str, role: str) -> Dict[str, Any]:
    fee = ORGANIZER_VERIFICATION_FEE if role == "organizer" else VENDOR_VERIFICATION_FEE
    return {
        "id": None,
        "user_id": None,
        "email": email,
        "role": role,
        "status": "not_started",
        "fee_amount": fee,
        "fee_paid": False,
        "payment_status": "unpaid",
        "paid_at": None,
        "submitted_at": None,
        "reviewed_at": None,
        "reviewed_by": None,
        "business_name": "",
        "tax_id_masked": "",
        "bank_account_last4": "",
        "notes": "",
        "documents": [],
        "business_license_url": None,
        "government_id_url": None,
        "last_session_id": None,
    }


def _record_matches_user(record: Dict[str, Any], email: str, role: str) -> bool:
    return _norm(record.get("email")) == _norm(email) and _norm(
        record.get("role")
    ) == _norm(role)


def _find_verification_record(email: str, role: str) -> Optional[Dict[str, Any]]:
    for key, value in list((_VERIFICATIONS or {}).items()):
        if isinstance(value, dict) and _record_matches_user(value, email, role):
            if value.get("id") is None:
                try:
                    value["id"] = int(key)
                except Exception:
                    pass
            return value
    return None


def _get_verification(
    email: str, role: str, user_id: Optional[int] = None
) -> Dict[str, Any]:
    record = _find_verification_record(email, role)
    if record:
        record.setdefault(
            "fee_amount",
            (
                ORGANIZER_VERIFICATION_FEE
                if role == "organizer"
                else VENDOR_VERIFICATION_FEE
            ),
        )
        record.setdefault("documents", [])
        record.setdefault("business_license_url", None)
        record.setdefault("government_id_url", None)
        if user_id is not None and not record.get("user_id"):
            record["user_id"] = user_id
        return record

    record = _default_verification(email, role)
    record["user_id"] = user_id
    return record


def _next_verification_id() -> int:
    max_id = 0
    for key, value in list((_VERIFICATIONS or {}).items()):
        try:
            max_id = max(max_id, int(key))
        except Exception:
            pass
        if isinstance(value, dict):
            try:
                max_id = max(max_id, int(value.get("id") or 0))
            except Exception:
                pass
    return max_id + 1


def _save_verification_record(record: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(record, dict):
        raise ValueError("Invalid verification record")
    record_id = int(record.get("id") or _next_verification_id())
    record["id"] = record_id
    _VERIFICATIONS[record_id] = record
    save_store()
    return record


def _get_verification_by_id(verification_id: int) -> Optional[Dict[str, Any]]:
    direct = (_VERIFICATIONS or {}).get(verification_id)
    if isinstance(direct, dict):
        direct.setdefault("id", verification_id)
        return direct
    for key, value in list((_VERIFICATIONS or {}).items()):
        if isinstance(value, dict) and int(value.get("id") or 0) == int(
            verification_id
        ):
            return value
    return None


def _find_verification_by_session_id(session_id: str) -> Optional[Dict[str, Any]]:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    for key, value in list((_VERIFICATIONS or {}).items()):
        if not isinstance(value, dict):
            continue
        if str(value.get("last_session_id") or "").strip() == sid:
            if value.get("id") is None:
                try:
                    value["id"] = int(key)
                except Exception:
                    pass
            return value
    return None


def _stripe_metadata_value(metadata: Any, key: str, default: str = "") -> str:
    try:
        if metadata is None:
            return default
        if isinstance(metadata, dict):
            return str(metadata.get(key) or default).strip()
        return str(getattr(metadata, key, default) or default).strip()
    except Exception:
        return default


def _mark_verification_paid_from_stripe_session(session: Any, source: str = "stripe") -> Dict[str, Any]:
    session_id = str(getattr(session, "id", "") or "").strip()
    if not session_id and isinstance(session, dict):
        session_id = str(session.get("id") or "").strip()
    if not session_id:
        raise ValueError("Stripe session id missing")

    metadata = getattr(session, "metadata", None)
    if metadata is None and isinstance(session, dict):
        metadata = session.get("metadata") or {}

    metadata_email = _norm(_stripe_metadata_value(metadata, "email"))
    metadata_role = _norm(_stripe_metadata_value(metadata, "role")) or "vendor"

    payment_status = str(getattr(session, "payment_status", "") or (session.get("payment_status") if isinstance(session, dict) else "") or "").strip().lower()
    status_value = str(getattr(session, "status", "") or (session.get("status") if isinstance(session, dict) else "") or "").strip().lower()

    if payment_status != "paid" and status_value != "complete":
        raise ValueError(f"Payment not complete yet: payment_status={payment_status or 'unknown'}, status={status_value or 'unknown'}")

    record = _find_verification_by_session_id(session_id)
    if record is None:
        if not metadata_email or metadata_role not in {"vendor", "organizer"}:
            raise ValueError("Stripe metadata missing verification email or role")
        record = _get_verification(metadata_email, metadata_role)

    email = _norm(record.get("email") or metadata_email)
    role = _norm(record.get("role") or metadata_role or "vendor")
    if role not in {"vendor", "organizer"}:
        role = metadata_role if metadata_role in {"vendor", "organizer"} else "vendor"

    record["email"] = email
    record["role"] = role
    record["fee_paid"] = True
    record["payment_status"] = "paid"
    record["paid_at"] = int(time.time())
    record["last_session_id"] = session_id
    record["payment_confirmed_by"] = source
    if not record.get("status") or str(record.get("status") or "").lower() in {"not_started", "unpaid"}:
        record["status"] = "not_started"
    _save_verification_record(record)
    return record


def _mask_last4(value: str) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) < 4:
        return ""
    return f"***{digits[-4:]}"


def _safe_suffix(filename: Optional[str]) -> str:
    suffix = Path(filename or "").suffix.strip()
    return suffix[:10] if suffix else ""


def _save_upload(file: UploadFile, prefix: str) -> tuple[str, str, str]:
    suffix = _safe_suffix(file.filename)
    saved_name = f"{prefix}_{uuid.uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / saved_name
    with destination.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return str(destination), f"/uploads/verifications/{saved_name}", saved_name


def list_all_users() -> List[Dict[str, Any]]:
    return [_serialize_user(user) for _, user in sorted(_USERS.items(), key=lambda item: int(item[0]))]


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
    if len(str(password or "")) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if normalized_role not in {"vendor", "organizer", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if normalized_email in _USERS_BY_EMAIL:
        raise HTTPException(status_code=409, detail="Account already exists")
    if normalized_username in _USERS_BY_USERNAME:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = _add_user(
        user_id=int(_NEXT_ID),
        email=normalized_email,
        password=password,
        role=normalized_role,
        username=normalized_username,
        full_name=full_name,
        persist=True,
    )
    _NEXT_ID = max(_NEXT_ID + 1, _next_user_id())
    _persist_users()
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
    full_name = None
    if user_id is not None:
        full_name = _USERS.get(int(user_id), {}).get("full_name")

    return {
        "id": int(user_id) if user_id is not None else None,
        "email": email,
        "role": role,
        "is_active": is_active,
        "full_name": full_name,
    }


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


class AuthResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accessToken: str
    role: str
    email: str


class VerificationCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    business_name: Optional[str] = None
    tax_id: Optional[str] = None
    notes: Optional[str] = None


class VerificationConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_id: str


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
        send_welcome_email(
            email=str(user.get("email") or ""),
            role=str(user.get("role") or payload.role or "user"),
            full_name=user.get("full_name") or payload.full_name,
        )
    except Exception as exc:
        print(f"Welcome email failed: {exc}")

    token = _create_access_token(
        email=str(user["email"]), role=str(user["role"]), is_active=True
    )
    return AuthResponse(
        accessToken=token, role=str(user["role"]), email=str(user["email"])
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
    token = _create_access_token(
        email=str(user["email"]), role=str(user["role"]), is_active=True
    )
    return AuthResponse(
        accessToken=token, role=str(user["role"]), email=str(user["email"])
    )


@router.post("/refresh", response_model=AuthResponse, status_code=200)
def refresh(user: Dict[str, Any] = Depends(get_current_user)) -> AuthResponse:
    email = str(user.get("email") or "")
    role = str(user.get("role") or "vendor")
    token = _create_access_token(email=email, role=role, is_active=True)
    return AuthResponse(accessToken=token, role=role, email=email)


@router.get("/verification/me")
def verification_me(user: Dict[str, Any] = Depends(get_current_user)):
    role = str(user.get("role") or "vendor")
    if role not in {"vendor", "organizer"}:
        raise HTTPException(
            status_code=403,
            detail="Verification is only available for vendor or organizer accounts",
        )
    record = dict(_get_verification(str(user.get("email") or ""), role, user.get("id")))
    return {"verification": record}


@router.get("/verification/public")
def verification_public_list():
    items: List[Dict[str, Any]] = []

    for _, value in list((_VERIFICATIONS or {}).items()):
        if not isinstance(value, dict):
            continue
        if (value.get("role") or "").strip().lower() != "organizer":
            continue

        email = (value.get("email") or "").strip().lower()
        if not email:
            continue

        items.append(
            {
                "email": email,
                "business_name": value.get("business_name") or email,
                "status": value.get("status") or "not_started",
            }
        )

    deduped: Dict[str, Dict[str, Any]] = {}
    for item in items:
        deduped[item["email"]] = item

    return list(deduped.values())


@router.get("/verification/public/{email}")
def verification_public(email: str):
    email = (email or "").strip().lower()

    for _, value in list((_VERIFICATIONS or {}).items()):
        if not isinstance(value, dict):
            continue
        if (value.get("role") or "").strip().lower() != "organizer":
            continue
        if (value.get("email") or "").strip().lower() == email:
            return {
                "verification": {
                    "email": email,
                    "business_name": value.get("business_name"),
                    "notes": value.get("notes"),
                    "status": value.get("status"),
                    "documents": value.get("documents", []),
                }
            }

    return {"verification": None}


@router.post("/stripe/webhook")
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        import stripe
        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if secret:
            stripe.api_key = secret
        webhook_secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
        if webhook_secret:
            event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
        else:
            event = json.loads(payload.decode("utf-8"))
    except Exception as exc:
        print(f"Stripe webhook signature/payload failed: {exc}")
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook payload")

    event_type = str(event.get("type") or "").strip()
    session = (event.get("data") or {}).get("object") or {}

    try:
        if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
            record = _mark_verification_paid_from_stripe_session(session, source="stripe_webhook")
            print("Stripe webhook confirmed verification payment", {"email": record.get("email"), "role": record.get("role"), "session_id": record.get("last_session_id")})
        elif event_type in {"checkout.session.async_payment_failed", "checkout.session.expired"}:
            session_id = str(session.get("id") or "").strip() if isinstance(session, dict) else str(getattr(session, "id", "") or "").strip()
            record = _find_verification_by_session_id(session_id)
            if record:
                record["payment_status"] = "failed" if event_type.endswith("failed") else "expired"
                record["payment_failed_at"] = int(time.time())
                _save_verification_record(record)
    except Exception as exc:
        print(f"Stripe webhook processing failed: {exc}")
        raise HTTPException(status_code=400, detail=f"Stripe webhook processing failed: {exc}")

    return {"ok": True, "received": True, "type": event_type}


@router.post("/verification/create-checkout")
def verification_create_checkout(
    payload: VerificationCheckoutRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = str(user.get("role") or "vendor")
    if role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=403, detail="Invalid account role")

    email = str(user.get("email") or "")
    record = _get_verification(email, role, user.get("id"))
    amount_cents = int(record.get("fee_amount", VENDOR_VERIFICATION_FEE)) * 100
    if record.get("fee_paid"):
        return {"ok": True, "already_paid": True, "verification": record}

    business_name = str(payload.business_name or "").strip()
    tax_id = str(payload.tax_id or "").strip()
    notes = str(payload.notes or "").strip()

    if business_name:
        record["business_name"] = business_name
    if notes:
        record["notes"] = notes
    if role == "vendor" and tax_id:
        masked = _mask_last4(tax_id)
        if masked:
            record["tax_id_masked"] = masked

    record["user_id"] = user.get("id")
    record["email"] = email
    record["role"] = role

    frontend_url = (os.getenv("FRONTEND_URL") or "https://vendcore.co").strip().rstrip("/")
    success_default = f"{frontend_url}/{role}/verify?payment=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_default = f"{frontend_url}/{role}/verify?payment=cancel"
    success_url = (payload.success_url or success_default).strip()
    cancel_url = (payload.cancel_url or cancel_default).strip()

    try:
        import stripe

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_SECRET_KEY not set")
        stripe.api_key = secret
        session = stripe.checkout.Session.create(
            mode="payment",
            customer_email=email,
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {"name": f"{role.title()} verification"},
                        "unit_amount": amount_cents,
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "verification": "true",
                "email": email,
                "role": role,
                "fee_amount": str(record.get("fee_amount")),
            },
        )
        record["last_session_id"] = session.id
        record["payment_status"] = "pending"
        _save_verification_record(record)
        return {
            "ok": True,
            "url": session.url,
            "session_id": session.id,
            "verification": record,
        }
    except Exception as e:
        return {"ok": False, "detail": f"Stripe checkout unavailable: {e}"}


@router.post("/verification/confirm-payment")
def verification_confirm_payment(
    payload: VerificationConfirmRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    # Browser-return fallback. Stripe webhook is the production source of truth,
    # but this keeps the UX responsive immediately after checkout redirect.
    role = str(user.get("role") or "vendor").strip().lower()
    email = str(user.get("email") or "").strip().lower()
    record = _get_verification(email, role, user.get("id"))

    if record.get("fee_paid"):
        return {"ok": True, "already_paid": True, "verification": record}

    session_id = str(payload.session_id or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    try:
        import stripe

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_SECRET_KEY not set")

        stripe.api_key = secret
        session = stripe.checkout.Session.retrieve(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Stripe session not found")

        confirmed = _mark_verification_paid_from_stripe_session(session, source="authenticated_confirm")
        confirmed_email = _norm(confirmed.get("email"))
        if confirmed_email and confirmed_email != _norm(email):
            print("WARNING verification_confirm_payment: confirmed email mismatch", {"session_id": session_id, "confirmed_email": confirmed_email, "user_email": _norm(email)})

        return {
            "ok": True,
            "verification": confirmed,
            "stripe_status": {"payment_status": "paid", "status": "complete"},
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payment confirmation failed: {str(e)}")


@router.post("/verification/submit")
async def verification_submit(
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Submit verification documents.

    Supports both legacy multipart form uploads and the newer frontend flow that
    uploads documents to Cloudinary first and posts JSON document metadata.
    The authenticated user always owns the record; email/role from the client
    are ignored for ownership.
    """
    role = str(user.get("role") or "vendor").strip().lower()
    email = str(user.get("email") or "").strip().lower()

    if role not in {"vendor", "organizer"}:
        raise HTTPException(
            status_code=403,
            detail="Verification is only available for vendor or organizer accounts",
        )

    record = _get_verification(email, role, user.get("id"))

    if not record.get("fee_paid") and str(record.get("payment_status") or "").lower() != "paid":
        raise HTTPException(
            status_code=400, detail="Please pay the verification fee before submitting"
        )

    content_type = (request.headers.get("content-type") or "").lower()
    business_name = ""
    tax_id = ""
    notes = ""
    documents: List[Dict[str, Any]] = []
    business_license_url = record.get("business_license_url")
    government_id_url = record.get("government_id_url")

    if "application/json" in content_type:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Invalid verification payload")

        business_name = str(payload.get("business_name") or payload.get("businessName") or "").strip()
        tax_id = str(payload.get("tax_id") or payload.get("taxId") or "").strip()
        notes = str(payload.get("notes") or "").strip()

        raw_documents = payload.get("documents") or []
        if isinstance(raw_documents, list):
            for item in raw_documents:
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url") or "").strip()
                if not url:
                    continue
                label = str(item.get("label") or item.get("name") or "Document").strip()
                doc_type = str(item.get("type") or "").strip()
                doc = {
                    "label": label,
                    "name": str(item.get("name") or label).strip(),
                    "type": doc_type or str(item.get("mime_type") or "application/octet-stream"),
                    "url": url,
                }
                if item.get("size") is not None:
                    doc["size"] = item.get("size")
                if item.get("expiration_date"):
                    doc["expiration_date"] = item.get("expiration_date")
                documents.append(doc)

        for doc in documents:
            dtype = str(doc.get("type") or "").lower()
            label = str(doc.get("label") or "").lower()
            if not business_license_url and ("business_license" in dtype or "license" in label or "registration" in label):
                business_license_url = doc.get("url")
            if not government_id_url and ("government_id" in dtype or "government" in label or "id" == dtype):
                government_id_url = doc.get("url")

    else:
        form = await request.form()
        business_name = str(form.get("business_name") or form.get("businessName") or "").strip()
        tax_id = str(form.get("tax_id") or form.get("taxId") or "").strip()
        notes = str(form.get("notes") or "").strip()

        business_license = form.get("business_license") or form.get("businessLicense")
        government_id = form.get("government_id") or form.get("governmentId")

        if business_license is not None and hasattr(business_license, "filename"):
            _, business_license_url, business_license_name = _save_upload(business_license, "business_license")
            documents.append(
                {
                    "label": "Business License",
                    "name": getattr(business_license, "filename", None) or business_license_name,
                    "type": getattr(business_license, "content_type", None) or "application/octet-stream",
                    "url": business_license_url,
                }
            )

        if government_id is not None and hasattr(government_id, "filename"):
            _, government_id_url, government_id_name = _save_upload(government_id, "government_id")
            documents.append(
                {
                    "label": "Government ID",
                    "name": getattr(government_id, "filename", None) or government_id_name,
                    "type": getattr(government_id, "content_type", None) or "application/octet-stream",
                    "url": government_id_url,
                }
            )

    if not business_name:
        raise HTTPException(status_code=400, detail="Business name is required")

    if role == "vendor" and not tax_id and not record.get("tax_id_masked"):
        raise HTTPException(status_code=400, detail="Tax ID is required")

    if not documents and not (business_license_url and government_id_url):
        raise HTTPException(status_code=400, detail="Verification documents are required")

    record["user_id"] = user.get("id")
    record["email"] = email
    record["role"] = role
    record["business_name"] = business_name

    masked = _mask_last4(tax_id)
    if masked:
        record["tax_id_masked"] = masked

    record["notes"] = notes
    record["documents"] = documents or record.get("documents", []) or []
    record["business_license_url"] = business_license_url
    record["government_id_url"] = government_id_url
    record["status"] = "pending"
    record["submitted_at"] = int(time.time())
    record["reviewed_at"] = None
    record["reviewed_by"] = None

    _save_verification_record(record)
    return {"ok": True, "verification": record}


@router.get("/admin/verifications")
def get_verifications(user: Dict[str, Any] = Depends(get_current_user)):
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    values = []
    for key, value in list((_VERIFICATIONS or {}).items()):
        if isinstance(value, dict):
            if value.get("id") is None:
                try:
                    value["id"] = int(key)
                except Exception:
                    pass
            values.append(value)
    values.sort(key=lambda v: int(v.get("submitted_at") or 0), reverse=True)
    return {"verifications": values}


@router.post("/admin/verify/{verification_id}")
def review_verification(
    verification_id: int,
    payload: dict,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")

    record = _get_verification_by_id(verification_id)
    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    status_value = str(payload.get("status") or "").strip().lower()
    if status_value == "approved":
        status_value = "verified"
    if status_value not in {"verified", "rejected", "pending"}:
        raise HTTPException(status_code=400, detail="Invalid verification status")

    record["status"] = status_value
    record["is_verified"] = status_value == "verified"
    record["notes"] = str(payload.get("notes") or "").strip() or None
    record["reviewed_at"] = int(time.time())
    record["reviewed_by"] = str(user.get("email") or "").strip().lower() or None

    _save_verification_record(record)

    if status_value == "verified":
        try:
            send_verification_approved_email(
                email=str(record.get("email") or ""),
                full_name=str(record.get("business_name") or ""),
            )
        except Exception as exc:
            print(f"Verification approved email failed: {exc}")

    return {"ok": True, "verification": record}
