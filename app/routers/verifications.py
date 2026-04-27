from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from app.store import _VERIFICATIONS, save_store

router = APIRouter(tags=["Verifications"])

VALID_ROLES = {"vendor", "organizer"}
VALID_REVIEW_STATUSES = {"verified", "rejected"}
EXPIRING_SOON_DAYS = 30
DEFAULT_VERIFICATION_DURATION_DAYS = 365


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = _safe_str(value)
    if not raw:
        return None

    try:
        normalized = raw.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _next_verification_id() -> int:
    ids: List[int] = []
    for key in _VERIFICATIONS.keys():
        try:
            ids.append(int(key))
        except Exception:
            continue
    return max(ids, default=0) + 1


def _normalize_documents(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    docs: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        doc = {
            "name": _safe_str(item.get("name") or item.get("label") or item.get("type")),
            "label": _safe_str(item.get("label") or item.get("name") or item.get("type")),
            "type": _safe_str(item.get("type") or item.get("document_type") or item.get("category")),
            "url": _safe_str(item.get("url") or item.get("file_url") or item.get("fileUrl")),
            "expiration_date": _safe_str(
                item.get("expiration_date")
                or item.get("expirationDate")
                or item.get("expires_at")
                or item.get("expiresAt")
            ),
            "uploaded_at": _safe_str(item.get("uploaded_at") or item.get("uploadedAt") or _now_iso()),
        }

        if doc["name"] or doc["url"] or doc["type"]:
            docs.append(doc)

    return docs


def _record_matches_identity(record: Dict[str, Any], email: str, role: str) -> bool:
    record_email = _safe_lower(record.get("email"))
    record_role = _safe_lower(record.get("role"))
    return bool(record_email and email and record_email == email and record_role == role)


def _find_latest_record(email: str, role: str = "") -> Optional[Dict[str, Any]]:
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)

    matches: List[Dict[str, Any]] = []
    for record in _VERIFICATIONS.values():
        if not isinstance(record, dict):
            continue
        if _safe_lower(record.get("email")) != normalized_email:
            continue
        if normalized_role and _safe_lower(record.get("role")) != normalized_role:
            continue
        matches.append(record)

    if not matches:
        return None

    matches.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)
    return matches[0]


def _earliest_expiration_from_documents(record: Optional[Dict[str, Any]]) -> Optional[datetime]:
    if not isinstance(record, dict):
        return None

    documents = record.get("documents") or record.get("verification_documents") or record.get("verificationDocuments") or []
    if isinstance(documents, dict):
        documents = list(documents.values())

    expirations: List[datetime] = []
    if isinstance(documents, list):
        for doc in documents:
            if not isinstance(doc, dict):
                continue
            exp = _parse_datetime(
                doc.get("expiration_date")
                or doc.get("expirationDate")
                or doc.get("expires_at")
                or doc.get("expiresAt")
            )
            if exp:
                expirations.append(exp)

    return min(expirations) if expirations else None


def _compute_lifecycle_status(record: Optional[Dict[str, Any]]) -> str:
    """Internal verification truth used by admin/review flows."""
    if not record:
        return "unverified"

    status = _safe_lower(record.get("status")) or "pending"

    if status != "verified":
        return status

    expiration = _earliest_expiration_from_documents(record) or _parse_datetime(record.get("expiration_date"))
    if not expiration:
        return "verified"

    now = _now()
    if expiration < now:
        return "expired"

    if expiration - now <= timedelta(days=EXPIRING_SOON_DAYS):
        return "expiring_soon"

    return "verified"


def _review_status(record: Optional[Dict[str, Any]]) -> str:
    if not isinstance(record, dict):
        return "none"

    explicit = _safe_lower(record.get("review_status") or record.get("reviewStatus"))
    if explicit:
        return explicit

    raw = _safe_lower(record.get("status"))
    if raw == "verified":
        return "approved"
    if raw == "pending":
        return "renewal_pending"
    if raw == "rejected":
        return "rejected"
    return raw or "none"


