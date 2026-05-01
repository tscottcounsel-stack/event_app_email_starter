from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user

router = APIRouter(prefix="/presence", tags=["presence"])

ACTIVE_WINDOW_SECONDS = 120
_PRESENCE: Dict[str, Dict[str, Any]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def _display_name(user: Dict[str, Any]) -> str:
    return (
        str(user.get("full_name") or "").strip()
        or str(user.get("business_name") or "").strip()
        or str(user.get("display_name") or "").strip()
        or str(user.get("email") or "").strip()
        or "Unknown user"
    )


def _require_admin(user: Dict[str, Any]) -> None:
    if _safe_lower(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _active_rows() -> list[Dict[str, Any]]:
    cutoff = _now() - timedelta(seconds=ACTIVE_WINDOW_SECONDS)
    active: list[Dict[str, Any]] = []

    for key, row in list(_PRESENCE.items()):
        last_seen = row.get("last_seen_dt")
        if not isinstance(last_seen, datetime):
            _PRESENCE.pop(key, None)
            continue
        if last_seen < cutoff:
            _PRESENCE.pop(key, None)
            continue

        active.append({
            "email": row.get("email"),
            "role": row.get("role"),
            "name": row.get("name"),
            "path": row.get("path") or "",
            "last_seen": last_seen.isoformat(),
        })

    active.sort(key=lambda item: str(item.get("last_seen") or ""), reverse=True)
    return active


@router.post("/ping")
def ping_presence(user: Dict[str, Any] = Depends(get_current_user)):
    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))

    if not email or role not in {"vendor", "organizer", "admin"}:
        return {"ok": False}

    key = f"{role}:{email}"
    now = _now()
    _PRESENCE[key] = {
        "email": email,
        "role": role,
        "name": _display_name(user),
        "last_seen_dt": now,
    }

    return {"ok": True, "active_window_seconds": ACTIVE_WINDOW_SECONDS}


@router.get("/active")
def get_active_presence(user: Dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    active = _active_rows()

    by_role: Dict[str, int] = {"vendor": 0, "organizer": 0, "admin": 0}
    for row in active:
        role = _safe_lower(row.get("role"))
        if role in by_role:
            by_role[role] += 1

    return {
        "ok": True,
        "count": len(active),
        "users": active,
        "by_role": by_role,
        "active_window_seconds": ACTIVE_WINDOW_SECONDS,
    }
