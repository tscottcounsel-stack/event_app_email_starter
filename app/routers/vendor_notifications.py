from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.models.profile import EventAlert, Profile
from app.routers.auth import get_current_user

try:
    from app.store import _EVENTS, _REQUIREMENTS
except Exception:  # pragma: no cover - store is available in production
    _EVENTS = {}
    _REQUIREMENTS = {}

router = APIRouter(tags=["Vendor Notifications"])

ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "paid", "current", "enabled"}
PREMIUM_VENDOR_PLAN_TOKENS = {
    "pro_vendor",
    "premium_vendor",
    "growth_vendor",
    "enterprise_vendor",
}


class VendorNotificationPreferences(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_match_alerts_enabled: bool = True
    eventMatchAlertsEnabled: Optional[bool] = None
    event_match_email_alerts: bool = False
    eventMatchEmailAlerts: Optional[bool] = None
    match_radius: str = "50 miles"
    matchRadius: Optional[str] = None
    preferred_categories: Optional[List[str]] = None
    preferredCategories: Optional[List[str]] = None


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _category_slug(value: Any) -> str:
    text = _safe_lower(value)
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")

    aliases = {
        "food": "food-and-beverage",
        "food-vendor": "food-and-beverage",
        "food-vendors": "food-and-beverage",
        "food-and-drink": "food-and-beverage",
        "coffee": "coffee-and-beverages",
        "beverages": "coffee-and-beverages",
        "food-truck": "mobile-catering",
        "food-trucks": "mobile-catering",
        "mobile-food": "mobile-catering",
        "tech": "technology-and-electronics",
        "technology": "technology-and-electronics",
        "electronics": "technology-and-electronics",
        "arts-crafts": "arts-and-crafts",
        "arts": "arts-and-crafts",
        "art": "arts-and-crafts",
        "artists": "arts-and-crafts",
        "beauty": "beauty-and-skincare",
        "skincare": "beauty-and-skincare",
        "beauty-wellness": "beauty-and-skincare",
    }

    return aliases.get(text, text)


def _flatten_categories(value: Any) -> List[str]:
    out: List[str] = []

    def add(item: Any) -> None:
        if item is None:
            return
        if isinstance(item, (list, tuple, set)):
            for sub in item:
                add(sub)
            return
        if isinstance(item, dict):
            for key in ("name", "label", "category", "value", "title", "type"):
                if item.get(key):
                    add(item.get(key))
                    return
            return
        text = _safe_str(item)
        if not text:
            return
        parts = [part.strip() for part in re.split(r"[,;/|]+", text) if part.strip()]
        out.extend(parts or [text])

    add(value)

    seen = set()
    clean: List[str] = []
    for item in out:
        slug = _category_slug(item)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        clean.append(item)
    return clean


def _unique_categories(values: List[Any]) -> List[str]:
    seen = set()
    out: List[str] = []

    for value in values:
        for item in _flatten_categories(value):
            slug = _category_slug(item)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            out.append(item)

    return out


def _profile_data(profile: Optional[Profile]) -> Dict[str, Any]:
    if profile is None:
        return {}
    return profile.data if isinstance(profile.data, dict) else {}


def _active_paid_vendor(profile: Optional[Profile], user: Optional[Dict[str, Any]] = None) -> bool:
    """Strict paid gate for event-match alerts.

    Do not unlock event-match alerts from verification, featured, promoted, or public
    visibility alone. This is a paid subscription benefit.
    """
    user = user or {}
    data = _profile_data(profile)

    role = _safe_lower((profile.role if profile is not None else "") or user.get("role") or data.get("role"))
    if role != "vendor":
        return False

    plan = _safe_lower(
        (profile.subscription_plan if profile is not None else "")
        or data.get("subscription_plan")
        or data.get("subscriptionPlan")
        or data.get("plan")
        or user.get("subscription_plan")
        or user.get("subscriptionPlan")
        or user.get("plan")
    ).replace(" ", "_").replace("-", "_")

    status = _safe_lower(
        (profile.subscription_status if profile is not None else "")
        or data.get("subscription_status")
        or data.get("subscriptionStatus")
        or user.get("subscription_status")
        or user.get("subscriptionStatus")
    )

    has_paid_plan = (
        plan in PREMIUM_VENDOR_PLAN_TOKENS
        or any(token in plan for token in PREMIUM_VENDOR_PLAN_TOKENS)
        or ("vendor" in plan and any(token in plan for token in ("premium", "pro", "growth", "enterprise")))
    )

    return bool(has_paid_plan and status in ACTIVE_SUBSCRIPTION_STATUSES)


def _profile_categories(profile: Optional[Profile]) -> List[str]:
    data = _profile_data(profile)

    values = [
        getattr(profile, "categories", None) if profile is not None else None,
        data.get("categories"),
        data.get("vendor_categories"),
        data.get("vendorCategories"),
        data.get("category"),
        data.get("vendor_category"),
        data.get("business_category"),
        data.get("businessCategory"),
        data.get("business_type"),
        data.get("businessType"),
        data.get("offerings"),
        data.get("vendor_offerings"),
    ]

    return _unique_categories(values)


def _event_categories(event_data: Dict[str, Any]) -> List[str]:
    values: List[Any] = [
        event_data.get("desired_vendor_categories"),
        event_data.get("desiredVendorCategories"),
        event_data.get("vendor_categories_needed"),
        event_data.get("vendorCategoriesNeeded"),
        event_data.get("looking_for_categories"),
        event_data.get("lookingForCategories"),
        event_data.get("vendor_categories"),
        event_data.get("vendorCategories"),
        event_data.get("booth_categories"),
        event_data.get("boothCategories"),
        event_data.get("categories"),
        event_data.get("category"),
    ]

    try:
        event_id = int(event_data.get("id") or event_data.get("event_id") or 0)
        req = _REQUIREMENTS.get(event_id) if hasattr(_REQUIREMENTS, "get") else {}
        req_root = req.get("requirements") if isinstance(req, dict) else {}
        req_root = req_root if isinstance(req_root, dict) else req
        if isinstance(req_root, dict):
            values.extend([
                req_root.get("categories"),
                req_root.get("categoryRequirements"),
                req_root.get("category_requirements"),
            ])
    except Exception:
        pass

    return _unique_categories(values)


def _dt_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return _safe_str(value) or None


def _parse_dt(value: Any) -> Optional[datetime]:
    raw = _safe_str(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _event_is_past(event_data: Dict[str, Any]) -> bool:
    raw = (
        event_data.get("end_date")
        or event_data.get("endDate")
        or event_data.get("start_date")
        or event_data.get("startDate")
        or event_data.get("event_date")
        or event_data.get("date")
    )
    dt = _parse_dt(raw)
    if dt is None:
        return False
    return dt.date() < datetime.now(timezone.utc).date()


def _event_is_canceled(event_data: Dict[str, Any]) -> bool:
    status = _safe_lower(event_data.get("status") or event_data.get("lifecycle_status") or event_data.get("lifecycleStatus"))
    return bool(
        event_data.get("canceled")
        or event_data.get("cancelled")
        or event_data.get("canceled_at")
        or event_data.get("cancelled_at")
        or status in {"canceled", "cancelled", "event_canceled"}
    )


def _event_is_active_marketplace_event(event_data: Dict[str, Any]) -> bool:
    status = _safe_lower(event_data.get("status") or event_data.get("lifecycle_status") or event_data.get("lifecycleStatus"))
    if bool(event_data.get("archived")) or status in {"archived", "completed", "closed"}:
        return False
    if _event_is_canceled(event_data) or _event_is_past(event_data):
        return False
    if event_data.get("published") is False:
        return False
    return True


def _store_event_payload(event_id: Any) -> Dict[str, Any]:
    try:
        numeric = int(event_id)
    except Exception:
        numeric = None

    for key in (event_id, str(event_id), numeric):
        if key is None:
            continue
        try:
            value = _EVENTS.get(key)
            if isinstance(value, dict):
                return value
        except Exception:
            pass

    return {}


def _serialize_event(ev: Event) -> Dict[str, Any]:
    store_payload = _store_event_payload(getattr(ev, "id", None))

    payload: Dict[str, Any] = {
        "id": getattr(ev, "id", None),
        "title": getattr(ev, "title", None),
        "name": getattr(ev, "title", None),
        "description": getattr(ev, "description", None),
        "start_date": _dt_to_iso(getattr(ev, "start_date", None)),
        "startDate": _dt_to_iso(getattr(ev, "start_date", None)),
        "end_date": _dt_to_iso(getattr(ev, "end_date", None)),
        "endDate": _dt_to_iso(getattr(ev, "end_date", None)),
        "venue_name": getattr(ev, "venue_name", None),
        "venueName": getattr(ev, "venue_name", None),
        "city": getattr(ev, "city", None),
        "state": getattr(ev, "state", None),
        "category": getattr(ev, "category", None),
        "published": bool(getattr(ev, "published", False)),
        "archived": bool(getattr(ev, "archived", False)),
        "organizer_email": getattr(ev, "organizer_email", None),
        "owner_email": getattr(ev, "owner_email", None),
    }

    if isinstance(store_payload, dict):
        for key, value in store_payload.items():
            if value not in (None, "", []):
                payload[key] = value

    categories = _event_categories(payload)
    if categories:
        payload["desired_vendor_categories"] = categories
        payload["desiredVendorCategories"] = categories
        payload["vendor_categories_needed"] = categories

    payload["active_marketplace_event"] = _event_is_active_marketplace_event(payload)
    return payload


def _get_vendor_profile(db: Session, user: Dict[str, Any]) -> Optional[Profile]:
    email = _safe_lower(user.get("email"))
    if not email:
        return None
    return (
        db.query(Profile)
        .filter(func.lower(Profile.email) == email, Profile.role == "vendor")
        .order_by(Profile.updated_at.desc())
        .first()
    )


def _notification_prefs(profile: Optional[Profile]) -> Dict[str, Any]:
    data = _profile_data(profile)
    enabled = data.get("event_match_alerts_enabled", data.get("eventMatchAlertsEnabled", True))
    email_enabled = data.get("event_match_email_alerts", data.get("eventMatchEmailAlerts", False))
    radius = data.get("match_radius") or data.get("matchRadius") or data.get("defaultEventRadius") or "50 miles"
    preferred = data.get("preferred_categories") or data.get("preferredCategories") or []

    return {
        "event_match_alerts_enabled": enabled is not False,
        "eventMatchAlertsEnabled": enabled is not False,
        "event_match_email_alerts": bool(email_enabled),
        "eventMatchEmailAlerts": bool(email_enabled),
        "match_radius": _safe_str(radius) or "50 miles",
        "matchRadius": _safe_str(radius) or "50 miles",
        "preferred_categories": _flatten_categories(preferred),
        "preferredCategories": _flatten_categories(preferred),
    }


def _alert_to_dict(alert: EventAlert) -> Dict[str, Any]:
    data = alert.data if isinstance(alert.data, dict) else {}
    return {
        "id": alert.id,
        "event_id": alert.event_id,
        "eventId": alert.event_id,
        "event_title": alert.event_title,
        "eventTitle": alert.event_title,
        "event_city": alert.event_city,
        "eventCity": alert.event_city,
        "event_state": alert.event_state,
        "eventState": alert.event_state,
        "category": alert.category,
        "alert_type": alert.alert_type,
        "alertType": alert.alert_type,
        "message": alert.message,
        "read": bool(alert.read),
        "created_at": _dt_to_iso(alert.created_at),
        "createdAt": _dt_to_iso(alert.created_at),
        "data": data,
        "apply_url": f"/vendor/events/{alert.event_id}/apply",
        "applyUrl": f"/vendor/events/{alert.event_id}/apply",
        "event_url": f"/vendor/events/{alert.event_id}",
        "eventUrl": f"/vendor/events/{alert.event_id}",
    }


def _create_missing_alerts_for_vendor(db: Session, profile: Profile, user: Dict[str, Any]) -> int:
    email = _safe_lower(profile.email)
    if not email:
        return 0

    if not _active_paid_vendor(profile, user):
        return 0

    prefs = _notification_prefs(profile)
    if prefs["event_match_alerts_enabled"] is False:
        return 0

    vendor_categories = _profile_categories(profile)
    vendor_slugs = {_category_slug(category) for category in vendor_categories if _category_slug(category)}
    if not vendor_slugs:
        return 0

    rows = db.query(Event).filter(Event.published == True).filter(Event.archived == False).order_by(Event.id.desc()).all()  # noqa: E712
    created = 0

    for ev in rows:
        event_data = _serialize_event(ev)
        if not _event_is_active_marketplace_event(event_data):
            continue

        event_categories = _event_categories(event_data)
        event_slugs = {_category_slug(category) for category in event_categories if _category_slug(category)}
        matching_slugs = vendor_slugs.intersection(event_slugs)
        if not matching_slugs:
            continue

        matching_labels = [category for category in event_categories if _category_slug(category) in matching_slugs] or [
            category for category in vendor_categories if _category_slug(category) in matching_slugs
        ]

        title = _safe_str(event_data.get("title") or event_data.get("name") or f"Event #{event_data.get('id')}")
        city = _safe_str(event_data.get("city"))
        state = _safe_str(event_data.get("state"))
        where = ", ".join([part for part in [city, state] if part])

        for category in matching_labels:
            category_label = _safe_str(category) or "your category"
            existing = (
                db.query(EventAlert)
                .filter(
                    func.lower(EventAlert.vendor_email) == email,
                    EventAlert.event_id == int(event_data["id"]),
                    func.lower(EventAlert.category) == category_label.lower(),
                )
                .one_or_none()
            )
            if existing:
                continue

            suffix = f" in {where}" if where else ""
            alert = EventAlert(
                vendor_email=email,
                vendor_profile_id=profile.id,
                event_id=int(event_data["id"]),
                event_title=title,
                event_city=city or None,
                event_state=state or None,
                category=category_label,
                alert_type="new_matching_event",
                message=f"New {category_label} opportunity: {title}{suffix}.",
                read=False,
                data={
                    "event_id": int(event_data["id"]),
                    "event_title": title,
                    "category": category_label,
                    "city": city,
                    "state": state,
                    "source": "event_match_backfill",
                    "matched_at": _now_iso(),
                },
            )
            db.add(alert)
            created += 1

    if created:
        db.commit()
    return created


def _list_alerts(db: Session, email: str, limit: int = 25) -> List[Dict[str, Any]]:
    rows = (
        db.query(EventAlert)
        .filter(func.lower(EventAlert.vendor_email) == _safe_lower(email))
        .order_by(EventAlert.read.asc(), EventAlert.created_at.desc(), EventAlert.id.desc())
        .limit(max(1, min(int(limit or 25), 100)))
        .all()
    )
    return [_alert_to_dict(row) for row in rows]


@router.get("/vendor/notification-preferences")
def get_vendor_notification_preferences(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    active = _active_paid_vendor(profile, user)
    return {
        "ok": True,
        "active_subscription": active,
        "premium_required": not active,
        "preferences": _notification_prefs(profile),
    }


@router.put("/vendor/notification-preferences")
def update_vendor_notification_preferences(
    payload: VendorNotificationPreferences,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    if profile is None:
        email = _safe_lower(user.get("email"))
        if not email:
            raise HTTPException(status_code=401, detail="Unauthorized")
        profile = Profile(email=email, role="vendor")
        db.add(profile)
        db.flush()

    current = _profile_data(profile)
    next_prefs = {
        "event_match_alerts_enabled": payload.eventMatchAlertsEnabled if payload.eventMatchAlertsEnabled is not None else payload.event_match_alerts_enabled,
        "eventMatchAlertsEnabled": payload.eventMatchAlertsEnabled if payload.eventMatchAlertsEnabled is not None else payload.event_match_alerts_enabled,
        "event_match_email_alerts": payload.eventMatchEmailAlerts if payload.eventMatchEmailAlerts is not None else payload.event_match_email_alerts,
        "eventMatchEmailAlerts": payload.eventMatchEmailAlerts if payload.eventMatchEmailAlerts is not None else payload.event_match_email_alerts,
        "match_radius": payload.matchRadius or payload.match_radius or "50 miles",
        "matchRadius": payload.matchRadius or payload.match_radius or "50 miles",
        "preferred_categories": payload.preferredCategories if payload.preferredCategories is not None else (payload.preferred_categories or []),
        "preferredCategories": payload.preferredCategories if payload.preferredCategories is not None else (payload.preferred_categories or []),
        "event_match_preferences_updated_at": _now_iso(),
    }

    profile.data = {**current, **next_prefs}
    db.commit()
    db.refresh(profile)

    return {
        "ok": True,
        "active_subscription": _active_paid_vendor(profile, user),
        "preferences": _notification_prefs(profile),
    }


@router.get("/vendor/notifications")
def list_vendor_notifications(
    limit: int = 25,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    email = _safe_lower(user.get("email") or (profile.email if profile else ""))
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")

    active = _active_paid_vendor(profile, user)
    created = _create_missing_alerts_for_vendor(db, profile, user) if profile is not None else 0
    alerts = _list_alerts(db, email, limit) if active else []
    unread = len([item for item in alerts if not item.get("read")])

    return {
        "ok": True,
        "active_subscription": active,
        "premium_required": not active,
        "created": created,
        "unread_count": unread,
        "count": len(alerts),
        "alerts": alerts,
        "notifications": alerts,
        "preferences": _notification_prefs(profile),
    }


@router.get("/vendor/notifications/event-matches")
def list_vendor_event_matches(
    limit: int = 25,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_vendor_notifications(limit=limit, user=user, db=db)


@router.post("/vendor/notifications/refresh")
def refresh_vendor_notifications(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    if profile is None:
        return {"ok": True, "active_subscription": False, "created": 0, "alerts": [], "unread_count": 0}

    active = _active_paid_vendor(profile, user)
    created = _create_missing_alerts_for_vendor(db, profile, user)
    alerts = _list_alerts(db, _safe_lower(profile.email), 50) if active else []

    return {
        "ok": True,
        "active_subscription": active,
        "premium_required": not active,
        "created": created,
        "alerts": alerts,
        "notifications": alerts,
        "unread_count": len([item for item in alerts if not item.get("read")]),
    }


@router.patch("/vendor/notifications/{alert_id}/read")
def mark_vendor_notification_read(
    alert_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = _safe_lower(user.get("email"))
    row = (
        db.query(EventAlert)
        .filter(EventAlert.id == int(alert_id), func.lower(EventAlert.vendor_email) == email)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found.")

    row.read = True
    db.commit()
    db.refresh(row)
    return {"ok": True, "notification": _alert_to_dict(row)}


@router.post("/vendor/notifications/read-all")
def mark_all_vendor_notifications_read(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = _safe_lower(user.get("email"))
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")

    rows = db.query(EventAlert).filter(func.lower(EventAlert.vendor_email) == email, EventAlert.read == False).all()  # noqa: E712
    for row in rows:
        row.read = True
    if rows:
        db.commit()

    return {"ok": True, "updated": len(rows)}
