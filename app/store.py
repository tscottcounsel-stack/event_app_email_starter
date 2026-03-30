from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict

DATA_DIR = Path(os.getenv("DATA_DIR", "/data/vendorconnect"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

_DATA_PATH = DATA_DIR / "_data_store.json"
_LOCK = threading.RLock()


def _int_keyed(d: dict) -> Dict[int, Any]:
    out: Dict[int, Any] = {}
    for k, v in (d or {}).items():
        try:
            out[int(k)] = v
        except Exception:
            continue
    return out


def _str_keyed(d: Dict[int, Any]) -> dict:
    return {str(k): v for k, v in (d or {}).items()}


def _lower_str_keyed(d: dict) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (d or {}).items():
        kk = str(k or "").strip().lower()
        if not kk:
            continue
        out[kk] = v
    return out


def _next_id_from_keys(records: Dict[int, Any], fallback: int = 1) -> int:
    ids = []
    for k in (records or {}).keys():
        try:
            ids.append(int(k))
        except Exception:
            continue
    return max(ids, default=fallback - 1) + 1


def _recompute_next_counters() -> None:
    global _NEXT_EVENT_ID, _NEXT_BOOTH_ID, _NEXT_TEMPLATE_ID, _NEXT_APPLICATION_ID

    _NEXT_EVENT_ID = max(int(_NEXT_EVENT_ID or 1), _next_id_from_keys(_EVENTS, 1))
    _NEXT_BOOTH_ID = max(int(_NEXT_BOOTH_ID or 1), _next_id_from_keys(_BOOTHS, 1))
    _NEXT_TEMPLATE_ID = max(int(_NEXT_TEMPLATE_ID or 1), _next_id_from_keys(_TEMPLATES, 1))
    _NEXT_APPLICATION_ID = max(
        int(_NEXT_APPLICATION_ID or 1),
        _next_id_from_keys(_APPLICATIONS, 1),
    )


_EVENTS: Dict[int, Dict[str, Any]] = {}
_REQUIREMENTS: Dict[int, Dict[str, Any]] = {}
_REQUIREMENT_TEMPLATES: Dict[str, Dict[str, Any]] = {}
_DIAGRAMS: Dict[int, Dict[str, Any]] = {}
_APPLICATIONS: Dict[int, Dict[str, Any]] = {}
_PAYMENTS: Dict[int, Dict[str, Any]] = {}
_PAYOUTS: Dict[int, Dict[str, Any]] = {}
_AUDIT_LOGS: Dict[int, Dict[str, Any]] = {}
_VERIFICATIONS: Dict[int, Dict[str, Any]] = {}

_LAYOUT_META: Dict[int, Dict[str, Any]] = {}
_BOOTHS: Dict[int, Dict[str, Any]] = {}
_TEMPLATES: Dict[int, Dict[str, Any]] = {}

_VENDORS: Dict[str, Dict[str, Any]] = {}
_REVIEWS: Dict[str, Dict[int, Dict[str, Any]]] = {}

_NEXT_EVENT_ID = 1
_NEXT_BOOTH_ID = 1
_NEXT_TEMPLATE_ID = 1
_NEXT_APPLICATION_ID = 1


def load_store() -> None:
    global _EVENTS, _REQUIREMENTS, _REQUIREMENT_TEMPLATES, _DIAGRAMS, _APPLICATIONS
    global _PAYMENTS, _PAYOUTS, _AUDIT_LOGS, _VERIFICATIONS
    global _LAYOUT_META, _BOOTHS, _TEMPLATES
    global _VENDORS, _REVIEWS
    global _NEXT_EVENT_ID, _NEXT_BOOTH_ID, _NEXT_TEMPLATE_ID, _NEXT_APPLICATION_ID

    with _LOCK:
        if not _DATA_PATH.exists():
            _recompute_next_counters()
            return

        try:
            raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(
                "ERROR: _data_store.json is corrupted. Refusing to overwrite.",
                file=sys.stderr,
            )
            print(f"Details: {e}", file=sys.stderr)
            _recompute_next_counters()
            return

        _EVENTS = _int_keyed(raw.get("events", {}))
        _REQUIREMENTS = _int_keyed(raw.get("requirements", {}))
        _REQUIREMENT_TEMPLATES = raw.get("requirement_templates", {}) or {}
        _DIAGRAMS = _int_keyed(raw.get("diagrams", {}))
        _APPLICATIONS = _int_keyed(raw.get("applications", {}))

        raw_payments = raw.get("payments", {})
        if isinstance(raw_payments, list):
            _PAYMENTS = {}
            for i, p in enumerate(raw_payments, start=1):
                if not isinstance(p, dict):
                    continue
                pid = p.get("id", i)
                try:
                    pid = int(pid)
                except Exception:
                    pid = i
                _PAYMENTS[pid] = p
        else:
            _PAYMENTS = _int_keyed(raw_payments)

        raw_payouts = raw.get("payouts", {})
        if isinstance(raw_payouts, list):
            _PAYOUTS = {}
            for i, p in enumerate(raw_payouts, start=1):
                if not isinstance(p, dict):
                    continue
                pid = p.get("id", i)
                try:
                    pid = int(pid)
                except Exception:
                    pid = i
                _PAYOUTS[pid] = p
        else:
            _PAYOUTS = _int_keyed(raw_payouts)

        raw_audit_logs = raw.get("audit_logs", {})
        if isinstance(raw_audit_logs, list):
            _AUDIT_LOGS = {}
            for i, item in enumerate(raw_audit_logs, start=1):
                if not isinstance(item, dict):
                    continue
                aid = item.get("id", i)
                try:
                    aid = int(aid)
                except Exception:
                    aid = i
                _AUDIT_LOGS[aid] = item
        else:
            _AUDIT_LOGS = _int_keyed(raw_audit_logs)

        raw_verifications = raw.get("verifications", {})
        if isinstance(raw_verifications, list):
            _VERIFICATIONS = {}
            for i, item in enumerate(raw_verifications, start=1):
                if not isinstance(item, dict):
                    continue
                vid = item.get("id", i)
                try:
                    vid = int(vid)
                except Exception:
                    vid = i
                _VERIFICATIONS[vid] = item
        else:
            _VERIFICATIONS = _int_keyed(raw_verifications)

        _LAYOUT_META = _int_keyed(raw.get("layout_meta", {}))
        _BOOTHS = _int_keyed(raw.get("booths", {}))
        _TEMPLATES = _int_keyed(raw.get("templates", {}))
        _VENDORS = _lower_str_keyed(raw.get("vendors", {}))

        raw_reviews = raw.get("reviews", {}) or {}
        _REVIEWS = {}
        if isinstance(raw_reviews, dict):
            for vendor_key, vendor_reviews in raw_reviews.items():
                normalized_vendor_key = str(vendor_key or "").strip().lower()
                if not normalized_vendor_key or not isinstance(vendor_reviews, dict):
                    continue
                _REVIEWS[normalized_vendor_key] = _int_keyed(vendor_reviews)

        nxt = raw.get("next", {}) or {}
        _NEXT_EVENT_ID = int(nxt.get("event_id", 1) or 1)
        _NEXT_BOOTH_ID = int(nxt.get("booth_id", 1) or 1)
        _NEXT_TEMPLATE_ID = int(nxt.get("template_id", 1) or 1)
        _NEXT_APPLICATION_ID = int(nxt.get("application_id", 1) or 1)

        _recompute_next_counters()


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
            json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
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


def save_store() -> None:
    with _LOCK:
        _recompute_next_counters()

        payload = {
            "events": _str_keyed(_EVENTS),
            "requirements": _str_keyed(_REQUIREMENTS),
            "requirement_templates": _REQUIREMENT_TEMPLATES,
            "diagrams": _str_keyed(_DIAGRAMS),
            "applications": _str_keyed(_APPLICATIONS),
            "payments": _str_keyed(_PAYMENTS),
            "payouts": _str_keyed(_PAYOUTS),
            "audit_logs": _str_keyed(_AUDIT_LOGS),
            "verifications": _str_keyed(_VERIFICATIONS),
            "layout_meta": _str_keyed(_LAYOUT_META),
            "booths": _str_keyed(_BOOTHS),
            "templates": _str_keyed(_TEMPLATES),
            "vendors": _VENDORS,
            "reviews": {
                vendor_key: _str_keyed(vendor_reviews)
                for vendor_key, vendor_reviews in _REVIEWS.items()
            },
            "next": {
                "event_id": _NEXT_EVENT_ID,
                "booth_id": _NEXT_BOOTH_ID,
                "template_id": _NEXT_TEMPLATE_ID,
                "application_id": _NEXT_APPLICATION_ID,
            },
        }

        _atomic_write_json(_DATA_PATH, payload)


load_store()


def next_event_id() -> int:
    global _NEXT_EVENT_ID
    with _LOCK:
        _NEXT_EVENT_ID = max(int(_NEXT_EVENT_ID or 1), _next_id_from_keys(_EVENTS, 1))
        val = _NEXT_EVENT_ID
        _NEXT_EVENT_ID += 1
        return val


def next_booth_id() -> int:
    global _NEXT_BOOTH_ID
    with _LOCK:
        _NEXT_BOOTH_ID = max(int(_NEXT_BOOTH_ID or 1), _next_id_from_keys(_BOOTHS, 1))
        val = _NEXT_BOOTH_ID
        _NEXT_BOOTH_ID += 1
        return val


def next_template_id() -> int:
    global _NEXT_TEMPLATE_ID
    with _LOCK:
        _NEXT_TEMPLATE_ID = max(
            int(_NEXT_TEMPLATE_ID or 1),
            _next_id_from_keys(_TEMPLATES, 1),
        )
        val = _NEXT_TEMPLATE_ID
        _NEXT_TEMPLATE_ID += 1
        return val


def next_application_id() -> int:
    global _NEXT_APPLICATION_ID
    with _LOCK:
        _NEXT_APPLICATION_ID = max(
            int(_NEXT_APPLICATION_ID or 1),
            _next_id_from_keys(_APPLICATIONS, 1),
        )
        val = _NEXT_APPLICATION_ID
        _NEXT_APPLICATION_ID += 1
        return val


def next_review_id(vendor_key: Any) -> int:
    normalized_vendor_key = str(vendor_key or "").strip().lower()
    with _LOCK:
        vendor_reviews = _REVIEWS.get(normalized_vendor_key, {})
        return _next_id_from_keys(vendor_reviews, 1)


def find_existing_application(
    vendor_email: Any, event_id: Any
) -> Dict[str, Any] | None:
    email = str(vendor_email or "").strip().lower()
    event_key = str(event_id)

    with _LOCK:
        for app in (_APPLICATIONS or {}).values():
            if not isinstance(app, dict):
                continue
            if str(app.get("vendor_email") or "").strip().lower() != email:
                continue
            if str(app.get("event_id")) != event_key:
                continue
            if str(app.get("status") or "").strip().lower() in {
                "draft",
                "submitted",
                "approved",
            }:
                return app

    return None


def get_store_snapshot() -> Dict[str, Any]:
    with _LOCK:
        load_store()
        return {
            "events": _str_keyed(_EVENTS),
            "requirements": _str_keyed(_REQUIREMENTS),
            "requirement_templates": dict(_REQUIREMENT_TEMPLATES),
            "diagrams": _str_keyed(_DIAGRAMS),
            "applications": _str_keyed(_APPLICATIONS),
            "payments": _str_keyed(_PAYMENTS),
            "payouts": _str_keyed(_PAYOUTS),
            "audit_logs": _str_keyed(_AUDIT_LOGS),
            "verifications": _str_keyed(_VERIFICATIONS),
            "layout_meta": _str_keyed(_LAYOUT_META),
            "booths": _str_keyed(_BOOTHS),
            "templates": _str_keyed(_TEMPLATES),
            "vendors": dict(_VENDORS),
            "reviews": {
                vendor_key: _str_keyed(vendor_reviews)
                for vendor_key, vendor_reviews in _REVIEWS.items()
            },
            "next": {
                "event_id": _NEXT_EVENT_ID,
                "booth_id": _NEXT_BOOTH_ID,
                "template_id": _NEXT_TEMPLATE_ID,
                "application_id": _NEXT_APPLICATION_ID,
            },
        }


def next_verification_id() -> int:
    with _LOCK:
        existing_ids = []
        for k in _VERIFICATIONS.keys():
            try:
                existing_ids.append(int(k))
            except Exception:
                continue
        return (max(existing_ids) + 1) if existing_ids else 1


def get_verification_by_user_id(user_id: Any) -> Dict[str, Any] | None:
    try:
        uid = int(user_id)
    except Exception:
        return None
    with _LOCK:
        return _VERIFICATIONS.get(uid)


def upsert_verification(user_id: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        uid = int(user_id)
    except Exception:
        raise ValueError("user_id must be an integer")

    with _LOCK:
        existing = _VERIFICATIONS.get(uid, {})
        record: Dict[str, Any] = {
            "id": uid,
            **existing,
            **dict(payload or {}),
        }
        record["user_id"] = uid
        _VERIFICATIONS[uid] = record
        save_store()
        return record


def get_or_create_application(
    *,
    vendor_email: Any,
    event_id: Any,
    defaults: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    defaults = dict(defaults or {})

    with _LOCK:
        existing = find_existing_application(
            vendor_email=vendor_email, event_id=event_id
        )
        if existing:
            return existing

        app_id = next_application_id()
        application: Dict[str, Any] = {
            "id": app_id,
            "event_id": event_id,
            "vendor_email": str(vendor_email or "").strip().lower(),
            "status": defaults.pop("status", "draft"),
            **defaults,
        }

        _APPLICATIONS[app_id] = application
        save_store()
        return application
