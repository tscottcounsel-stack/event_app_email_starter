from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field

router = APIRouter(tags=["Waitlist"])

PUBLIC_DATA_DIR = Path(os.getenv("PUBLIC_DATA_DIR") or "/data")
WAITLIST_PATH = PUBLIC_DATA_DIR / "waitlist_submissions.json"

VALID_STATUSES = {"new", "contacted", "demo_scheduled", "converted", "archived"}
VALID_ROLES = {"organizer", "vendor"}


class WaitlistCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str = Field(default="organizer")
    name: str = Field(min_length=1, max_length=180)
    email: EmailStr
    business: Optional[str] = Field(default="", max_length=220)
    city: Optional[str] = Field(default="", max_length=160)
    notes: Optional[str] = Field(default="", max_length=3000)
    source: Optional[str] = Field(default="public_waitlist", max_length=120)


class WaitlistStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: str = Field(min_length=1, max_length=40)
    admin_note: Optional[str] = Field(default="", max_length=2000)


def _now() -> int:
    return int(time.time())


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _safe_read() -> Dict[str, Any]:
    try:
        if not WAITLIST_PATH.exists():
            return {"submissions": [], "next_id": 1}
        raw = json.loads(WAITLIST_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {"submissions": [], "next_id": 1}
        submissions = raw.get("submissions")
        if not isinstance(submissions, list):
            submissions = []
        next_id = raw.get("next_id")
        try:
            next_id = int(next_id)
        except Exception:
            next_id = 1
        return {"submissions": submissions, "next_id": max(next_id, 1)}
    except Exception:
        return {"submissions": [], "next_id": 1}


def _safe_write(payload: Dict[str, Any]) -> None:
    WAITLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = WAITLIST_PATH.with_suffix(WAITLIST_PATH.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(WAITLIST_PATH)


def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": record.get("id"),
        "role": record.get("role") or "organizer",
        "name": record.get("name") or "",
        "email": record.get("email") or "",
        "business": record.get("business") or "",
        "city": record.get("city") or "",
        "notes": record.get("notes") or "",
        "status": record.get("status") or "new",
        "source": record.get("source") or "public_waitlist",
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "admin_note": record.get("admin_note") or "",
    }


@router.post("/waitlist")
def create_waitlist_submission(payload: WaitlistCreateRequest) -> Dict[str, Any]:
    role = _norm(payload.role) or "organizer"
    if role not in VALID_ROLES:
        role = "organizer"

    email = _norm(payload.email)
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    store = _safe_read()
    submissions: List[Dict[str, Any]] = [x for x in store.get("submissions", []) if isinstance(x, dict)]

    # Update an existing same-email/role lead instead of creating duplicates every click.
    existing = None
    for item in submissions:
        if _norm(item.get("email")) == email and _norm(item.get("role")) == role:
            existing = item
            break

    now = _now()
    if existing is not None:
        existing.update(
            {
                "name": name,
                "business": str(payload.business or "").strip(),
                "city": str(payload.city or "").strip(),
                "notes": str(payload.notes or "").strip(),
                "source": str(payload.source or "public_waitlist").strip() or "public_waitlist",
                "updated_at": now,
            }
        )
        record = existing
    else:
        next_id = int(store.get("next_id") or 1)
        record = {
            "id": next_id,
            "role": role,
            "name": name,
            "email": email,
            "business": str(payload.business or "").strip(),
            "city": str(payload.city or "").strip(),
            "notes": str(payload.notes or "").strip(),
            "status": "new",
            "source": str(payload.source or "public_waitlist").strip() or "public_waitlist",
            "created_at": now,
            "updated_at": now,
            "admin_note": "",
        }
        submissions.append(record)
        store["next_id"] = next_id + 1

    store["submissions"] = submissions
    _safe_write(store)

    return {"ok": True, "submission": _public_record(record)}


@router.get("/admin/waitlist")
def admin_waitlist(status: Optional[str] = None, role: Optional[str] = None) -> Dict[str, Any]:
    status_filter = _norm(status)
    role_filter = _norm(role)

    store = _safe_read()
    rows: List[Dict[str, Any]] = []
    for item in store.get("submissions", []):
        if not isinstance(item, dict):
            continue
        row = _public_record(item)
        if status_filter and status_filter != "all" and _norm(row.get("status")) != status_filter:
            continue
        if role_filter and role_filter != "all" and _norm(row.get("role")) != role_filter:
            continue
        rows.append(row)

    rows.sort(key=lambda x: int(x.get("created_at") or 0), reverse=True)

    counts = {"total": len(rows), "organizer": 0, "vendor": 0, "new": 0, "contacted": 0, "demo_scheduled": 0, "converted": 0, "archived": 0}
    for row in rows:
        r = _norm(row.get("role"))
        s = _norm(row.get("status")) or "new"
        if r in ("organizer", "vendor"):
            counts[r] += 1
        if s in counts:
            counts[s] += 1

    return {"ok": True, "submissions": rows, "counts": counts}


@router.patch("/admin/waitlist/{submission_id}")
def admin_update_waitlist_submission(submission_id: int, payload: WaitlistStatusUpdateRequest) -> Dict[str, Any]:
    status = _norm(payload.status)
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid waitlist status")

    store = _safe_read()
    submissions: List[Dict[str, Any]] = [x for x in store.get("submissions", []) if isinstance(x, dict)]

    target = None
    for item in submissions:
        try:
            if int(item.get("id")) == int(submission_id):
                target = item
                break
        except Exception:
            continue

    if target is None:
        raise HTTPException(status_code=404, detail="Waitlist submission not found")

    target["status"] = status
    target["updated_at"] = _now()
    if payload.admin_note is not None:
        target["admin_note"] = str(payload.admin_note or "").strip()

    store["submissions"] = submissions
    _safe_write(store)

    return {"ok": True, "submission": _public_record(target)}
