from __future__ import annotations

import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.permissions import require_event_limit
from app.db import get_db
from app.models.event import Event
from app.models.profile import Profile, EventAlert
from app.routers.applications import _APPLICATIONS, expire_reservations_if_needed
from app.routers.auth import get_current_user
from app.store import _EVENTS, _PAYMENTS, _REQUIREMENTS, get_store_snapshot, save_store

logger = logging.getLogger(__name__)
logger.warning("🔥 app.routers.events loaded (postgres)")

router = APIRouter(tags=["Events"])

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}


def _sanitize_upload_filename(filename: str) -> str:
    original = os.path.basename(str(filename or "").strip())
    stem, ext = os.path.splitext(original)
    ext = ext.lower()

    if ext not in _ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("._-")
    if not safe_stem:
        safe_stem = "image"

    return f"{safe_stem}-{uuid4().hex[:12]}{ext}"


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1)
    description: Optional[str] = None

    # Accept strings as well as datetimes so <input type="date"> values (YYYY-MM-DD) do not fail validation.
    start_date: Optional[Any] = None
    end_date: Optional[Any] = None

    venue_name: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

    ticket_sales_url: Optional[str] = None
    google_maps_url: Optional[str] = None
    category: Optional[str] = None

    heroImageUrl: Optional[str] = None
    imageUrls: Optional[list[str]] = None
    videoUrls: Optional[list[str]] = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _dt_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except Exception:
        return str(value)