def _public_verification_display(record: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Reputation-safe public display. Keep raw lifecycle details internal/admin-only."""
    lifecycle_status = _compute_lifecycle_status(record)
    review_status = _review_status(record)

    if lifecycle_status in {"verified", "expiring_soon"}:
        return {
            "public_verification_status": "verified",
            "public_verification_label": "Verified",
        }

    if review_status in {"pending", "renewal_pending"}:
        return {
            "public_verification_status": "renewal_pending",
            "public_verification_label": "Renewal pending",
        }

    return {
        "public_verification_status": "not_verified",
        "public_verification_label": "Not verified",
    }


def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    lifecycle_status = _compute_lifecycle_status(record)
    review_status = _review_status(record)
    public_display = _public_verification_display(record)
    return {
        **record,
        "verification_status": lifecycle_status,
        "review_status": review_status,
        **public_display,
    }


@router.post("/verification/submit")
def submit_verification(payload: Dict[str, Any]):
    email = _safe_lower(payload.get("email"))
    role = _safe_lower(payload.get("role"))

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")

    existing = None
    for verification_id, record in _VERIFICATIONS.items():
        if isinstance(record, dict) and _record_matches_identity(record, email, role):
            existing = (verification_id, record)
            break

    documents = _normalize_documents(payload.get("documents"))
    submitted_at = _now_iso()

    if existing:
        verification_id, record = existing
        record.update(
            {
                "id": int(verification_id),
                "email": email,
                "role": role,
                "status": "pending",
                "submitted_at": submitted_at,
                "reviewed_at": None,
                "reviewed_by": None,
                "notes": _safe_str(payload.get("notes") or record.get("notes")),
                "documents": documents,
                "payment_status": _safe_str(payload.get("payment_status") or record.get("payment_status") or "unpaid"),
                "fee_amount": payload.get("fee_amount", record.get("fee_amount", 0)),
                "expiration_date": payload.get("expiration_date") or record.get("expiration_date"),
            }
        )
        saved = record
    else:
        verification_id = _next_verification_id()
        saved = {
            "id": verification_id,
            "email": email,
            "role": role,
            "status": "pending",
            "submitted_at": submitted_at,
            "reviewed_at": None,
            "reviewed_by": None,
            "notes": _safe_str(payload.get("notes")),
            "documents": documents,
            "payment_status": _safe_str(payload.get("payment_status") or "unpaid"),
            "fee_amount": payload.get("fee_amount", 0),
            "expiration_date": payload.get("expiration_date"),
        }
        _VERIFICATIONS[verification_id] = saved

    save_store()

    return {
        "ok": True,
        "verification": _public_record(saved),
    }


@router.get("/verification/status")
def get_verification_status(email: str, role: str = ""):
    record = _find_latest_record(email, role)
    return {
        "ok": True,
        "email": _safe_lower(email),
        "role": _safe_lower(role),
        "verification_status": _compute_lifecycle_status(record),
        "verification": _public_record(record) if record else None,
    }


@router.get("/admin/verifications")
def get_admin_verifications():
    records = [
        _public_record(record)
        for record in _VERIFICATIONS.values()
        if isinstance(record, dict)
    ]
    records.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)

    return {
        "ok": True,
        "verifications": records,
        "count": len(records),
    }


@router.post("/admin/verify/{verification_id}")
def review_verification(verification_id: int, payload: Dict[str, Any]):
    record = _VERIFICATIONS.get(verification_id)

    if not isinstance(record, dict):
        raise HTTPException(status_code=404, detail="Verification not found")

    status = _safe_lower(payload.get("status"))

    if status not in VALID_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be verified or rejected")

    record["status"] = status
    record["reviewed_at"] = _now_iso()
    record["reviewed_by"] = _safe_str(payload.get("reviewed_by") or payload.get("reviewedBy"))
    record["notes"] = _safe_str(payload.get("notes"))

    if status == "verified":
        provided_expiration = _safe_str(payload.get("expiration_date") or payload.get("expirationDate"))
        record["expiration_date"] = provided_expiration or (
            _now() + timedelta(days=DEFAULT_VERIFICATION_DURATION_DAYS)
        ).isoformat()

    save_store()

    return {
        "ok": True,
        "verification": _public_record(record),
    }


@router.delete("/admin/verifications/{verification_id}")
def delete_verification(verification_id: int):
    if verification_id not in _VERIFICATIONS:
        raise HTTPException(status_code=404, detail="Verification not found")

    removed = _VERIFICATIONS.pop(verification_id)
    save_store()

    return {
        "ok": True,
        "deleted": removed,
    }
