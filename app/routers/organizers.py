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


def _is_truthy_verified(value: Any) -> bool:
    if value is True:
        return True
    text = _safe_lower(value)
    return text in {"true", "1", "yes", "verified", "approved"}


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
    return bool(profile.featured or profile.promoted or data.get("featured") or data.get("promoted") or tier == "premium" or (has_paid_plan and active) or plan == "enterprise_organizer")


def _display_name(profile: Profile) -> str:
    data = _profile_data(profile)
    return (
        _safe_str(data.get("organizationName"))
        or _safe_str(data.get("organization_name"))
        or _safe_str(data.get("businessName"))
        or _safe_str(data.get("business_name"))
        or _safe_str(profile.business_name)
        or _safe_str(data.get("company_name"))
        or _safe_str(data.get("contactName"))
        or _safe_str(profile.display_name)
        or _safe_str(profile.email)
        or "Organizer"
    )


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
        "organizationName": data.get("organizationName") or name,
        "organization_name": data.get("organization_name") or data.get("organizationName") or name,
        "businessName": data.get("businessName") or data.get("business_name") or name,
        "business_name": data.get("business_name") or data.get("businessName") or name,
        "company_name": data.get("company_name") or name,
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
        "featured": bool(profile.featured or data.get("featured") or premium),
        "promoted": bool(profile.promoted or data.get("promoted") or premium),
        "visibility_tier": profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier") or ("premium" if premium else "standard"),
        "subscription_plan": plan,
        "subscription_status": status,
        "plan": plan,
        "events_count": event_count,
        "event_count": event_count,
        "published_events_count": published_event_count,
        "published_event_count": published_event_count,
        "profileComplete": bool(data.get("profileComplete") or data.get("profile_complete") or name),
        "profile_complete": bool(data.get("profile_complete") or data.get("profileComplete") or name),
    }


def _query_organizer_profiles(db: Session) -> List[Profile]:
    return (
        db.query(Profile)
        .filter(Profile.role == "organizer")
        .order_by(Profile.featured.desc(), Profile.promoted.desc(), Profile.updated_at.desc())
        .all()
    )


@router.get("/organizers")
def list_public_organizers(db: Session = Depends(get_db)):
    profiles = _query_organizer_profiles(db)
    organizers = [_organizer_public(profile, db) for profile in profiles]

    # Public directory should show credible organizer listings. Verified and
    # premium organizers are always included. Complete profiles may also appear
    # so early organizers are not hidden before their first published event.
    visible = []
    for organizer in organizers:
        is_verified = organizer.get("verified") is True
        is_premium = organizer.get("premium") is True or organizer.get("featured") is True or organizer.get("promoted") is True
        has_name = bool(_safe_str(organizer.get("organizationName") or organizer.get("business_name") or organizer.get("name")))
        if is_verified or is_premium or has_name:
            visible.append(organizer)

    visible.sort(
        key=lambda item: (
            0 if item.get("premium") else 1,
            0 if item.get("verified") else 1,
            _safe_lower(item.get("name")),
        )
    )

    return {
        "ok": True,
        "organizers": visible,
        "items": visible,
        "count": len(visible),
    }


@router.get("/organizers/public")
def list_public_organizers_alias(db: Session = Depends(get_db)):
    return list_public_organizers(db)


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    normalized_email = _safe_lower(email)
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Organizer email required")

    profile = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == normalized_email, Profile.role == "organizer")
        .one_or_none()
    )

    if profile is not None:
        return {"ok": True, "organizer": _organizer_public(profile, db)}

    # Fallback for older event-only organizers. This keeps legacy public links
    # working even if a Profile row has not been created yet.
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
            "events_count": len(events),
            "event_count": len(events),
            "published_events_count": len(published_events),
            "published_event_count": len(published_events),
        },
    }


@router.get("/organizers/{email}")
def get_public_organizer_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)
