from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import get_current_user
from app.store import (
    _EVENTS,
    _VENDORS,
    append_event_wall_post,
    delete_event_wall_post,
    get_event_wall,
    save_store,
)

router = APIRouter(tags=["Event Wall"])


class EventWallPostCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: str = ""
    image_url: str = ""


class EventWallPinUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pinned: bool = True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return _safe_str(value).lower()


def _event_exists(event_id: int) -> bool:
    try:
        return int(event_id) in _EVENTS or int(event_id) > 0
    except Exception:
        return False


def _is_verified(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    status = _norm(
        value.get("public_verification_status")
        or value.get("verification_status")
        or value.get("verificationStatus")
        or value.get("review_status")
        or value.get("reviewStatus")
    )
    return bool(
        value.get("verified") is True
        or value.get("is_verified") is True
        or status in {"verified", "approved", "complete", "expiring_soon"}
    )


def _profile_for_user(db: Session, email: str, role: str) -> Dict[str, Any]:
    if not email or role not in {"vendor", "organizer"}:
        return {}

    row = (
        db.query(Profile)
        .filter(Profile.role == role, func.lower(Profile.email) == email)
        .one_or_none()
    )
    if not row:
        return {}

    data = row.data if isinstance(row.data, dict) else {}
    return {
        **data,
        "email": row.email,
        "role": row.role,
        "business_name": row.business_name or data.get("business_name") or data.get("businessName") or "",
        "display_name": row.display_name or data.get("display_name") or data.get("contactName") or "",
        "verified": bool(row.verified),
        "verification_status": row.verification_status or data.get("verification_status") or "",
        "public_verification_status": row.public_verification_status or data.get("public_verification_status") or "",
        "review_status": row.review_status or data.get("review_status") or "",
    }


def _author_payload(user: Dict[str, Any], db: Session) -> Dict[str, Any]:
    role = _norm(user.get("role") or "vendor")
    email = _norm(user.get("email") or user.get("sub"))
    full_name = _safe_str(user.get("full_name") or user.get("name") or user.get("display_name"))

    profile: Dict[str, Any] = {}
    if role == "vendor":
        stored_vendor = _VENDORS.get(email) if email else None
        profile = dict(stored_vendor) if isinstance(stored_vendor, dict) else {}
        if not profile:
            profile = _profile_for_user(db, email, "vendor")
    elif role == "organizer":
        profile = _profile_for_user(db, email, "organizer")

    author_name = _safe_str(
        profile.get("business_name")
        or profile.get("businessName")
        or profile.get("organizationName")
        or profile.get("company_name")
        or profile.get("display_name")
        or profile.get("contact_name")
        or profile.get("contactName")
        or full_name
        or email
        or "VendCore User"
    )

    if role not in {"vendor", "organizer", "admin"}:
        role = "vendor"

    return {
        "author_name": author_name,
        "author_email": email,
        "author_role": role,
        "verified": _is_verified(profile),
    }


def _event_organizer_email(event_id: int) -> str:
    event = _EVENTS.get(int(event_id)) if str(event_id).isdigit() else None
    if not isinstance(event, dict):
        return ""
    return _norm(event.get("organizer_email") or event.get("owner_email") or event.get("email"))


def _can_manage_event_wall(event_id: int, user: Dict[str, Any]) -> bool:
    role = _norm(user.get("role"))
    email = _norm(user.get("email") or user.get("sub"))
    if role == "admin":
        return True
    if role != "organizer":
        return False
    organizer_email = _event_organizer_email(event_id)
    # Some older store records may not have owner metadata; still allow organizer role
    # to pin/unpin so the feature remains usable on legacy test events.
    return not organizer_email or organizer_email == email


def _clean_posts(posts: List[Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    clean = [dict(post) for post in posts if isinstance(post, dict)]
    clean.sort(
        key=lambda post: (
            1 if bool(post.get("pinned")) else 0,
            str(post.get("pinned_at") or post.get("created_at") or ""),
        ),
        reverse=True,
    )
    return clean[: max(1, min(int(limit or 50), 100))]


@router.get("/events/{event_id}/wall")
def read_event_wall(event_id: int, limit: int = Query(50, ge=1, le=100)):
    if not _event_exists(event_id):
        raise HTTPException(status_code=404, detail="Event not found")

    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []
    return {
        "ok": True,
        "event_id": int(event_id),
        "posts": _clean_posts(posts, limit),
        "count": len(posts),
    }


@router.post("/events/{event_id}/wall")
def create_event_wall_post(
    event_id: int,
    payload: EventWallPostCreate,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _event_exists(event_id):
        raise HTTPException(status_code=404, detail="Event not found")

    role = _norm(user.get("role"))
    if role not in {"vendor", "organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Vendor, organizer, or admin account required")

    message = _safe_str(payload.message)
    image_url = _safe_str(payload.image_url)

    if not message and not image_url:
        raise HTTPException(status_code=400, detail="Message or image is required")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="Wall post must be 500 characters or fewer")
    if image_url and not image_url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Image URL must be a valid public URL")

    author = _author_payload(user, db)
    post = {
        "id": uuid4().hex,
        "event_id": int(event_id),
        **author,
        "message": message,
        "image_url": image_url,
        "pinned": False,
        "pinned_at": "",
        "pinned_by": "",
        "created_at": _now_iso(),
    }
    saved = append_event_wall_post(event_id, post)
    return {"ok": True, "post": saved}


@router.patch("/events/{event_id}/wall/{post_id}/pin")
def update_event_wall_pin(
    event_id: int,
    post_id: str,
    payload: EventWallPinUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if not _event_exists(event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    if not _can_manage_event_wall(event_id, user):
        raise HTTPException(status_code=403, detail="Only this event organizer or an admin can pin wall posts")

    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []
    target: Optional[Dict[str, Any]] = next(
        (post for post in posts if str(post.get("id") or "") == str(post_id)),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Wall post not found")

    if bool(payload.pinned):
        target["pinned"] = True
        target["pinned_at"] = _now_iso()
        target["pinned_by"] = _norm(user.get("email") or user.get("sub"))
    else:
        target["pinned"] = False
        target["pinned_at"] = ""
        target["pinned_by"] = ""

    save_store()
    return {"ok": True, "post": dict(target)}


@router.delete("/events/{event_id}/wall/{post_id}")
def remove_event_wall_post(
    event_id: int,
    post_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = _norm(user.get("role"))
    email = _norm(user.get("email") or user.get("sub"))

    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []
    target: Optional[Dict[str, Any]] = next(
        (post for post in posts if str(post.get("id") or "") == str(post_id)),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Wall post not found")

    can_delete = role == "admin" or _norm(target.get("author_email")) == email
    if role == "organizer":
        organizer_email = _event_organizer_email(event_id)
        can_delete = can_delete or (organizer_email and organizer_email == email)

    if not can_delete:
        raise HTTPException(status_code=403, detail="Not allowed to delete this wall post")

    ok = delete_event_wall_post(event_id, post_id)
    return {"ok": ok}
