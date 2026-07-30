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
from app.routers.safety import block_user_pair, create_report_record
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

ALLOWED_REACTIONS = {"fire": "🔥", "love": "❤️", "clap": "👏", "eyes": "👀"}
ALLOWED_REACTION_VALUES = set(ALLOWED_REACTIONS.values())

# Anything containing one of these markers should never be placed into a public
# event-wall response. Legacy data previously allowed verification-document
# Cloudinary/S3 URLs to drift into public-facing media fields.
PRIVATE_PUBLIC_URL_MARKERS = (
    "verification-documents",
    "verification_documents",
    "verification_document",
    "identity_verification",
    "government_id",
    "certificate_of_insurance",
    "insurance_certificate",
    "business_license",
    "w9_document",
    "sales_tax_permit",
    "health_permit",
    "food_handler_permit",
    "legacy-profile-doc:",
    "view-url",
    "signed_url",
    "signedurl",
    "presigned",
    "x-amz-",
    "s3.amazonaws.com",
    "amazonaws.com/",
    "storage_key",
    "file_url",
    "fileurl",
)


class EventWallPostCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: str = ""
    image_url: str = ""


class EventWallPinPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pinned: bool = True


class EventWallReactionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reaction: str = ""


class EventWallReportPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str = "other"
    details: str = ""


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


def _is_private_public_url(value: Any) -> bool:
    raw = _safe_str(value)
    if not raw:
        return False
    lowered = raw.lower()
    return any(marker in lowered for marker in PRIVATE_PUBLIC_URL_MARKERS)


def _public_media_url(value: Any) -> str:
    """Return a safe public media URL or an empty string.

    This intentionally rejects verification-document paths, signed/S3 URLs,
    javascript/data URLs, and any non-http(s) URL. Event-wall media is public,
    so private file URLs must not be echoed back to browsers.
    """
    url = _safe_str(value)
    if not url:
        return ""

    lowered = url.lower()
    if not lowered.startswith(("https://", "http://")):
        return ""
    if lowered.startswith(("javascript:", "data:", "blob:")):
        return ""
    if _is_private_public_url(url):
        return ""
    if len(url) > 1500:
        return ""

    return url


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


def _first_non_empty(*values: Any) -> str:
    for value in values:
        text = _safe_str(value)
        if text:
            return text
    return ""


def _first_public_media_url(*values: Any) -> str:
    for value in values:
        url = _public_media_url(value)
        if url:
            return url
    return ""