def _coerce_event_datetime(value: Any) -> Optional[datetime]:
    """Normalize event date inputs before writing to the DB.

    Frontend date inputs commonly send YYYY-MM-DD. The database column is a
    timezone-aware DateTime, so convert date-only strings to midnight UTC.
    Also accepts ISO datetime strings and existing datetime objects.
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    text = str(value).strip()
    if not text:
        return None

    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)

        normalized = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        logger.warning("Unable to parse event datetime value: %r", value)
        return None


def _event_owner_email(event: Dict[str, Any]) -> str:
    return _norm_email(
        event.get("organizer_email") or event.get("owner_email") or event.get("email")
    )


def _event_owner_id(event: Dict[str, Any]) -> Optional[str]:
    raw = event.get("organizer_id") or event.get("owner_id") or event.get("created_by")
    return None if raw is None else str(raw)


def _is_admin_user(user: Optional[Dict[str, Any]]) -> bool:
    return str((user or {}).get("role") or "").strip().lower() == "admin"


def _event_belongs_to_user(event: Dict[str, Any], user: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(event, dict) or not isinstance(user, dict):
        return False

    if _is_admin_user(user):
        return True

    user_email = _norm_email(user.get("email"))
    user_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    owner_email = _event_owner_email(event)
    owner_id = _event_owner_id(event)

    if user_email and owner_email and owner_email == user_email:
        return True

    if user_id is not None and owner_id is not None and str(user_id) == owner_id:
        return True

    return False


def _serialize_event_model(ev: Event) -> Dict[str, Any]:
    return {
        "id": ev.id,
        "title": ev.title,
        "description": ev.description,
        "start_date": _dt_to_iso(ev.start_date),
        "end_date": _dt_to_iso(ev.end_date),
        "venue_name": ev.venue_name,
        "street_address": ev.street_address,
        "city": ev.city,
        "state": ev.state,
        "zip_code": ev.zip_code,
        "ticket_sales_url": ev.ticket_sales_url,
        "google_maps_url": ev.google_maps_url,
        "category": ev.category,
        "heroImageUrl": ev.hero_image_url,
        "imageUrls": list(ev.image_urls or []),
        "videoUrls": list(ev.video_urls or []),
        "published": bool(ev.published),
        "archived": bool(ev.archived),
        "requirements_published": bool(ev.requirements_published),
        "layout_published": bool(ev.layout_published),
        "organizer_email": ev.organizer_email,
        "owner_email": ev.owner_email,
        "organizer_id": ev.organizer_id,
        "owner_id": ev.owner_id,
        "created_by": ev.created_by,
        "created_at": _dt_to_iso(ev.created_at),
        "updated_at": _dt_to_iso(ev.updated_at),
    }


def _event_organizer_display_name(user: Optional[Dict[str, Any]], event_data: Optional[Dict[str, Any]] = None) -> str:
    event_data = event_data or {}
    user = user or {}

    return str(
        event_data.get("organizer_name")
        or event_data.get("company_name")
        or event_data.get("host_name")
        or user.get("company_name")
        or user.get("organizer_name")
        or user.get("name")
        or user.get("full_name")
        or user.get("display_name")
        or user.get("email")
        or "Organizer"
    ).strip()


def _sync_event_to_store(event_data: Dict[str, Any], user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    event_id = int(event_data.get("id") or 0)
    if not event_id:
        return event_data

    existing = _EVENTS.get(event_id, {}) if isinstance(_EVENTS.get(event_id), dict) else {}
    merged = {
        **existing,
        **dict(event_data or {}),
    }

    organizer_name = _event_organizer_display_name(user, merged)
    merged["organizer_name"] = organizer_name
    merged.setdefault("company_name", organizer_name)
    merged.setdefault("host_name", organizer_name)

    title = _clean_event_title(
        merged.get("title"),
        merged.get("name"),
        merged.get("event_title"),
        event_id=event_id,
    )
    merged["title"] = title
    merged["name"] = title
    merged["event_title"] = title

    organizer_email = _norm_email(
        merged.get("organizer_email")
        or merged.get("owner_email")
        or (user or {}).get("email")
    )
    if organizer_email:
        merged["organizer_email"] = organizer_email
        merged.setdefault("owner_email", organizer_email)
        merged.setdefault("email", organizer_email)

    organizer_id = (
        merged.get("organizer_id")
        or merged.get("owner_id")
        or merged.get("created_by")
        or (user or {}).get("organizer_id")
        or (user or {}).get("id")
        or (user or {}).get("sub")
    )
    if organizer_id is not None:
        organizer_id = str(organizer_id)
        merged["organizer_id"] = organizer_id
        merged.setdefault("owner_id", organizer_id)
        merged.setdefault("created_by", organizer_id)

    _EVENTS[event_id] = merged
    save_store()
    return merged


def _remove_event_from_store(event_id: int) -> None:
    _EVENTS.pop(int(event_id), None)
    save_store()


def _owned_events_for_user(db: Session, user: Dict[str, Any]) -> list[Event]:
    rows = db.query(Event).order_by(Event.id.desc()).all()
    return [row for row in rows if _event_belongs_to_user(_serialize_event_model(row), user)]


def _get_event_row_or_404(db: Session, event_id: int) -> Event:
    ev = db.query(Event).filter(Event.id == int(event_id)).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _get_owned_event_or_404(db: Session, event_id: int, user: Dict[str, Any]) -> Event:
    ev = _get_event_row_or_404(db, event_id)
    if not _event_belongs_to_user(_serialize_event_model(ev), user):
        raise HTTPException(status_code=403, detail="Not allowed to access this event.")
    return ev


def _apply_event_patch_model(ev: Event, patch: Dict[str, Any]) -> Event:
    alias_map = {
        "heroImageUrl": "hero_image_url",
        "imageUrls": "image_urls",
        "videoUrls": "video_urls",
    }

    for key, value in patch.items():
        attr = alias_map.get(key, key)
        if attr in ("image_urls", "video_urls"):
            setattr(ev, attr, list(value or []))
        elif attr in ("start_date", "end_date"):
            setattr(ev, attr, _coerce_event_datetime(value))
        elif hasattr(ev, attr):
            setattr(ev, attr, value)

    return ev


def _safe_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        s = str(value).strip().replace("$", "").replace(",", "")
        return float(s or 0)
    except Exception:
        return 0.0


def _is_bad_event_title(value: Any) -> bool:
    text = str(value or "").strip()
    return not text or text.lower() in {"untitled", "untitled event", "none", "null"}


def _clean_event_title(*values: Any, event_id: Any = None) -> str:
    for value in values:
        text = str(value or "").strip()
        if text and not _is_bad_event_title(text):
            return text

    event_id_text = str(event_id or "").strip()
    return f"Event #{event_id_text}" if event_id_text else "Event"


def _lookup_event_title_from_db(db: Session, event_id: Any) -> str:
    try:
        eid = int(event_id or 0)
    except Exception:
        return ""

    if not eid:
        return ""

    try:
        row = db.query(Event).filter(Event.id == eid).first()
        return str(getattr(row, "title", "") or "").strip() if row else ""
    except Exception:
        return ""


def _coerce_payment_status(value: Any) -> str:
    s = str(value or "").strip().lower()
    if not s:
        return ""
    if s in {"paid", "complete", "completed", "succeeded", "success"}:
        return "paid"
    if s in {"pending", "processing", "in_progress"}:
        return "pending"
    if s in {"unpaid", "failed", "declined", "canceled", "cancelled"}:
        return "unpaid"
    return s


def _event_marketplace_stats(event: dict, applications: dict) -> dict:
    event_id = int(event.get("id") or 0)
    total_booths = 0
    paid_booths = sum(
        1
        for app in applications.values()
        if app.get("event_id") == event_id and _coerce_payment_status(app.get("payment_status")) == "paid"
    )
    spots_left = max(total_booths - paid_booths, 0)

    return {
        "booths_from_price": None,
        "total_booths": total_booths,
        "paid_booths": paid_booths,
        "spots_left": spots_left,
    }


# ---------------- Vendor matching alerts ----------------

_ALERTABLE_PLAN_TOKENS = ("premium", "pro", "growth", "enterprise")
_ACTIVE_SUBSCRIPTION_STATUSES = ("active", "trialing", "paid")


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _split_category_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_split_category_values(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for key, raw in value.items():
            if isinstance(raw, dict):
                # Requirement category buckets often use the category name as the key.
                out.append(str(key))
            else:
                out.extend(_split_category_values(raw))
        return out
    raw = str(value or "").strip()
    if not raw:
        return []
    parts = re.split(r"[,;/|]+", raw)
    return [part.strip() for part in parts if part.strip()]


def _category_slug(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    aliases = {
        "food": "food_beverage",
        "food_and_beverage": "food_beverage",
        "food_beverage": "food_beverage",
        "food_beverages": "food_beverage",
        "technology": "tech",
        "technology_electronics": "tech",
        "technology_and_electronics": "tech",
        "arts": "art",
        "arts_crafts": "art",
        "arts_and_crafts": "art",
        "professional_services": "services",
        "service": "services",
    }
    return aliases.get(text, text)


def _unique_categories(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        for item in _split_category_values(value):
            slug = _category_slug(item)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            out.append(str(item).strip())
    return out


def _event_alert_categories(event_data: Dict[str, Any]) -> list[str]:
    values: list[Any] = [
        event_data.get("category"),
        event_data.get("categories"),
        event_data.get("vendor_categories"),
        event_data.get("vendor_category"),
    ]

    # Requirements are where organizers define vendor categories for the event.
    try:
        req = _REQUIREMENTS.get(int(event_data.get("id") or 0)) or {}
        req_root = req.get("requirements") if isinstance(req, dict) else {}
        req_root = req_root if isinstance(req_root, dict) else req
        if isinstance(req_root, dict):
            values.append(req_root.get("categories"))
            values.append(req_root.get("categoryRequirements"))
            values.append(req_root.get("category_requirements"))
    except Exception:
        pass

    return _unique_categories(values)


def _profile_is_alert_eligible_vendor(profile: Profile) -> bool:
    data = dict(profile.data or {})
    visibility = _safe_text(profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier")).lower()
    plan = _safe_text(profile.subscription_plan or data.get("subscription_plan") or data.get("subscriptionPlan") or data.get("plan")).lower()
    status = _safe_text(profile.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus")).lower()
    return bool(
        visibility == "premium"
        or profile.featured
        or profile.promoted
        or (any(token in plan for token in _ALERTABLE_PLAN_TOKENS) and status in _ACTIVE_SUBSCRIPTION_STATUSES)
    )


def _profile_categories(profile: Profile) -> list[str]:
    data = dict(profile.data or {})
    return _unique_categories([
        profile.categories,
        data.get("categories"),
        data.get("vendor_categories"),
        data.get("category"),
        data.get("vendor_category"),
        data.get("business_category"),
        data.get("business_type"),
    ])


def _create_vendor_event_alerts(db: Session, event_data: Dict[str, Any]) -> int:
    """Create in-app alerts for Premium vendors whose categories match a newly published event."""
    event_id = int(event_data.get("id") or 0)
    if not event_id:
        return 0

    event_categories = _event_alert_categories(event_data)
    event_slugs = {_category_slug(category) for category in event_categories if _category_slug(category)}
    if not event_slugs:
        return 0

    rows = db.query(Profile).filter(Profile.role == "vendor").all()
    created = 0
    title = _clean_event_title(event_data.get("title"), event_data.get("name"), event_id=event_id)
    city = _safe_text(event_data.get("city"))
    state = _safe_text(event_data.get("state"))
    location = ", ".join([part for part in [city, state] if part])

    for vendor in rows:
        email = _norm_email(vendor.email)
        if not email or not _profile_is_alert_eligible_vendor(vendor):
            continue

        vendor_categories = _profile_categories(vendor)
        matching = [category for category in vendor_categories if _category_slug(category) in event_slugs]
        if not matching:
            continue

        for category in matching:
            category_label = _safe_text(category) or "your category"
            existing = (
                db.query(EventAlert)
                .filter(
                    func.lower(EventAlert.vendor_email) == email,
                    EventAlert.event_id == event_id,
                    func.lower(EventAlert.category) == category_label.lower(),
                )
                .one_or_none()
            )
            if existing:
                continue

            where = f" in {location}" if location else ""
            alert = EventAlert(
                vendor_email=email,
                vendor_profile_id=vendor.id,
                event_id=event_id,
                event_title=title,
                event_city=city or None,
                event_state=state or None,
                category=category_label,
                alert_type="new_matching_event",
                message=f"New {category_label} opportunity: {title}{where}.",
                read=False,
                data={
                    "event_id": event_id,
                    "event_title": title,
                    "category": category_label,
                    "city": city,
                    "state": state,
                    "source": "event_publish",
                },
            )
            db.add(alert)
            created += 1

    if created:
        db.commit()
    return created


@router.get("/invites/{invite_id}")
def get_invite(invite_id: str, db: Session = Depends(get_db)):
    """Resolve a public vendor invite link into event data.

    Current MVP invite links are generated client-side and only carry a short invite id.
    Until invite records are stored server-side, this endpoint returns the most recent
    published, non-archived event so the invite page can render a real event landing page
    instead of an expired/invalid state.

    Later, replace this fallback with a persisted invite table/store that maps:
    invite_id -> event_id -> organizer_id/contact campaign.
    """
    invite = str(invite_id or "").strip()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")

    event = (
        db.query(Event)
        .filter(Event.published == True)  # noqa: E712
        .filter(Event.archived == False)  # noqa: E712
        .order_by(Event.id.desc())
        .first()
    )

    if not event:
        raise HTTPException(status_code=404, detail="Invite not found")

    event_data = _serialize_event_model(event)
    event_data.update(_event_marketplace_stats(event_data, _APPLICATIONS))

    return {
        "ok": True,
        "invite_id": invite,
        "event": event_data,
    }


@router.get("/events")
async def get_events(db: Session = Depends(get_db)):
    rows = db.query(Event).order_by(Event.id.desc()).all()

    result = []
    for row in rows:
        event_dict = _serialize_event_model(row)
        event_dict.update(_event_marketplace_stats(event_dict, _APPLICATIONS))
        result.append(event_dict)

    return result


@router.get("/organizer/events")
def organizer_list_events(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"events": [_serialize_event_model(ev) for ev in _owned_events_for_user(db, user)]}


@router.post("/organizer/events")
def organizer_create_event(
    payload: EventCreate,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    organizer_email = _norm_email(user.get("email"))
    if not organizer_email:
        raise HTTPException(status_code=401, detail="Authenticated user email missing")

    existing_event_count = len(_owned_events_for_user(db, user))
    require_event_limit(user, existing_event_count)

    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")
    organizer_id_str = None if organizer_id is None else str(organizer_id)

    event = Event(
        title=payload.title,
        description=payload.description,
        start_date=_coerce_event_datetime(payload.start_date),
        end_date=_coerce_event_datetime(payload.end_date),
        venue_name=payload.venue_name,
        street_address=payload.street_address,
        city=payload.city,
        state=payload.state,
        zip_code=payload.zip_code,
        ticket_sales_url=payload.ticket_sales_url,
        google_maps_url=payload.google_maps_url,
        category=payload.category,
        hero_image_url=payload.heroImageUrl,
        image_urls=list(payload.imageUrls or []),
        video_urls=list(payload.videoUrls or []),
        published=False,
        archived=False,
        requirements_published=False,
        layout_published=False,
        organizer_email=organizer_email,
        owner_email=organizer_email,
        organizer_id=organizer_id_str,
        owner_id=organizer_id_str,
        created_by=organizer_id_str,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    serialized = _serialize_event_model(event)
    _sync_event_to_store(serialized, user)
    return serialized


@router.get("/organizer/events/{event_id}")
def organizer_get_event(
    event_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _serialize_event_model(_get_owned_event_or_404(db, event_id, user))


@router.patch("/organizer/events/{event_id}")
def organizer_patch_event(
    event_id: int,
    payload: Dict[str, Any] = Body(default={}),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    was_published = bool(ev.published)
    _apply_event_patch_model(ev, dict(payload or {}))
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    _sync_event_to_store(serialized, user)
    if bool(ev.published) and not was_published:
        _create_vendor_event_alerts(db, serialized)
    return serialized


@router.delete("/organizer/events/{event_id}")
def organizer_delete_event(
    event_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    eid = int(event_id)
    db.delete(ev)
    db.commit()

    _REQUIREMENTS.pop(eid, None)
    _remove_event_from_store(eid)
    save_store()
    return {"ok": True}


@router.post("/organizer/events/{event_id}/publish")
def organizer_publish_event(
    event_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    was_published = bool(ev.published)
    ev.published = True
    ev.archived = False
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    _sync_event_to_store(serialized, user)
    if not was_published:
        _create_vendor_event_alerts(db, serialized)
    return serialized


@router.get("/organizer/earnings")
def organizer_earnings(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    store = get_store_snapshot()
    events = store.get("events", {}) or {}
    payments = store.get("payments", {}) or {}

    if not isinstance(events, dict):
        events = {}
    if not isinstance(payments, dict):
        payments = {}

    owned_event_ids = {int(ev.id or 0) for ev in _owned_events_for_user(db, user)}

    gross_sales = 0.0
    platform_fees = 0.0
    net_earnings = 0.0
    payouts_paid = 0.0
    payouts_owed = 0.0

    event_totals: Dict[int, Dict[str, Any]] = {}

    payout_rows: list[Dict[str, Any]] = []

    for payment_key, payment in payments.items():
        if not isinstance(payment, dict):
            continue
        if str(payment.get("status", "")).lower() != "paid":
            continue

        event_id = int(payment.get("event_id") or 0)
        event_row = events.get(str(event_id)) or events.get(event_id) or {}

        payment_email = _norm_email(
            payment.get("organizer_email")
            or (event_row or {}).get("organizer_email")
            or (event_row or {}).get("owner_email")
        )
        payment_owner_id = (
            payment.get("organizer_id")
            or (event_row or {}).get("organizer_id")
            or (event_row or {}).get("owner_id")
            or (event_row or {}).get("created_by")
        )

        payment_belongs = event_id in owned_event_ids or _event_belongs_to_user(
            {"organizer_email": payment_email, "organizer_id": payment_owner_id},
            user,
        )
        if not payment_belongs:
            continue

        amount = float(payment.get("amount") or 0)
        fee = float(payment.get("platform_fee") or 0)
        payout = float(payment.get("organizer_payout") or 0)
        payout_status = str(payment.get("payout_status") or "unpaid").strip().lower()

        gross_sales += amount
        platform_fees += fee
        net_earnings += payout

        if payout_status == "paid":
            payouts_paid += payout
        else:
            payouts_owed += payout

        db_event_title = _lookup_event_title_from_db(db, event_id)
        title = _clean_event_title(
            db_event_title,
            (event_row or {}).get("title"),
            (event_row or {}).get("event_title"),
            (event_row or {}).get("name"),
            payment.get("event_title"),
            event_id=event_id,
        )

        try:
            payment_id = int(payment_key)
        except Exception:
            try:
                payment_id = int(payment.get("id") or 0)
            except Exception:
                payment_id = 0

        payout_rows.append({
            "payment_id": payment_id,
            "event_id": event_id,
            "event_title": title,
            "application_id": payment.get("application_id"),
            "vendor_name": payment.get("vendor_name"),
            "vendor_email": payment.get("vendor_email"),
            "amount": round(amount, 2),
            "platform_fee": round(fee, 2),
            "organizer_payout": round(payout, 2),
            "payout_status": payout_status or "unpaid",
            "payout_sent_at": payment.get("payout_sent_at"),
            "paid_at": payment.get("paid_at") or payment.get("updated_at") or payment.get("created_at"),
        })

        if event_id not in event_totals:
            event_totals[event_id] = {
                "event_id": event_id,
                "event_title": title,
                "gross_sales": 0.0,
                "platform_fees": 0.0,
                "net_earnings": 0.0,
                "payouts_paid": 0.0,
                "payouts_owed": 0.0,
                "payout_status_counts": {"paid": 0, "unpaid": 0},
            }

        event_totals[event_id]["gross_sales"] += amount
        event_totals[event_id]["platform_fees"] += fee
        event_totals[event_id]["net_earnings"] += payout

        if payout_status == "paid":
            event_totals[event_id]["payouts_paid"] += payout
            event_totals[event_id]["payout_status_counts"]["paid"] += 1
        else:
            event_totals[event_id]["payouts_owed"] += payout
            event_totals[event_id]["payout_status_counts"]["unpaid"] += 1

    event_rows = []
    for row in event_totals.values():
        row["gross_sales"] = round(float(row["gross_sales"]), 2)
        row["platform_fees"] = round(float(row["platform_fees"]), 2)
        row["net_earnings"] = round(float(row["net_earnings"]), 2)
        row["payouts_paid"] = round(float(row["payouts_paid"]), 2)
        row["payouts_owed"] = round(float(row["payouts_owed"]), 2)
        event_rows.append(row)

    event_rows.sort(
        key=lambda row: (
            float(row.get("net_earnings") or 0),
            str(row.get("event_title") or ""),
        ),
        reverse=True,
    )

    payout_rows.sort(
        key=lambda row: (
            str(row.get("payout_status") or "") != "unpaid",
            str(row.get("paid_at") or ""),
            int(row.get("payment_id") or 0),
        ),
        reverse=True,
    )

    return {
        "summary": {
            "gross_sales": round(gross_sales, 2),
            "platform_fees": round(platform_fees, 2),
            "net_earnings": round(net_earnings, 2),
            "payouts_paid": round(payouts_paid, 2),
            "payouts_owed": round(payouts_owed, 2),
        },
        "events": event_rows,
        "payouts": payout_rows,
    }


@router.get("/admin/payouts")
def admin_list_payouts():
    store = get_store_snapshot()
    events = store.get("events", {}) or {}
    payments = store.get("payments", {}) or {}

    if not isinstance(events, dict):
        events = {}
    if not isinstance(payments, dict):
        payments = {}

    rows = []
    total_gross = 0.0
    total_platform_fees = 0.0
    total_organizer_payouts = 0.0
    total_paid_out = 0.0
    total_owed = 0.0

    for payment_id_raw, payment in payments.items():
        if not isinstance(payment, dict):
            continue
        if str(payment.get("status") or "").strip().lower() != "paid":
            continue

        try:
            payment_id = int(payment_id_raw)
        except Exception:
            payment_id = int(payment.get("id") or 0)

        amount = round(float(payment.get("amount") or 0), 2)
        platform_fee = round(float(payment.get("platform_fee") or 0), 2)
        organizer_payout = round(float(payment.get("organizer_payout") or 0), 2)
        payout_status = str(payment.get("payout_status") or "unpaid").strip().lower()
        payout_sent_at = payment.get("payout_sent_at")

        event_id = int(payment.get("event_id") or 0)
        event_row = events.get(str(event_id)) or events.get(event_id) or {}
        event_title = _clean_event_title(
            (event_row or {}).get("title"),
            (event_row or {}).get("event_title"),
            (event_row or {}).get("name"),
            payment.get("event_title"),
            event_id=event_id,
        )

        row = {
            "payment_id": payment_id,
            "event_id": event_id,
            "event_title": event_title,
            "application_id": payment.get("application_id"),
            "vendor_email": payment.get("vendor_email"),
            "vendor_name": payment.get("vendor_name"),
            "organizer_id": payment.get("organizer_id"),
            "organizer_email": payment.get("organizer_email"),
            "amount": amount,
            "platform_fee": platform_fee,
            "organizer_payout": organizer_payout,
            "status": str(payment.get("status") or "").strip().lower(),
            "payout_status": payout_status,
            "payout_sent_at": payout_sent_at,
            "created_at": payment.get("created_at"),
            "paid_at": payment.get("paid_at") or payment.get("updated_at") or payment.get("created_at"),
        }
        rows.append(row)

        total_gross += amount
        total_platform_fees += platform_fee
        total_organizer_payouts += organizer_payout

        if payout_status == "paid":
            total_paid_out += organizer_payout
        else:
            total_owed += organizer_payout

    rows.sort(
        key=lambda row: (
            str(row.get("payout_status") or "") != "unpaid",
            str(row.get("paid_at") or ""),
            int(row.get("payment_id") or 0),
        ),
        reverse=True,
    )

    return {
        "summary": {
            "gross_sales": round(total_gross, 2),
            "platform_fees": round(total_platform_fees, 2),
            "organizer_payouts": round(total_organizer_payouts, 2),
            "payouts_paid": round(total_paid_out, 2),
            "payouts_owed": round(total_owed, 2),
            "paid_count": sum(1 for row in rows if str(row.get("payout_status") or "") == "paid"),
            "unpaid_count": sum(1 for row in rows if str(row.get("payout_status") or "") != "paid"),
        },
        "payouts": rows,
    }


@router.patch("/admin/payout/{payment_id}")
def admin_mark_payout_paid(payment_id: int):
    payment = _PAYMENTS.get(int(payment_id)) or _PAYMENTS.get(str(payment_id))
    if not payment:
        for candidate in _PAYMENTS.values():
            if isinstance(candidate, dict) and str(candidate.get("id")) == str(payment_id):
                payment = candidate
                break

    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if str(payment.get("status") or "").strip().lower() != "paid":
        raise HTTPException(
            status_code=400,
            detail="Only fully paid vendor payments can be marked as organizer payouts",
        )

    if str(payment.get("payout_status") or "").strip().lower() == "paid":
        return {
            "ok": True,
            "message": "Payout already marked as paid",
            "payment": dict(payment),
        }

    payment["payout_status"] = "paid"
    payment["payout_sent_at"] = utc_now_iso()
    save_store()

    return {
        "ok": True,
        "message": "Payout marked as paid",
        "payment": dict(payment),
    }


@router.get("/public/events")
def public_list_events(db: Session = Depends(get_db)):
    out = []
    for event in db.query(Event).order_by(Event.id.desc()).all():
        if event.published and not event.archived:
            event_dict = _serialize_event_model(event)
            event_dict.update(_event_marketplace_stats(event_dict, _APPLICATIONS))
            out.append(event_dict)
    return {"events": out}


@router.get("/public/events/{event_id}")
def public_get_event(event_id: int, db: Session = Depends(get_db)):
    ev = _get_event_row_or_404(db, event_id)
    if not ev.published or ev.archived:
        raise HTTPException(status_code=404, detail="Event not found")
    return _serialize_event_model(ev)


@router.get("/events/{event_id}/vendors/{vendor_id}/qr")
def get_vendor_event_qr_pass(
    event_id: int,
    vendor_id: str,
    db: Session = Depends(get_db),
):
    """Return the event-specific vendor QR/check-in pass.

    This version directly matches the live application store shape used by
    app.routers.applications. It accepts the vendor id from the URL as either
    vendor_id, vendor_email, user_id, profile_id, or vendor_profile_id and treats
    paid applications as pass-eligible even if status naming changes.
    """
    event = _get_event_row_or_404(db, int(event_id))
    expire_reservations_if_needed()

    requested_event_id = str(event_id).strip()
    requested_vendor = str(vendor_id or "").strip().lower()
    if not requested_vendor:
        raise HTTPException(status_code=400, detail="Vendor id is required")

    approved_app = None

    for raw_app in _APPLICATIONS.values():
        if not isinstance(raw_app, dict):
            continue

        app_event_id = str(
            raw_app.get("event_id")
            or raw_app.get("eventId")
            or raw_app.get("event")
            or raw_app.get("eventID")
            or ""
        ).strip()
        if app_event_id != requested_event_id:
            continue

        app_vendor_values = [
            raw_app.get("vendor_id"),
            raw_app.get("vendorId"),
            raw_app.get("vendor_email"),
            raw_app.get("vendorEmail"),
            raw_app.get("email"),
            raw_app.get("user_id"),
            raw_app.get("userId"),
            raw_app.get("profile_id"),
            raw_app.get("profileId"),
            raw_app.get("vendor_profile_id"),
            raw_app.get("vendorProfileId"),
        ]
        app_vendor_keys = {str(value).strip().lower() for value in app_vendor_values if str(value or "").strip()}
        if requested_vendor not in app_vendor_keys:
            continue

        status = str(raw_app.get("status") or raw_app.get("application_status") or raw_app.get("applicationStatus") or "").strip().lower()
        review_status = str(raw_app.get("review_status") or raw_app.get("reviewStatus") or "").strip().lower()
        payment_status = _coerce_payment_status(raw_app.get("payment_status") or raw_app.get("paymentStatus"))

        if payment_status == "paid" or status in {"approved", "accepted", "confirmed", "complete", "completed", "paid"} or review_status in {"approved", "accepted", "confirmed", "complete", "completed"}:
            approved_app = dict(raw_app)
            break

    if approved_app is None:
        raise HTTPException(status_code=403, detail="Vendor not approved for event")

    resolved_vendor_id = (
        approved_app.get("vendor_id")
        or approved_app.get("vendorId")
        or approved_app.get("vendor_email")
        or approved_app.get("vendorEmail")
        or vendor_id
    )
    application_id = approved_app.get("id") or approved_app.get("application_id") or approved_app.get("applicationId") or ""
    token = _build_vendor_event_pass_token(int(event_id), resolved_vendor_id, application_id)
    qr_value = f"vendcore://check-in?event_id={int(event_id)}&vendor_id={resolved_vendor_id}&application_id={application_id}&token={token}"

    return {
        "ok": True,
        "event_id": int(event.id),
        "eventId": int(event.id),
        "event_title": event.title,
        "eventTitle": event.title,
        "vendor_id": str(resolved_vendor_id),
        "vendorId": str(resolved_vendor_id),
        "application_id": str(application_id),
        "applicationId": str(application_id),
        "vendor_email": approved_app.get("vendor_email") or approved_app.get("vendorEmail") or "",
        "vendor_name": approved_app.get("vendor_name") or approved_app.get("business_name") or approved_app.get("vendor_email") or "Vendor",
        "business_name": approved_app.get("business_name") or approved_app.get("vendor_name") or "",
        "booth_id": approved_app.get("booth_id") or approved_app.get("requested_booth_id") or "",
        "booth_category": approved_app.get("booth_category") or approved_app.get("requested_booth_category") or "",
        "status": approved_app.get("status") or "approved",
        "payment_status": approved_app.get("payment_status") or "paid",
        "qr_code": qr_value,
        "qrCode": qr_value,
        "pass_url": qr_value,
        "passUrl": qr_value,
        "checked_in": bool(approved_app.get("checked_in")),
        "checkedIn": bool(approved_app.get("checked_in")),
        "checked_in_at": approved_app.get("checked_in_at"),
        "checkedInAt": approved_app.get("checked_in_at"),
    }

def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _application_matches_event_and_vendor(app: Dict[str, Any], event_id: int, vendor_keys: set[str]) -> bool:
    if not isinstance(app, dict):
        return False

    if _safe_int(app.get("event_id")) != int(event_id):
        return False

    candidate_values = [
        app.get("vendor_id"),
        app.get("vendor_email"),
        app.get("email"),
        app.get("profile_id"),
        app.get("vendor_profile_id"),
        app.get("user_id"),
    ]
    candidates = {_norm_email(value) for value in candidate_values if _norm_email(value)}
    return bool(candidates.intersection(vendor_keys))


def _application_is_approved_for_pass(app: Dict[str, Any]) -> bool:
    status = str(app.get("status") or app.get("application_status") or "").strip().lower()
    review_status = str(app.get("review_status") or app.get("reviewStatus") or "").strip().lower()
    payment_status = _coerce_payment_status(app.get("payment_status") or app.get("paymentStatus"))
    checked_in_status = str(app.get("check_in_status") or app.get("checkInStatus") or "").strip().lower()

    approved_statuses = {"approved", "accepted", "confirmed", "checked_in", "complete", "completed"}
    return bool(
        status in approved_statuses
        or review_status in approved_statuses
        or payment_status == "paid"
        or checked_in_status == "checked_in"
    )


def _vendor_is_verified_for_pass(vendor_payload: Dict[str, Any]) -> bool:
    """Allow a verified vendor profile to load an event pass even when the
    application row is missing/mismatched during the current QR rollout.

    This prevents the frontend from showing a false "Vendor not approved"
    message when the vendor has a verified profile but the older application
    store uses a different vendor identifier. Organizer check-in can still
    use the token/event/vendor pair to create the attendance record.
    """
    status_values = {
        str(vendor_payload.get("verification_status") or "").strip().lower(),
        str(vendor_payload.get("verificationStatus") or "").strip().lower(),
        str(vendor_payload.get("public_verification_status") or "").strip().lower(),
        str(vendor_payload.get("review_status") or "").strip().lower(),
        str(vendor_payload.get("reviewStatus") or "").strip().lower(),
    }
    return bool(
        vendor_payload.get("verified") is True
        or vendor_payload.get("is_verified") is True
        or bool(status_values.intersection({"verified", "approved", "complete", "completed", "expiring_soon"}))
    )


def _resolve_vendor_pass_identity(db: Session, vendor_id: Any) -> tuple[Dict[str, Any], set[str]]:
    raw = str(vendor_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Vendor id is required")

    keys = {_norm_email(raw)} if _norm_email(raw) else set()
    vendor_payload: Dict[str, Any] = {"vendor_id": raw}

    profile = None
    numeric_id = _safe_int(raw, 0)
    if numeric_id:
        profile = db.query(Profile).filter(Profile.id == numeric_id, Profile.role == "vendor").one_or_none()

    if profile is None and "@" in raw:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == raw.lower(), Profile.role == "vendor")
            .one_or_none()
        )

    if profile is not None:
        data = dict(profile.data or {})
        vendor_payload.update(data)
        vendor_payload.update({
            "vendor_profile_id": profile.id,
            "vendor_id": data.get("vendor_id") or profile.email or str(profile.id),
            "email": profile.email,
            "business_name": data.get("business_name") or data.get("businessName") or profile.business_name or "",
            "contact_name": data.get("contact_name") or data.get("contactName") or profile.display_name or "",
        })
        keys.update({_norm_email(profile.email), str(profile.id).strip().lower()})
        data_vendor_id = data.get("vendor_id")
        if data_vendor_id:
            keys.add(str(data_vendor_id).strip().lower())
    else:
        keys.add(raw.lower())

    keys = {key for key in keys if key}
    return vendor_payload, keys


def _user_can_access_vendor_pass(user: Dict[str, Any], vendor_payload: Dict[str, Any], vendor_keys: set[str]) -> bool:
    role = str((user or {}).get("role") or "").strip().lower()
    if role in {"admin", "organizer"}:
        return True

    user_keys = {
        _norm_email((user or {}).get("email")),
        str((user or {}).get("id") or "").strip().lower(),
        str((user or {}).get("sub") or "").strip().lower(),
        str((user or {}).get("vendor_id") or "").strip().lower(),
    }
    user_keys = {key for key in user_keys if key}
    return bool(user_keys.intersection(vendor_keys))


def _build_vendor_event_pass_token(event_id: int, vendor_id: Any, application_id: Any = "") -> str:
    raw = f"vendcore-pass:{event_id}:{vendor_id}:{application_id}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"vcp_{digest}"


# ---------------- Vendor QR check-in ----------------

def _extract_checkin_payload(payload: Dict[str, Any]) -> Dict[str, str]:
    """Normalize check-in data from either a scanned QR URL or direct JSON fields."""
    payload = dict(payload or {})
    raw_url = str(
        payload.get("qr_code")
        or payload.get("qrCode")
        or payload.get("pass_url")
        or payload.get("passUrl")
        or payload.get("url")
        or payload.get("scan")
        or ""
    ).strip()

    parsed_values: Dict[str, str] = {}
    if raw_url:
        try:
            parsed = urlparse(raw_url)
            query = parse_qs(parsed.query or "")
            for key, values in query.items():
                if values:
                    parsed_values[key] = str(values[0]).strip()
        except Exception:
            parsed_values = {}

    def pick(*keys: str) -> str:
        for key in keys:
            value = payload.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
            value = parsed_values.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    return {
        "event_id": pick("event_id", "eventId"),
        "vendor_id": pick("vendor_id", "vendorId", "vendor_email", "vendorEmail"),
        "application_id": pick("application_id", "applicationId", "app_id", "appId"),
        "token": pick("token"),
        "source": raw_url,
    }


def _application_event_id(app: Dict[str, Any]) -> int:
    return _safe_int(app.get("event_id") or app.get("eventId") or app.get("event") or app.get("eventID"), 0)


def _application_vendor_keys(app: Dict[str, Any]) -> set[str]:
    values = [
        app.get("vendor_id"),
        app.get("vendorId"),
        app.get("vendor_email"),
        app.get("vendorEmail"),
        app.get("email"),
        app.get("user_id"),
        app.get("userId"),
        app.get("profile_id"),
        app.get("profileId"),
        app.get("vendor_profile_id"),
        app.get("vendorProfileId"),
    ]
    return {str(value).strip().lower() for value in values if str(value or "").strip()}


def _application_id_value(app: Dict[str, Any], fallback: Any = "") -> str:
    return str(app.get("id") or app.get("application_id") or app.get("applicationId") or fallback or "").strip()


def _find_checkin_application(event_id: int, application_id: str = "", vendor_id: str = "") -> tuple[Any, Dict[str, Any]]:
    requested_app_id = str(application_id or "").strip()
    requested_vendor = str(vendor_id or "").strip().lower()

    # Prefer the application id because the QR pass is application-specific.
    if requested_app_id:
        direct = _APPLICATIONS.get(requested_app_id)
        if direct is None and requested_app_id.isdigit():
            direct = _APPLICATIONS.get(int(requested_app_id))
        if isinstance(direct, dict) and _application_event_id(direct) == int(event_id):
            if not requested_vendor or requested_vendor in _application_vendor_keys(direct):
                return requested_app_id, direct

    for stored_key, app in _APPLICATIONS.items():
        if not isinstance(app, dict):
            continue
        if _application_event_id(app) != int(event_id):
            continue

        app_id = _application_id_value(app, stored_key)
        if requested_app_id and app_id != requested_app_id and str(stored_key) != requested_app_id:
            continue

        vendor_keys = _application_vendor_keys(app)
        if requested_vendor and requested_vendor not in vendor_keys:
            continue

        return stored_key, app

    raise HTTPException(status_code=404, detail="Check-in application not found")


def _validate_checkin_token(app: Dict[str, Any], event_id: int, provided_token: str) -> None:
    provided = str(provided_token or "").strip()
    if not provided:
        raise HTTPException(status_code=400, detail="Check-in token is required")

    app_id = _application_id_value(app)
    vendor_candidates = _application_vendor_keys(app)
    for candidate in vendor_candidates:
        expected = _build_vendor_event_pass_token(int(event_id), candidate, app_id)
        if provided == expected:
            return

    # Older rollout passes may have been generated with the raw vendor_id field before normalization.
    raw_vendor = app.get("vendor_id") or app.get("vendorId") or app.get("vendor_email") or app.get("vendorEmail") or ""
    if raw_vendor and provided == _build_vendor_event_pass_token(int(event_id), raw_vendor, app_id):
        return

    raise HTTPException(status_code=403, detail="Invalid check-in token")


def _serialize_checkin_application(app: Dict[str, Any], event_id: int, stored_key: Any = "") -> Dict[str, Any]:
    app_id = _application_id_value(app, stored_key)
    vendor_id = app.get("vendor_id") or app.get("vendorId") or app.get("vendor_email") or app.get("vendorEmail") or ""
    return {
        "application_id": str(app_id),
        "applicationId": str(app_id),
        "event_id": int(event_id),
        "eventId": int(event_id),
        "vendor_id": str(vendor_id),
        "vendorId": str(vendor_id),
        "vendor_email": app.get("vendor_email") or app.get("vendorEmail") or "",
        "vendor_name": app.get("vendor_name") or app.get("business_name") or app.get("vendor_email") or "Vendor",
        "business_name": app.get("business_name") or app.get("vendor_name") or "",
        "booth_id": app.get("booth_id") or app.get("requested_booth_id") or "",
        "booth_category": app.get("booth_category") or app.get("requested_booth_category") or "",
        "status": app.get("status") or "",
        "payment_status": app.get("payment_status") or app.get("paymentStatus") or "",
        "checked_in": bool(app.get("checked_in")),
        "checkedIn": bool(app.get("checked_in")),
        "checked_in_at": app.get("checked_in_at"),
        "checkedInAt": app.get("checked_in_at"),
        "checked_in_by": app.get("checked_in_by") or app.get("checkedInBy") or "",
        "check_in_status": app.get("check_in_status") or app.get("checkInStatus") or "",
    }


@router.post("/check-in")
def check_in_vendor_from_qr(
    payload: Dict[str, Any] = Body(default={}),
    user: Optional[Dict[str, Any]] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Organizer-facing check-in endpoint for scanned vendor QR passes.

    Accepts either the full vendcore://check-in?... QR value or direct JSON fields:
    event_id, vendor_id, application_id, token.
    """
    normalized = _extract_checkin_payload(payload)
    event_id = _safe_int(normalized.get("event_id"), 0)
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id is required")

    _get_event_row_or_404(db, event_id)
    expire_reservations_if_needed()

    stored_key, app = _find_checkin_application(
        event_id=event_id,
        application_id=normalized.get("application_id") or "",
        vendor_id=normalized.get("vendor_id") or "",
    )

    if not _application_is_approved_for_pass(app):
        raise HTTPException(status_code=403, detail="Vendor is not approved or paid for this event")

    _validate_checkin_token(app, event_id, normalized.get("token") or "")

    now = utc_now_iso()
    already_checked_in = bool(app.get("checked_in"))
    if not already_checked_in:
        app["checked_in"] = True
        app["checked_in_at"] = now
        app["check_in_status"] = "checked_in"
        app["updated_at"] = now

    checker_email = _norm_email((user or {}).get("email"))
    if checker_email:
        app["checked_in_by"] = checker_email

    save_store()

    return {
        "ok": True,
        "already_checked_in": already_checked_in,
        "alreadyCheckedIn": already_checked_in,
        "checked_in_at": app.get("checked_in_at") or now,
        "checkedInAt": app.get("checked_in_at") or now,
        "application": _serialize_checkin_application(app, event_id, stored_key),
    }


