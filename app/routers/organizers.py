from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.models.profile import Profile

router = APIRouter(tags=["Organizers"])


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _profile_data(profile: Profile) -> Dict[str, Any]:
    data = profile.data if isinstance(profile.data, dict) else {}
    return dict(data or {})


def _is_truthy(value: Any) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    return _safe_lower(value) in {"true", "1", "yes", "y", "verified", "approved", "complete"}


def _is_truthy_verified(value: Any) -> bool:
    if value is True:
        return True
    return _safe_lower(value) in {"true", "1", "yes", "verified", "approved"}


def _is_verified_profile(profile: Profile) -> bool:
    data = _profile_data(profile)
    return any(
        [
            profile.verified is True,
            _safe_lower(profile.verification_status) == "verified",
            _safe_lower(profile.public_verification_status) == "verified",
            _safe_lower(profile.review_status) == "approved",
            _is_truthy_verified(data.get("verified")),
            _is_truthy_verified(data.get("is_verified")),
            _safe_lower(data.get("status")) == "verified",
            _safe_lower(data.get("verification_status")) == "verified",
            _safe_lower(data.get("public_verification_status")) == "verified",
            _safe_lower(data.get("review_status")) == "approved",
        ]
    )


def _is_premium_profile(profile: Profile) -> bool:
    data = _profile_data(profile)
    plan = _safe_lower(
        profile.subscription_plan
        or data.get("subscription_plan")
        or data.get("subscriptionPlan")
        or data.get("plan")
    )
    status = _safe_lower(
        profile.subscription_status
        or data.get("subscription_status")
        or data.get("subscriptionStatus")
    )
    tier = _safe_lower(profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier"))
    has_paid_plan = any(token in plan for token in ["enterprise", "premium", "pro", "growth"])
    active = status in {"active", "trialing", "paid"}
    return bool(
        profile.featured
        or profile.promoted
        or _is_truthy(data.get("featured"))
        or _is_truthy(data.get("promoted"))
        or tier == "premium"
        or (has_paid_plan and active)
        or plan == "enterprise_organizer"
    )


def _explicit_name(profile: Profile) -> str:
    data = _profile_data(profile)
    return (
        _safe_str(data.get("organizationName"))
        or _safe_str(data.get("organization_name"))
        or _safe_str(data.get("businessName"))
        or _safe_str(data.get("business_name"))
        or _safe_str(profile.business_name)
        or _safe_str(data.get("company_name"))
    )


def _display_name(profile: Profile) -> str:
    data = _profile_data(profile)
    return (
        _explicit_name(profile)
        or _safe_str(data.get("contactName"))
        or _safe_str(profile.display_name)
        or _safe_str(profile.email)
        or "Organizer"
    )


def _has_completed_public_profile(profile: Profile) -> bool:
    """Only allow standard public listings when profile setup is truly complete.

    Verified and premium organizers can still show even if some public profile fields
    are thin, but standard listings should not include admin-created shells or
    partially-started accounts.
    """
    data = _profile_data(profile)
    if _is_truthy(data.get("profileComplete")) or _is_truthy(data.get("profile_complete")):
        return True

    name = _explicit_name(profile)
    contact = _safe_str(data.get("contactName") or data.get("contact_name") or profile.display_name)
    city = _safe_str(profile.city or data.get("city"))
    state = _safe_str(profile.state or data.get("state"))
    location = _safe_str(data.get("location")) or ", ".join([part for part in [city, state] if part])

    return bool(name and contact and location)


def _event_count_for_email(db: Session, email: str) -> int:
    if not email:
        return 0
    try:
        return int(
            db.query(func.count(Event.id))
            .filter(func.lower(Event.organizer_email) == email)
            .scalar()
            or 0
        )
    except Exception:
        return 0


def _published_event_count_for_email(db: Session, email: str) -> int:
    if not email:
        return 0
    try:
        return int(
            db.query(func.count(Event.id))
            .filter(func.lower(Event.organizer_email) == email, Event.published == True)  # noqa: E712
            .scalar()
            or 0
        )
    except Exception:
        return 0


def _organizer_public(profile: Profile, db: Session) -> Dict[str, Any]:
    data = _profile_data(profile)
    email = _safe_lower(profile.email or data.get("email"))
    verified = _is_verified_profile(profile)
    premium = _is_premium_profile(profile)
    complete = _has_completed_public_profile(profile)
    name = _display_name(profile)
    city = _safe_str(profile.city or data.get("city"))
    state = _safe_str(profile.state or data.get("state"))
    location = _safe_str(data.get("location")) or ", ".join([part for part in [city, state] if part])
    event_count = _event_count_for_email(db, email)
    published_event_count = _published_event_count_for_email(db, email)
    plan = _safe_lower(profile.subscription_plan or data.get("subscription_plan") or data.get("subscriptionPlan") or data.get("plan"))
    status = _safe_lower(profile.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus"))

    return {
        **data,
        "id": profile.id,
        "email": email,
        "role": "organizer",
        "name": name,
        "display_name": name,
        "organizationName": data.get("organizationName") or data.get("organization_name") or _explicit_name(profile) or name,
        "organization_name": data.get("organization_name") or data.get("organizationName") or _explicit_name(profile) or name,
        "businessName": data.get("businessName") or data.get("business_name") or _explicit_name(profile) or name,
        "business_name": data.get("business_name") or data.get("businessName") or _explicit_name(profile) or name,
        "company_name": data.get("company_name") or _explicit_name(profile) or name,
        "contactName": data.get("contactName") or data.get("contact_name") or profile.display_name,
        "contact_name": data.get("contact_name") or data.get("contactName") or profile.display_name,
        "city": city,
        "state": state,
        "location": location,
        "logoDataUrl": data.get("logoDataUrl") or data.get("logo_url") or data.get("logoUrl") or "",
        "logo_url": data.get("logo_url") or data.get("logoUrl") or data.get("logoDataUrl") or "",
        "imageUrls": data.get("imageUrls") if isinstance(data.get("imageUrls"), list) else data.get("image_urls", []),
        "image_urls": data.get("image_urls") if isinstance(data.get("image_urls"), list) else data.get("imageUrls", []),
        "verified": verified,
        "is_verified": verified,
        "verification_status": "verified" if verified else _safe_lower(profile.verification_status or data.get("verification_status") or data.get("status") or "unverified"),
        "public_verification_status": "verified" if verified else _safe_lower(profile.public_verification_status or data.get("public_verification_status") or "not_verified"),
        "public_verification_label": "Verified" if verified else _safe_str(profile.public_verification_label or data.get("public_verification_label") or "Not verified"),
        "premium": premium,
        "is_premium": premium,
        "featured": bool(profile.featured or _is_truthy(data.get("featured")) or premium),
        "promoted": bool(profile.promoted or _is_truthy(data.get("promoted")) or premium),
        "visibility_tier": profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier") or ("premium" if premium else "standard"),
        "subscription_plan": plan,
        "subscription_status": status,
        "plan": plan,
        "events_count": event_count,
        "event_count": event_count,
        "published_events_count": published_event_count,
        "published_event_count": published_event_count,
        "profileComplete": complete,
        "profile_complete": complete,
    }


def _query_organizer_profiles(db: Session) -> List[Profile]:
    return (
        db.query(Profile)
        .filter(Profile.role == "organizer")
        .order_by(Profile.featured.desc(), Profile.promoted.desc(), Profile.updated_at.desc())
        .all()
    )


def _rank_key(item: Dict[str, Any]) -> tuple[int, int, int, str]:
    premium_rank = 0 if item.get("premium") else 1
    verified_rank = 0 if item.get("verified") else 1
    complete_rank = 0 if item.get("profileComplete") else 1
    return (premium_rank, verified_rank, complete_rank, _safe_lower(item.get("name")))


def _dedupe_by_email(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep one public card per organizer email, preferring premium/verified/complete."""
    chosen: Dict[str, Dict[str, Any]] = {}
    for item in items:
        email = _safe_lower(item.get("email"))
        if not email:
            continue
        current = chosen.get(email)
        if current is None or _rank_key(item) < _rank_key(current):
            chosen[email] = item
    return list(chosen.values())


@router.get("/organizers")
def list_public_organizers(db: Session = Depends(get_db)):
    profiles = _query_organizer_profiles(db)
    organizers = [_organizer_public(profile, db) for profile in profiles]

    visible = []
    for organizer in organizers:
        is_verified = organizer.get("verified") is True
        is_premium = organizer.get("premium") is True or organizer.get("featured") is True or organizer.get("promoted") is True
        is_complete = organizer.get("profileComplete") is True or organizer.get("profile_complete") is True

        # Verified and premium organizers are always credible enough to show.
        # Standard organizers only show after completing the public profile.
        if is_verified or is_premium or is_complete:
            visible.append(organizer)

    visible = _dedupe_by_email(visible)
    visible.sort(key=_rank_key)

    return {
        "ok": True,
        "organizers": visible,
        "items": visible,
        "count": len(visible),
    }


@router.get("/organizers/public")
def list_public_organizers_alias(db: Session = Depends(get_db)):
    return list_public_organizers(db)


@router.get("/organizers/public-directory")
def list_public_organizers_legacy_alias(db: Session = Depends(get_db)):
    return list_public_organizers(db)


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    normalized_email = _safe_lower(email)
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Organizer email required")

    profile = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == normalized_email, Profile.role == "organizer")
        .order_by(Profile.updated_at.desc())
        .first()
    )

    if profile is not None:
        return {"ok": True, "organizer": _organizer_public(profile, db)}

    events = (
        db.query(Event)
        .filter(func.lower(Event.organizer_email) == normalized_email)
        .all()
    )

    if not events:
        raise HTTPException(status_code=404, detail="Organizer not found")

    organizer_name = _safe_str(getattr(events[0], "organizer_name", None)) or normalized_email
    published_events = [event for event in events if bool(getattr(event, "published", False))]

    return {
        "ok": True,
        "organizer": {
            "email": normalized_email,
            "role": "organizer",
            "name": organizer_name,
            "organizationName": organizer_name,
            "business_name": organizer_name,
            "verified": False,
            "is_verified": False,
            "verification_status": "unverified",
            "public_verification_status": "not_verified",
            "public_verification_label": "Not verified",
            "premium": False,
            "is_premium": False,
            "featured": False,
            "promoted": False,
            "profileComplete": False,
            "profile_complete": False,
            "events_count": len(events),
            "event_count": len(events),
            "published_events_count": len(published_events),
            "published_event_count": len(published_events),
        },
    }


@router.get("/organizers/{email}")
def get_public_organizer_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)