def _first_list_value(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            text = _safe_str(item)
            if text:
                return text
    if isinstance(value, str):
        for part in value.split(","):
            text = _safe_str(part)
            if text:
                return text
    return ""


def _safe_categories(value: Any) -> List[str]:
    if isinstance(value, list):
        return [_safe_str(item)[:80] for item in value if _safe_str(item)][:12]
    if isinstance(value, str):
        return [_safe_str(part)[:80] for part in value.split(",") if _safe_str(part)][:12]
    return []


def _profile_for_user(db: Session, email: str, role: str) -> Dict[str, Any]:
    """Load only the fields needed to identify an event-wall author.

    The prior implementation returned **data from Profile.data. That was too
    broad for a public/social surface because Profile.data can contain private
    verification, subscription, or document metadata.
    """
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
    categories = row.categories or data.get("categories") or data.get("vendor_categories") or []

    return {
        "email": row.email,
        "role": row.role,
        "business_name": _safe_str(
            row.business_name
            or data.get("business_name")
            or data.get("businessName")
            or data.get("organizationName")
            or data.get("company_name")
        ),
        "businessName": _safe_str(
            row.business_name
            or data.get("businessName")
            or data.get("business_name")
            or data.get("organizationName")
            or data.get("company_name")
        ),
        "organizationName": _safe_str(data.get("organizationName")),
        "company_name": _safe_str(data.get("company_name")),
        "display_name": _safe_str(row.display_name or data.get("display_name") or data.get("contactName")),
        "contact_name": _safe_str(data.get("contact_name")),
        "contactName": _safe_str(data.get("contactName")),
        "categories": _safe_categories(categories),
        "vendor_categories": _safe_categories(data.get("vendor_categories") or categories),
        "category": _safe_str(data.get("category"))[:80],
        "vendor_category": _safe_str(data.get("vendor_category"))[:80],
        "business_category": _safe_str(data.get("business_category"))[:80],
        "business_type": _safe_str(data.get("business_type"))[:80],
        "verified": bool(row.verified),
        "is_verified": bool(row.verified),
        "verification_status": row.verification_status or data.get("verification_status") or "",
        "public_verification_status": row.public_verification_status or data.get("public_verification_status") or "",
        "review_status": row.review_status or data.get("review_status") or "",
        "logo_url": _first_public_media_url(
            data.get("logo_url"),
            data.get("logoUrl"),
            data.get("logo_data_url"),
            data.get("logoDataUrl"),
            data.get("avatar_url"),
            data.get("avatarUrl"),
        ),
        "logoUrl": _first_public_media_url(
            data.get("logoUrl"),
            data.get("logo_url"),
            data.get("logo_data_url"),
            data.get("logoDataUrl"),
            data.get("avatar_url"),
            data.get("avatarUrl"),
        ),
        "avatar_url": _first_public_media_url(data.get("avatar_url"), data.get("avatarUrl")),
        "avatarUrl": _first_public_media_url(data.get("avatarUrl"), data.get("avatar_url")),
    }


def _vendor_application_for_event(email: str, event_id: int) -> Dict[str, Any]:
    if not email:
        return {}

    matches: List[Dict[str, Any]] = []
    for app in (_APPLICATIONS or {}).values():
        if not isinstance(app, dict):
            continue

        app_email = _norm(app.get("vendor_email") or app.get("email"))
        app_event_id = _safe_str(app.get("event_id") or app.get("eventId"))

        if app_email == email and app_event_id == _safe_str(event_id):
            matches.append(app)

    if not matches:
        return {}

    def sort_key(item: Dict[str, Any]) -> str:
        return _safe_str(
            item.get("updated_at")
            or item.get("approved_at")
            or item.get("submitted_at")
            or item.get("created_at")
            or item.get("id")
        )

    matches.sort(key=sort_key, reverse=True)
    latest = dict(matches[0])

    # Return only public placement context. Do not pass application documents,
    # notes, payment data, or internal workflow status to a public wall post.
    return {
        "vendor_category": _safe_str(latest.get("vendor_category"))[:80],
        "category": _safe_str(latest.get("category"))[:80],
        "booth_label": _safe_str(latest.get("booth_label"))[:80],
        "boothLabel": _safe_str(latest.get("boothLabel"))[:80],
        "booth_number": _safe_str(latest.get("booth_number"))[:80],
        "boothNumber": _safe_str(latest.get("boothNumber"))[:80],
        "booth_id": _safe_str(latest.get("booth_id"))[:80],
        "boothId": _safe_str(latest.get("boothId"))[:80],
        "requested_booth_label": _safe_str(latest.get("requested_booth_label"))[:80],
        "requestedBoothLabel": _safe_str(latest.get("requestedBoothLabel"))[:80],
        "requested_booth_id": _safe_str(latest.get("requested_booth_id"))[:80],
        "requestedBoothId": _safe_str(latest.get("requestedBoothId"))[:80],
    }


def _author_payload(user: Dict[str, Any], db: Session, event_id: int) -> Dict[str, Any]:
    role = _norm(user.get("role") or "vendor")
    email = _norm(user.get("email") or user.get("sub"))
    full_name = _safe_str(user.get("full_name") or user.get("name") or user.get("display_name"))

    profile: Dict[str, Any] = {}
    if role == "vendor":
        # Legacy store data is no longer spread into the public author payload.
        # It can contain stale/private fields. Use it only as fallback for name/logo
        # after sanitizing exact fields.
        stored_vendor = _VENDORS.get(email) if email else None
        stored = dict(stored_vendor) if isinstance(stored_vendor, dict) else {}
        db_profile = _profile_for_user(db, email, "vendor")
        profile = {**stored, **db_profile}
    elif role == "organizer":
        profile = _profile_for_user(db, email, "organizer")

    app = _vendor_application_for_event(email, event_id) if role == "vendor" else {}

    author_name = _first_non_empty(
        profile.get("business_name"),
        profile.get("businessName"),
        profile.get("organizationName"),
        profile.get("company_name"),
        profile.get("display_name"),
        profile.get("contact_name"),
        profile.get("contactName"),
        full_name,
        "VendCore User",
    )[:120]

    author_logo_url = _first_public_media_url(
        profile.get("logo_url"),
        profile.get("logoUrl"),
        profile.get("logo_data_url"),
        profile.get("logoDataUrl"),
        profile.get("avatar_url"),
        profile.get("avatarUrl"),
    )

    author_category = _first_non_empty(
        app.get("vendor_category"),
        app.get("category"),
        profile.get("category"),
        profile.get("vendor_category"),
        profile.get("business_category"),
        profile.get("business_type"),
        _first_list_value(profile.get("categories") or profile.get("vendor_categories")),
    )[:80]

    booth_label = _first_non_empty(
        app.get("booth_label"),
        app.get("boothLabel"),
        app.get("booth_number"),
        app.get("boothNumber"),
        app.get("booth_id"),
        app.get("boothId"),
        app.get("requested_booth_label"),
        app.get("requestedBoothLabel"),
        app.get("requested_booth_id"),
        app.get("requestedBoothId"),
    )[:80]

    if role not in {"vendor", "organizer", "admin"}:
        role = "vendor"

    return {
        "author_name": author_name,
        # Keep author_email stored privately so delete permissions keep working.
        # _public_post strips it from every API response.
        "author_email": email,
        "author_role": role,
        "verified": _is_verified(profile),
        "author_logo_url": author_logo_url,
        "authorLogoUrl": author_logo_url,
        "author_category": author_category,
        "authorCategory": author_category,
        "author_booth_label": booth_label,
        "authorBoothLabel": booth_label,
    }


def _reaction_value(value: Any) -> str:
    raw = _safe_str(value)
    if raw in ALLOWED_REACTION_VALUES:
        return raw
    lowered = _norm(raw)
    return ALLOWED_REACTIONS.get(lowered, "")


def _reaction_user_key(user: Dict[str, Any]) -> str:
    email = _norm(user.get("email") or user.get("sub"))
    if email:
        return email
    uid = _safe_str(user.get("id") or user.get("user_id"))
    if uid:
        return f"user:{uid}"
    raise HTTPException(status_code=401, detail="Unable to resolve current user")


def _normalize_reactions(post: Dict[str, Any]) -> Dict[str, int]:
    raw_counts = post.get("reactions")
    raw_users = post.get("reaction_users")

    counts: Dict[str, int] = {emoji: 0 for emoji in ALLOWED_REACTION_VALUES}

    if isinstance(raw_users, dict):
        for emoji in ALLOWED_REACTION_VALUES:
            users = raw_users.get(emoji)
            if isinstance(users, list):
                counts[emoji] = len({str(user) for user in users if str(user).strip()})
    elif isinstance(raw_counts, dict):
        for key, value in raw_counts.items():
            emoji = _reaction_value(key)
            if not emoji:
                continue
            try:
                counts[emoji] = max(0, int(value or 0))
            except Exception:
                counts[emoji] = 0

    post["reactions"] = counts
    if not isinstance(raw_users, dict):
        post["reaction_users"] = {emoji: [] for emoji in ALLOWED_REACTION_VALUES}
    else:
        for emoji in ALLOWED_REACTION_VALUES:
            users = raw_users.get(emoji)
            raw_users[emoji] = list({str(user) for user in users if str(user).strip()}) if isinstance(users, list) else []
        post["reaction_users"] = raw_users

    return counts


def _public_post(post: Dict[str, Any]) -> Dict[str, Any]:
    """Whitelist event-wall response fields.

    Existing stored wall posts may contain author_email, pinned_by, reaction
    user IDs, or stale raw profile data. Never return a full dict(post) to a
    public wall response.
    """
    item = dict(post)
    _normalize_reactions(item)

    author_logo_url = _first_public_media_url(item.get("author_logo_url"), item.get("authorLogoUrl"))
    image_url = _public_media_url(item.get("image_url") or item.get("imageUrl"))

    public = {
        "id": _safe_str(item.get("id")),
        "event_id": item.get("event_id"),
        "eventId": item.get("event_id"),
        "author_name": _safe_str(item.get("author_name") or "VendCore User")[:120],
        "authorName": _safe_str(item.get("author_name") or "VendCore User")[:120],
        "author_role": _safe_str(item.get("author_role") or "vendor")[:40],
        "authorRole": _safe_str(item.get("author_role") or "vendor")[:40],
        "verified": bool(item.get("verified") is True),
        "author_logo_url": author_logo_url,
        "authorLogoUrl": author_logo_url,
        "author_category": _safe_str(item.get("author_category") or item.get("authorCategory"))[:80],
        "authorCategory": _safe_str(item.get("author_category") or item.get("authorCategory"))[:80],
        "author_booth_label": _safe_str(item.get("author_booth_label") or item.get("authorBoothLabel"))[:80],
        "authorBoothLabel": _safe_str(item.get("author_booth_label") or item.get("authorBoothLabel"))[:80],
        "message": _safe_str(item.get("message"))[:500],
        "image_url": image_url,
        "imageUrl": image_url,
        "pinned": bool(item.get("pinned") is True),
        "pinned_at": _safe_str(item.get("pinned_at")) or None,
        "pinnedAt": _safe_str(item.get("pinned_at")) or None,
        "reactions": item.get("reactions") if isinstance(item.get("reactions"), dict) else {},
        "created_at": _safe_str(item.get("created_at")) or None,
        "createdAt": _safe_str(item.get("created_at")) or None,
        "updated_at": _safe_str(item.get("updated_at")) or None,
        "updatedAt": _safe_str(item.get("updated_at")) or None,
    }
    return public


def _clean_posts(posts: List[Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    clean = [_public_post(post) for post in posts if isinstance(post, dict)]
    clean.sort(
        key=lambda post: (
            1 if bool(post.get("pinned")) else 0,
            str(post.get("pinned_at") or post.get("created_at") or ""),
            str(post.get("created_at") or ""),
        ),
        reverse=True,
    )
    return clean[: max(1, min(int(limit or 50), 100))]


def _find_wall_post(event_id: int, post_id: str) -> Dict[str, Any]:
    wall = get_event_wall(event_id)
    posts = wall.get("posts") if isinstance(wall.get("posts"), list) else []

    target: Optional[Dict[str, Any]] = next(
        (post for post in posts if str(post.get("id") or "") == str(post_id)),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Wall post not found")
    return target


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
        "allowed_reactions": list(ALLOWED_REACTION_VALUES),
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
    raw_image_url = _safe_str(payload.image_url)
    image_url = _public_media_url(raw_image_url)

    if raw_image_url and not image_url:
        raise HTTPException(status_code=400, detail="Image URL cannot be used on the public event wall")
    if not message and not image_url:
        raise HTTPException(status_code=400, detail="Message or image is required")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="Wall post must be 500 characters or fewer")

    author = _author_payload(user, db, int(event_id))
    post = {
        "id": uuid4().hex,
        "event_id": int(event_id),
        **author,
        "message": message,
        "image_url": image_url,
        "pinned": False,
        "reactions": {emoji: 0 for emoji in ALLOWED_REACTION_VALUES},
        "reaction_users": {emoji: [] for emoji in ALLOWED_REACTION_VALUES},
        "created_at": _now_iso(),
    }
    saved = append_event_wall_post(event_id, post)
    return {"ok": True, "post": _public_post(saved)}


@router.patch("/events/{event_id}/wall/{post_id}/pin")
def pin_event_wall_post(
    event_id: int,
    post_id: str,
    payload: EventWallPinPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = _norm(user.get("role"))
    email = _norm(user.get("email") or user.get("sub"))

    if role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Organizer or admin account required")

    if role == "organizer":
        event = _EVENTS.get(int(event_id)) if str(event_id).isdigit() else None
        organizer_email = ""
        if isinstance(event, dict):
            organizer_email = _norm(event.get("organizer_email") or event.get("owner_email") or event.get("email"))
        if organizer_email and organizer_email != email:
            raise HTTPException(status_code=403, detail="Only this event's organizer can pin wall posts")

    target = _find_wall_post(event_id, post_id)
    target["pinned"] = bool(payload.pinned)
    if payload.pinned:
        target["pinned_at"] = _now_iso()
        # Keep stored privately for moderation/auditing; _public_post strips it.
        target["pinned_by"] = email
    else:
        target.pop("pinned_at", None)
        target.pop("pinned_by", None)

    save_store()
    return {"ok": True, "post": _public_post(target)}


@router.post("/events/{event_id}/wall/{post_id}/react")
def toggle_event_wall_reaction(
    event_id: int,
    post_id: str,
    payload: EventWallReactionPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if not _event_exists(event_id):
        raise HTTPException(status_code=404, detail="Event not found")

    reaction = _reaction_value(payload.reaction)
    if not reaction:
        raise HTTPException(status_code=400, detail="Unsupported reaction")

    user_key = _reaction_user_key(user)
    target = _find_wall_post(event_id, post_id)
    _normalize_reactions(target)

    reaction_users = target.get("reaction_users")
    if not isinstance(reaction_users, dict):
        reaction_users = {emoji: [] for emoji in ALLOWED_REACTION_VALUES}
        target["reaction_users"] = reaction_users

    users = reaction_users.get(reaction)
    if not isinstance(users, list):
        users = []
        reaction_users[reaction] = users

    normalized_users = {str(item) for item in users if str(item).strip()}
    active = user_key in normalized_users

    if active:
        normalized_users.remove(user_key)
        active = False
    else:
        normalized_users.add(user_key)
        active = True

    reaction_users[reaction] = sorted(normalized_users)
    target["reactions"] = {
        emoji: len(reaction_users.get(emoji) or [])
        for emoji in ALLOWED_REACTION_VALUES
    }
    target["updated_at"] = _now_iso()

    save_store()

    return {
        "ok": True,
        "post_id": post_id,
        "reaction": reaction,
        "active": active,
        "reactions": target["reactions"],
        "post": _public_post(target),
    }


@router.post("/events/{event_id}/wall/{post_id}/report")
def report_event_wall_post(
    event_id: int,
    post_id: str,
    payload: EventWallReportPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    target = _find_wall_post(event_id, post_id)
    reporter_email = _norm(user.get("email") or user.get("sub"))
    author_email = _norm(target.get("author_email"))

    if author_email and author_email == reporter_email:
        raise HTTPException(status_code=400, detail="You cannot report your own wall post.")

    report = create_report_record(
        reporter_email=reporter_email,
        reporter_role=_norm(user.get("role")),
        target_email=author_email,
        context_type="event_wall_post",
        context_id=str(event_id),
        content_id=str(post_id),
        reason=payload.reason,
        details=payload.details,
    )
    return {"ok": True, "report": report}


@router.post("/events/{event_id}/wall/{post_id}/block-author")
def block_event_wall_author(
    event_id: int,
    post_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    target = _find_wall_post(event_id, post_id)
    blocker_email = _norm(user.get("email") or user.get("sub"))
    author_email = _norm(target.get("author_email"))

    if not author_email:
        raise HTTPException(status_code=400, detail="Unable to identify the wall-post author.")
    block_user_pair(blocker_email, author_email)
    return {"ok": True, "blocked": True}


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
        event = _EVENTS.get(int(event_id)) if str(event_id).isdigit() else None
        if isinstance(event, dict):
            organizer_email = _norm(event.get("organizer_email") or event.get("owner_email") or event.get("email"))
            can_delete = can_delete or (organizer_email and organizer_email == email)

    if not can_delete:
        raise HTTPException(status_code=403, detail="Not allowed to delete this wall post")

    ok = delete_event_wall_post(event_id, post_id)
    return {"ok": ok}