@router.get("/events/{event_id}/check-ins")
def list_event_checkins(
    event_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Organizer/admin summary of check-in status for an event."""
    _get_owned_event_or_404(db, int(event_id), user)
    expire_reservations_if_needed()

    rows = []
    for stored_key, app in _APPLICATIONS.items():
        if not isinstance(app, dict):
            continue
        if _application_event_id(app) != int(event_id):
            continue
        if not _application_is_approved_for_pass(app):
            continue
        rows.append(_serialize_checkin_application(app, int(event_id), stored_key))

    rows.sort(key=lambda row: (not bool(row.get("checked_in")), str(row.get("vendor_name") or "").lower()))
    checked_in_count = sum(1 for row in rows if row.get("checked_in"))

    return {
        "ok": True,
        "event_id": int(event_id),
        "eventId": int(event_id),
        "total": len(rows),
        "checked_in": checked_in_count,
        "checkedIn": checked_in_count,
        "not_checked_in": max(len(rows) - checked_in_count, 0),
        "notCheckedIn": max(len(rows) - checked_in_count, 0),
        "checkins": rows,
    }


@router.get("/events/{event_id}/stats")
def get_event_stats(event_id: int, db: Session = Depends(get_db)):
    expire_reservations_if_needed()

    event = _get_event_row_or_404(db, int(event_id))
    apps = [app for app in _APPLICATIONS.values() if int(app.get("event_id") or 0) == int(event_id)]

    sold = sum(1 for app in apps if _coerce_payment_status(app.get("payment_status")) == "paid")
    pending = sum(
        1
        for app in apps
        if str(app.get("status") or "").strip().lower() in ("submitted", "under_review")
    )
    approved = sum(1 for app in apps if str(app.get("status") or "").strip().lower() == "approved")
    revenue = sum(
        _safe_float(app.get("booth_price"))
        for app in apps
        if _coerce_payment_status(app.get("payment_status")) == "paid"
    )

    booths_total = 0
    booths_remaining = max(0, booths_total - sold)
    approval_rate = (approved / len(apps)) if apps else 0

    return {
        "event_id": int(event.id),
        "applications": len(apps),
        "booths_sold": sold,
        "pending_applications": pending,
        "approved_vendors": approved,
        "revenue": revenue,
        "booths_total": booths_total,
        "booths_remaining": booths_remaining,
        "approval_rate": approval_rate,
    }


@router.post("/dev/reset")
def dev_reset():
    _REQUIREMENTS.clear()
    _APPLICATIONS.clear()
    _PAYMENTS.clear()

    try:
        from app.routers.users import _USERS
        _USERS.clear()
    except Exception:
        pass

    save_store()

    return {
        "ok": True,
        "message": "Reset remaining JSON-backed stores complete",
    }


@router.post("/events/{event_id}/images")
async def upload_event_image(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _get_event_row_or_404(db, event_id)

    safe_name = _sanitize_upload_filename(file.filename or "image")
    target = UPLOAD_DIR / safe_name
    data = await file.read()
    target.write_bytes(data)

    return {"url": f"/uploads/{safe_name}", "filename": safe_name}
