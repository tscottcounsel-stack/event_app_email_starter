from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user
from app.store import _VENDORS, _VERIFICATIONS, save_store, upsert_verification_record

router = APIRouter(tags=["Verifications"])

DATA_DIR = Path("/data") if Path("/data").exists() else Path(__file__).resolve().parent.parent
PROFILE_STORE_PATH = DATA_DIR / "organizer_profiles.json"

VALID_STATUSES = {"pending", "verified", "rejected", "expired", "expiring_soon", "unverified"}
RENEWAL_DAYS = 365
EXPIRING_SOON_DAYS = 30


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _norm_email(value: Any) -> str:
    return _safe_str(value).lower()


def _parse_datetime(value: Any) -> datetime | None:
    raw = _safe_str(value)
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _public_status(record: Dict[str, Any] | None) -> str:
    if not record:
        return "unverified"

    status = _safe_str(record.get("status") or record.get("verification_status")).lower()
    if status in {"pending", "rejected"}:
        return status

    if status != "verified":
        return status if status in VALID_STATUSES else "unverified"

    exp = _parse_datetime(record.get("expiration_date") or record.get("expires_at"))
    if not exp:
        return "verified"

    now = _utc_now()
    if exp < now:
        return "expired"
    if exp - now <= timedelta(days=EXPIRING_SOON_DAYS):
        return "expiring_soon"
    return "verified"


def _next_verification_id() -> int:
    ids: List[int] = []
    for key in (_VERIFICATIONS or {}).keys():
        try:
            ids.append(int(key))
        except Exception:
            continue
    return max(ids, default=0) + 1


def _find_latest(email: Any, role: Any = None) -> Dict[str, Any] | None:
    target_email = _norm_email(email)
    target_role = _safe_str(role).lower()
    if not target_email:
        return None

    matches: List[Dict[str, Any]] = []
    for item in (_VERIFICATIONS or {}).values():
        if not isinstance(item, dict):
            continue
        if _norm_email(item.get("email")) != target_email:
            continue
        if target_role and _safe_str(item.get("role")).lower() != target_role:
            continue
        matches.append(item)

    if not matches:
        return None

    matches.sort(
        key=lambda item: (
            _safe_str(item.get("submitted_at") or item.get("created_at")),
            int(item.get("id") or 0),
        ),
        reverse=True,
    )
    return matches[0]


