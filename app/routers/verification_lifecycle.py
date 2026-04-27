from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

REMINDER_DAYS = {60, 30, 7, 0}

def _parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def get_days_until_expiration(expiration_date: Any) -> Optional[int]:
    exp = _parse_date(expiration_date)
    if not exp:
        return None
    return (exp.date() - datetime.now(timezone.utc).date()).days

def get_doc_status(expiration_date: Any) -> str:
    days = get_days_until_expiration(expiration_date)
    if days is None:
        return "needs_review"
    if days < 0:
        return "expired"
    if days <= 30:
        return "expiring_soon"
    return "valid"

def enrich_document_lifecycle(document: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(document or {})
    expiration = doc.get("expiration_date") or doc.get("expirationDate") or doc.get("expires_at") or doc.get("expiresAt")
    days = get_days_until_expiration(expiration)
    doc["expiration_date"] = expiration or ""
    doc["days_until_expiration"] = days
    doc["lifecycle_status"] = get_doc_status(expiration)
    return doc

def compute_verification_status(documents: Iterable[Dict[str, Any]], base_status: str = "") -> str:
    base = str(base_status or "").strip().lower()
    docs = [enrich_document_lifecycle(d) for d in documents or [] if isinstance(d, dict)]
    if base in {"rejected", "pending", "not_started"}:
        return base
    if not docs:
        return base or "not_started"
    statuses = {str(d.get("lifecycle_status") or "") for d in docs}
    if "expired" in statuses:
        return "expired"
    if "expiring_soon" in statuses:
        return "expiring_soon"
    if "needs_review" in statuses:
        return "needs_review"
    if base in {"approved", "verified"}:
        return "verified"
    return base or "verified"

def should_send_reminder(document: Dict[str, Any], sent_days: Iterable[int] | None = None) -> bool:
    days = get_days_until_expiration((document or {}).get("expiration_date"))
    if days is None:
        return False
    already_sent = {int(x) for x in (sent_days or []) if str(x).lstrip("-").isdigit()}
    return days in REMINDER_DAYS and days not in already_sent

def verification_lifecycle_summary(record: Dict[str, Any]) -> Dict[str, Any]:
    docs = [enrich_document_lifecycle(d) for d in (record or {}).get("documents", []) if isinstance(d, dict)]
    status = compute_verification_status(docs, (record or {}).get("status", ""))
    return {**(record or {}), "status": status, "lifecycle_status": status, "documents": docs}
