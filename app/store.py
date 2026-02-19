# app/store.py
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict

# -------------------------------------------------------------------
# Persistence (dev-friendly, Windows-safe)
# -------------------------------------------------------------------

_DATA_PATH = Path(__file__).resolve().parent / "_data_store.json"

# IMPORTANT: must be re-entrant because next_* funcs call save_store()
# while already holding the lock.
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
    """
    For vendor profiles keyed by email (string).
    """
    out: Dict[str, Any] = {}
    for k, v in (d or {}).items():
        kk = str(k or "").strip().lower()
        if not kk:
            continue
        out[kk] = v
    return out


def load_store() -> None:
    global _EVENTS, _REQUIREMENTS, _DIAGRAMS, _APPLICATIONS
    global _LAYOUT_META, _BOOTHS, _TEMPLATES
    global _VENDORS
    global _NEXT_EVENT_ID, _NEXT_BOOTH_ID, _NEXT_TEMPLATE_ID, _NEXT_APPLICATION_ID

    with _LOCK:
        if not _DATA_PATH.exists():
            # File will be created on first save
            return

        try:
            raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(
                "⚠️ ERROR: _data_store.json is corrupted. Refusing to overwrite.",
                file=sys.stderr,
            )
            print(f"Details: {e}", file=sys.stderr)
            return  # DO NOT wipe in-memory state

        _EVENTS = _int_keyed(raw.get("events", {}))
        _REQUIREMENTS = _int_keyed(raw.get("requirements", {}))
        _DIAGRAMS = _int_keyed(raw.get("diagrams", {}))
        _APPLICATIONS = _int_keyed(raw.get("applications", {}))

        _LAYOUT_META = _int_keyed(raw.get("layout_meta", {}))
        _BOOTHS = _int_keyed(raw.get("booths", {}))
        _TEMPLATES = _int_keyed(raw.get("templates", {}))

        # ✅ NEW: vendors keyed by email (lowercased)
        _VENDORS = _lower_str_keyed(raw.get("vendors", {}))

        nxt = raw.get("next", {}) or {}
        _NEXT_EVENT_ID = int(nxt.get("event_id", 1) or 1)
        _NEXT_BOOTH_ID = int(nxt.get("booth_id", 1) or 1)
        _NEXT_TEMPLATE_ID = int(nxt.get("template_id", 1) or 1)
        _NEXT_APPLICATION_ID = int(nxt.get("application_id", 1) or 1)


def _atomic_write_json(path: Path, payload: dict) -> None:
    """
    Atomic write for Windows stability:
    - write to temp file in same directory
    - flush + fsync
    - os.replace into final path (atomic on Windows)
    """
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
            json.dump(payload, f, indent=2, default=str)
            f.flush()
            os.fsync(f.fileno())

        os.replace(tmp_name, path)
        tmp_name = None  # ownership transferred
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except Exception:
                pass


def save_store() -> None:
    with _LOCK:
        payload = {
            "events": _str_keyed(_EVENTS),
            "requirements": _str_keyed(_REQUIREMENTS),
            "diagrams": _str_keyed(_DIAGRAMS),
            "applications": _str_keyed(_APPLICATIONS),
            "layout_meta": _str_keyed(_LAYOUT_META),
            "booths": _str_keyed(_BOOTHS),
            "templates": _str_keyed(_TEMPLATES),
            # ✅ NEW
            "vendors": {str(k): v for k, v in (_VENDORS or {}).items()},
            "next": {
                "event_id": _NEXT_EVENT_ID,
                "booth_id": _NEXT_BOOTH_ID,
                "template_id": _NEXT_TEMPLATE_ID,
                "application_id": _NEXT_APPLICATION_ID,
            },
        }

        _atomic_write_json(_DATA_PATH, payload)


# -------------------------------------------------------------------
# In-memory storage
# -------------------------------------------------------------------

_EVENTS: Dict[int, Dict[str, Any]] = {}
_REQUIREMENTS: Dict[int, Dict[str, Any]] = {}
_DIAGRAMS: Dict[int, Dict[str, Any]] = {}
_APPLICATIONS: Dict[int, Dict[str, Any]] = {}

_LAYOUT_META: Dict[int, Dict[str, Any]] = {}
_BOOTHS: Dict[int, Dict[str, Any]] = {}
_TEMPLATES: Dict[int, Dict[str, Any]] = {}

# ✅ NEW: vendor profiles keyed by vendor_email (lowercase)
_VENDORS: Dict[str, Dict[str, Any]] = {}

_NEXT_EVENT_ID = 1
_NEXT_BOOTH_ID = 1
_NEXT_TEMPLATE_ID = 1
_NEXT_APPLICATION_ID = 1

load_store()


def next_event_id() -> int:
    global _NEXT_EVENT_ID
    with _LOCK:
        val = _NEXT_EVENT_ID
        _NEXT_EVENT_ID += 1
        save_store()
        return val


def next_booth_id() -> int:
    global _NEXT_BOOTH_ID
    with _LOCK:
        val = _NEXT_BOOTH_ID
        _NEXT_BOOTH_ID += 1
        save_store()
        return val


def next_template_id() -> int:
    global _NEXT_TEMPLATE_ID
    with _LOCK:
        val = _NEXT_TEMPLATE_ID
        _NEXT_TEMPLATE_ID += 1
        save_store()
        return val


def next_application_id() -> int:
    global _NEXT_APPLICATION_ID
    with _LOCK:
        val = _NEXT_APPLICATION_ID
        _NEXT_APPLICATION_ID += 1
        save_store()
        return val
