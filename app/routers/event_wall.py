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
    _APPLICATIONS,
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


class EventWallReactionUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reaction: str


_ALLOWED_REACTIONS = {"fire", "love", "clap", "eyes"}


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


def _first_list_value(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            text = _safe_str(item)
            if text:
                return text
        return ""
    if isinstance(value, str):
        raw = _safe_str(value)
        if not raw:
            return ""
        for part in raw.replace("|", ",").replace(";", ",").split(","):
            text = _safe_str(part)
            if text:
                return text
    return ""


def _pick_first(*values: Any) -> str:
    for value in values:
        text = _safe_str(value)
        if text:
            return text
    return ""


def _short_booth_label(value: Any) -> str:
    text = _safe_str(value)
    if not text:
        return ""
    if len(text) <= 20:
        return text
    parts = [part for part in text.split("-") if part]
    if len(parts) >= 2:
        return "-".join(parts[-2:])[:20]
    return text[-20:]


def _vendor_event_identity(event_id: int, email: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    category = _pick_first(
        _first_list_value(profile.get("categories")),
        _first_list_value(profile.get("vendor_categories")),
        profile.get("category"),
        profile.get("vendor_category"),
        profile.get("business_category"),
        profile.get("business_type"),
    )

    logo_url = _pick_first(
        profile.get("logo_url"),
        profile.get("logoUrl"),
        profile.get("logo_data_url"),
        profile.get("logoDataUrl"),
        profile.get("avatar_url"),
        profile.get("avatarUrl"),
    )

    booth_label = ""
    booth_id = ""

    for app in (_APPLICATIONS or {}).values():
        if not isinstance(app, dict):
            continue
        try:
            app_event_id = int(app.get("event_id") or app.get("eventId") or 0)
        except Exception:
            continue
        if app_event_id != int(event_id):
            continue

        app_vendor_email = _norm(app.get("vendor_email") or app.get("email") or app.get("vendorEmail"))
        app_vendor_id = _norm(app.get("vendor_id") or app.get("vendorId"))
        if email and email not in {app_vendor_email, app_vendor_id}:
            continue

        booth_label = _pick_first(
            app.get("booth_label"),
            app.get("boothLabel"),
            app.get("booth_number"),
            app.get("boothNumber"),
            app.get("requested_booth_label"),
            app.get("requestedBoothLabel"),
        )
        booth_id = _pick_first(
            app.get("booth_id"),
            app.get("boothId"),
            app.get("requested_booth_id"),
            app.get("requestedBoothId"),
        )
        if not booth_label:
            booth_label = _short_booth_label(booth_id)

        app_category = _pick_first(
            _first_list_value(app.get("vendor_categories")),
            app.get("vendor_category"),
            app.get("category"),
            app.get("requested_booth_category"),
            app.get("requestedBoothCategory"),
        )
        if app_category:
            category = app_category
        break

    return {
        "author_logo_url": logo_url,
        "author_category": category,
        "author_booth_label": booth_label,
        "author_booth_id": booth_id,
    }


def _organizer_identity(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "author_logo_url": _pick_first(
            profile.get("logo_url"),
            profile.get("logoUrl"),
            profile.get("logoDataUrl"),
            profile.get("logo_data_url"),
            profile.get("banner_url"),
            profile.get("bannerUrl"),
        ),
        "author_category": _pick_first(
            profile.get("organizationType"),
            profile.get("organization_type"),
            _first_list_value(profile.get("organizer_categories")),
            _first_list_value(profile.get("categories")),
        ),
        "author_booth_label": "",
        "author_booth_id": "",
    }


def _author_payload(user: Dict[str, Any], db: Session, event_id: int) -> Dict[str, Any]:
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

    identity = _vendor_event_identity(event_id, email, profile) if role == "vendor" else _organizer_identity(profile)

    return {
        "author_name": author_name,
        "author_email": email,
        "author_role": role,
        "verified": _is_verified(profile),
        **identity,
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



def _reaction_counts(post: Dict[str, Any]) -> Dict[str, int]:
    reactions = post.get("reactions_by_user")
    counts = {key: 0 for key in _ALLOWED_REACTIONS}
    if not isinstance(reactions, dict):
        return counts

    for values in reactions.values():
        if isinstance(values, list):
            for value in values:
                key = _norm(value)
                if key in counts:
                    counts[key] += 1
    return counts


def _public_post(post: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(post or {})
    out["reaction_counts"] = _reaction_counts(out)
    out.pop("reactions_by_user", None)
    return out


def _update_wall_post(event_id: int, post_id: str, updated_post: Dict[str, Any]) -> Dict[str, Any]:
    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []
    for index, post in enumerate(posts):
        if str(post.get("id") or "") == str(post_id):
            posts[index] = updated_post
            wall["posts"] = posts
            save_store()
            return updated_post
    raise HTTPException(status_code=404, detail="Wall post not found")

def _clean_posts(posts: List[Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    clean = [dict(post) for post in posts if isinstance(post, dict)]
    clean.sort(
        key=lambda post: (
            1 if bool(post.get("pinned")) else 0,
            str(post.get("pinned_at") or post.get("created_at") or ""),
        ),
        reverse=True,
    )
    return [_public_post(post) for post in clean[: max(1, min(int(limit or 50), 100))]]


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

    author = _author_payload(user, db, event_id)
    post = {
        "id": uuid4().hex,
        "event_id": int(event_id),
        **author,
        "message": message,
        "image_url": image_url,
        "pinned": False,
        "pinned_at": "",
        "pinned_by": "",
        "reactions_by_user": {},
        "created_at": _now_iso(),
    }
    saved = append_event_wall_post(event_id, post)
    return {"ok": True, "post": _public_post(saved)}


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
    return {"ok": True, "post": _public_post(dict(target))}


@router.patch("/events/{event_id}/wall/{post_id}/reaction")
def update_event_wall_reaction(
    event_id: int,
    post_id: str,
    payload: EventWallReactionUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if not _event_exists(event_id):
        raise HTTPException(status_code=404, detail="Event not found")

    reaction = _norm(payload.reaction)
    if reaction not in _ALLOWED_REACTIONS:
        raise HTTPException(status_code=400, detail="Unsupported reaction")

    role = _norm(user.get("role"))
    if role not in {"vendor", "organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Vendor, organizer, or admin account required")

    email = _norm(user.get("email") or user.get("sub"))
    if not email:
        raise HTTPException(status_code=401, detail="Unable to identify user")

    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []
    target: Optional[Dict[str, Any]] = next(
        (post for post in posts if str(post.get("id") or "") == str(post_id)),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Wall post not found")

    reactions_by_user = target.get("reactions_by_user")
    if not isinstance(reactions_by_user, dict):
        reactions_by_user = {}

    current = reactions_by_user.get(email)
    current_list = [str(item).strip().lower() for item in current] if isinstance(current, list) else []

    if reaction in current_list:
        current_list = [item for item in current_list if item != reaction]
    else:
        current_list.append(reaction)

    if current_list:
        reactions_by_user[email] = sorted(set(current_list))
    else:
        reactions_by_user.pop(email, None)

    target["reactions_by_user"] = reactions_by_user
    target["updated_at"] = _now_iso()
    updated = _update_wall_post(event_id, post_id, target)
    return {"ok": True, "post": _public_post(updated)}


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