def _load_profiles() -> Dict[str, Dict[str, Any]]:
    try:
        if not PROFILE_STORE_PATH.exists():
            return {}
        data = json.loads(PROFILE_STORE_PATH.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_profiles(profiles: Dict[str, Dict[str, Any]]) -> None:
    PROFILE_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_STORE_PATH.write_text(json.dumps(profiles, indent=2, sort_keys=True), encoding="utf-8")


def _sync_public_profile_flags(record: Dict[str, Any]) -> None:
    email = _norm_email(record.get("email"))
    role = _safe_str(record.get("role")).lower()
    public_status = _public_status(record)
    is_verified = public_status == "verified"

    if not email:
        return

    if role == "vendor":
        vendor = _VENDORS.get(email)
        if isinstance(vendor, dict):
            vendor["verified"] = is_verified
            vendor["verification_status"] = public_status
            vendor["verification_id"] = record.get("id")
            vendor["expiration_date"] = record.get("expiration_date")
            vendor["documents"] = record.get("documents", [])
            vendor["updated_at"] = _utc_now_iso()

    if role == "organizer":
        profiles = _load_profiles()
        profile = profiles.get(email)
        if isinstance(profile, dict):
            profile["verified"] = is_verified
            profile["verification_status"] = public_status
            profile["verification_id"] = record.get("id")
            profile["expiration_date"] = record.get("expiration_date")
            profile["documents"] = record.get("documents", [])
            profile["updatedAt"] = _utc_now_iso()
            profiles[email] = profile
            _save_profiles(profiles)


def _normalize_documents(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    docs: List[Dict[str, Any]] = []
    for idx, doc in enumerate(value, start=1):
        if not isinstance(doc, dict):
            continue
        docs.append({
            "id": doc.get("id") or idx,
            "name": _safe_str(doc.get("name") or doc.get("label") or doc.get("type") or f"Document {idx}"),
            "label": _safe_str(doc.get("label") or doc.get("name") or doc.get("type") or f"Document {idx}"),
            "type": _safe_str(doc.get("type") or doc.get("document_type") or doc.get("documentType")),
            "url": _safe_str(doc.get("url") or doc.get("file_url") or doc.get("fileUrl")),
            "expiration_date": _safe_str(doc.get("expiration_date") or doc.get("expirationDate") or doc.get("expires_at") or doc.get("expiresAt")),
        })
    return docs


@router.post("/verification/submit")
def submit_verification(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    data = payload or {}
    email = _norm_email(data.get("email") or user.get("email"))
    role = _safe_str(data.get("role") or user.get("role")).lower()

    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    if role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")

    existing = _find_latest(email, role)
    vid = int(existing.get("id")) if existing and existing.get("id") else _next_verification_id()

    record = {
        "id": vid,
        "user_id": data.get("user_id") or user.get("id") or user.get("sub") or vid,
        "email": email,
        "role": role,
        "status": "pending",
        "submitted_at": _utc_now_iso(),
        "reviewed_at": None,
        "reviewed_by": None,
        "notes": _safe_str(data.get("notes")),
        "payment_status": _safe_str(data.get("payment_status") or "unpaid"),
        "fee_amount": data.get("fee_amount") or 0,
        "documents": _normalize_documents(data.get("documents")),
        "expiration_date": _safe_str(data.get("expiration_date") or data.get("expirationDate")),
    }

    upsert_verification_record(record)
    _sync_public_profile_flags(record)
    save_store()
    return {"ok": True, "verification": record}


@router.get("/verification/me")
def get_my_verification(user: Dict[str, Any] = Depends(get_current_user)):
    email = _norm_email(user.get("email"))
    role = _safe_str(user.get("role")).lower()
    record = _find_latest(email, role) or _find_latest(email)
    if not record:
        return {"verification": None, "verification_status": "unverified"}
    return {"verification": record, "verification_status": _public_status(record)}


@router.get("/admin/verifications")
def get_admin_verifications(user: Dict[str, Any] = Depends(get_current_user)):
    if _safe_str(user.get("role")).lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    rows = []
    for item in (_VERIFICATIONS or {}).values():
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row["status"] = _public_status(row)
        rows.append(row)

    rows.sort(
        key=lambda item: (
            _safe_str(item.get("submitted_at") or item.get("created_at")),
            int(item.get("id") or 0),
        ),
        reverse=True,
    )
    return {"verifications": rows}


@router.post("/admin/verify/{verification_id}")
def review_verification(verification_id: int, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    if _safe_str(user.get("role")).lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    record = _VERIFICATIONS.get(int(verification_id))
    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    decision = _safe_str((payload or {}).get("status")).lower()
    if decision not in {"verified", "rejected"}:
        raise HTTPException(status_code=400, detail="Status must be verified or rejected")

    record["status"] = decision
    record["reviewed_at"] = _utc_now_iso()
    record["reviewed_by"] = _norm_email(user.get("email")) or "admin"
    record["notes"] = _safe_str((payload or {}).get("notes"))

    if decision == "verified":
        requested_exp = _parse_datetime((payload or {}).get("expiration_date") or (payload or {}).get("expirationDate"))
        expiration = requested_exp or (_utc_now() + timedelta(days=RENEWAL_DAYS))
        record["expiration_date"] = expiration.isoformat()
    else:
        record["expiration_date"] = None

    _VERIFICATIONS[int(verification_id)] = record
    _sync_public_profile_flags(record)
    save_store()
    return {"ok": True, "verification": {**record, "status": _public_status(record)}}
