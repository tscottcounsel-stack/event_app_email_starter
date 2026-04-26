from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event

router = APIRouter(tags=["Organizers"])

DATA_DIR = Path("/data") if Path("/data").exists() else Path(__file__).resolve().parent.parent
PROFILE_STORE_PATH = DATA_DIR / "organizer_profiles.json"
REVIEWS_STORE_PATH = DATA_DIR / "organizer_reviews.json"


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _load_profiles() -> Dict[str, Dict[str, Any]]:
    try:
        if not PROFILE_STORE_PATH.exists():
            return {}
        data = json.loads(PROFILE_STORE_PATH.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_profiles(profiles: Dict[str, Dict[str, Any]]) -> None:
    PROFILE_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_STORE_PATH.write_text(
        json.dumps(profiles, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _load_reviews() -> Dict[str, List[Dict[str, Any]]]:
    try:
        if not REVIEWS_STORE_PATH.exists():
            return {}
        data = json.loads(REVIEWS_STORE_PATH.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_reviews(reviews: Dict[str, List[Dict[str, Any]]]) -> None:
    REVIEWS_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    REVIEWS_STORE_PATH.write_text(
        json.dumps(reviews, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _event_to_public(event: Event) -> Dict[str, Any]:
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "venue_name": event.venue_name,
        "street_address": event.street_address,
        "city": event.city,
        "state": event.state,
        "start_date": event.start_date.isoformat() if event.start_date else None,
        "end_date": event.end_date.isoformat() if event.end_date else None,
        "published": bool(event.published),
        "archived": bool(event.archived),
        "heroImageUrl": event.hero_image_url,
        "imageUrls": list(event.image_urls or []),
        "videoUrls": list(event.video_urls or []),
        "category": event.category,
        "organizer_email": event.organizer_email,
    }


def _profile_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    email = _norm_email(payload.get("email"))

    return {
        "organizationName": str(payload.get("organizationName") or "").strip(),
        "organizationType": str(payload.get("organizationType") or "").strip(),
        "contactName": str(payload.get("contactName") or "").strip(),
        "email": email,
        "phone": str(payload.get("phone") or "").strip(),
        "website": str(payload.get("website") or "").strip(),
        "location": str(payload.get("location") or "").strip(),
        "logoDataUrl": str(payload.get("logoDataUrl") or "").strip(),
        "imageUrls": list(payload.get("imageUrls") or []),
        "yearsInBusiness": str(payload.get("yearsInBusiness") or "").strip(),
        "eventTypes": str(payload.get("eventTypes") or "").strip(),
        "eventSize": str(payload.get("eventSize") or "").strip(),
        "instagram": str(payload.get("instagram") or payload.get("instagramUrl") or payload.get("instagram_url") or "").strip(),
        "facebook": str(payload.get("facebook") or payload.get("facebookUrl") or payload.get("facebook_url") or "").strip(),
        "tiktok": str(payload.get("tiktok") or payload.get("tikTok") or payload.get("tiktokUrl") or payload.get("tiktok_url") or "").strip(),
        "xTwitter": str(payload.get("xTwitter") or payload.get("twitter") or payload.get("twitterUrl") or payload.get("twitter_url") or "").strip(),
        "linkedin": str(payload.get("linkedin") or payload.get("linkedIn") or payload.get("linkedinUrl") or payload.get("linkedin_url") or "").strip(),
        "youtube": str(payload.get("youtube") or payload.get("youTube") or payload.get("youtubeUrl") or payload.get("youtube_url") or "").strip(),
        "verified": bool(payload.get("verified", False)),
        "profileComplete": bool(payload.get("profileComplete")),
        "updatedAt": str(payload.get("updatedAt") or "").strip(),
    }


def _normalize_review(payload: Dict[str, Any], organizer_email: str) -> Dict[str, Any]:
    rating = _safe_int(payload.get("rating"), 0)
    rating = max(1, min(5, rating))

    comment = str(payload.get("comment") or "").strip()
    reviewer_name = str(
        payload.get("reviewer_name")
        or payload.get("reviewerName")
        or payload.get("name")
        or "Verified Vendor"
    ).strip()

    return {
        "id": str(payload.get("id") or f"review-{int(datetime.now(timezone.utc).timestamp() * 1000)}"),
        "organizer_email": organizer_email,
        "rating": rating,
        "comment": comment,
        "reviewer_name": reviewer_name or "Verified Vendor",
        "created_at": str(payload.get("created_at") or payload.get("createdAt") or _utc_now_iso()),
    }


def _review_summary(organizer_reviews: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not organizer_reviews:
        return {
            "rating": 0,
            "average_rating": 0,
            "review_count": 0,
            "reviews_count": 0,
        }

    total = 0
    count = 0

    for review in organizer_reviews:
        rating = _safe_int(review.get("rating"), 0)
        if rating > 0:
            total += rating
            count += 1

    average = round(total / count, 1) if count else 0

    return {
        "rating": average,
        "average_rating": average,
        "review_count": len(organizer_reviews),
        "reviews_count": len(organizer_reviews),
    }


@router.post("/organizer/profile")
def save_organizer_profile(payload: Dict[str, Any]):
    profile = _profile_from_payload(payload or {})
    email = _norm_email(profile.get("email"))

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    if not profile.get("organizationName"):
        raise HTTPException(status_code=400, detail="Organization name required")

    if not profile.get("contactName"):
        raise HTTPException(status_code=400, detail="Primary contact name required")

    profiles = _load_profiles()
    existing = profiles.get(email) or {}

    # Preserve verification status unless incoming payload explicitly includes verified.
    if "verified" not in (payload or {}):
        profile["verified"] = bool(existing.get("verified", False))

    profiles[email] = profile
    _save_profiles(profiles)

    return {
        "ok": True,
        "profile": profile,
        "organizer": {
            "email": email,
            "profile": profile,
            "verified": bool(profile.get("verified", False)),
        },
    }


@router.get("/organizer/profile/{email}")
def get_organizer_profile(email: str):
    email = _norm_email(email)
    profile = _load_profiles().get(email)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"profile": profile}


@router.get("/organizers/public/{email}/reviews")
def get_public_organizer_reviews(email: str):
    email = _norm_email(email)
    reviews_store = _load_reviews()
    organizer_reviews = list(reviews_store.get(email, []))
    summary = _review_summary(organizer_reviews)

    return {
        "ok": True,
        "email": email,
        "reviews": organizer_reviews,
        **summary,
    }


@router.post("/organizers/public/{email}/reviews")
def submit_public_organizer_review(email: str, payload: Dict[str, Any]):
    email = _norm_email(email)

    if not email:
        raise HTTPException(status_code=400, detail="Organizer email required")

    review = _normalize_review(payload or {}, email)

    if not review.get("comment"):
        raise HTTPException(status_code=400, detail="Review comment required")

    reviews_store = _load_reviews()
    reviews_store.setdefault(email, [])
    reviews_store[email].append(review)
    _save_reviews(reviews_store)

    organizer_reviews = list(reviews_store.get(email, []))
    summary = _review_summary(organizer_reviews)

    return {
        "ok": True,
        "email": email,
        "review": review,
        "reviews": organizer_reviews,
        **summary,
    }


@router.post("/organizers/review")
def submit_organizer_review_alias(payload: Dict[str, Any]):
    email = _norm_email(
        payload.get("organizerEmail")
        or payload.get("organizer_email")
        or payload.get("email")
    )

    if not email:
        raise HTTPException(status_code=400, detail="Organizer email required")

    return submit_public_organizer_review(email, payload)


@router.get("/organizers/public/{email}")
def get_public_organizer(email: str, db: Session = Depends(get_db)):
    email = _norm_email(email)

    profiles = _load_profiles()
    profile = profiles.get(email) or {}

    events = (
        db.query(Event)
        .filter(Event.organizer_email == email)
        .order_by(Event.id.desc())
        .all()
    )

    public_events = [
        _event_to_public(event)
        for event in events
        if bool(event.published) and not bool(event.archived)
    ]

    if not profile and not events:
        raise HTTPException(status_code=404, detail="Organizer not found")

    name = (
        profile.get("organizationName")
        or profile.get("contactName")
        or (events[0].organizer_email if events else email)
        or "Organizer"
    )

    reviews_store = _load_reviews()
    organizer_reviews = list(reviews_store.get(email, []))
    review_summary = _review_summary(organizer_reviews)

    return {
        "organizer": {
            "email": email,
            "name": name,
            "verified": bool(profile.get("verified", False)),
            "yearsInBusiness": profile.get("yearsInBusiness"),
            "eventTypes": profile.get("eventTypes"),
            "eventSize": profile.get("eventSize"),
            "instagram": profile.get("instagram"),
            "facebook": profile.get("facebook"),
            "tiktok": profile.get("tiktok"),
            "xTwitter": profile.get("xTwitter"),
            "linkedin": profile.get("linkedin"),
            "youtube": profile.get("youtube"),
            "rating": review_summary["rating"],
            "review_count": review_summary["review_count"],
            "reviews_count": review_summary["reviews_count"],
            "reviews": organizer_reviews,
            "profile": profile,
            "events_count": len(events),
            "public_events_count": len(public_events),
            "events": public_events,
        },
        "reviews": organizer_reviews,
        **review_summary,
    }


@router.get("/organizers/{email}")
def get_public_organizer_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)

def _public_directory_rows(db: Session) -> List[Dict[str, Any]]:
    profiles = _load_profiles()
    reviews_store = _load_reviews()
    rows_by_email: Dict[str, Dict[str, Any]] = {}

    for raw_email, profile in profiles.items():
        if not isinstance(profile, dict):
            continue

        email = _norm_email(raw_email or profile.get("email"))
        if not email:
            continue

        organizer_reviews = list(reviews_store.get(email, []))
        summary = _review_summary(organizer_reviews)
        name = (
            profile.get("organizationName")
            or profile.get("contactName")
            or email
        )
        location = str(profile.get("location") or "").strip()

        rows_by_email[email] = {
            "email": email,
            "business_name": name,
            "name": name,
            "city": location,
            "location": location,
            "status": "verified" if profile.get("verified") else "pending",
            "verified": bool(profile.get("verified", False)),
            "categories": [profile.get("organizationType")] if profile.get("organizationType") else [],
            "bio": profile.get("organizationType") or f"{name} profile on VendCore",
            "rating": summary.get("rating", 0),
            "review_count": summary.get("review_count", 0),
            "events_count": 0,
            "promoted": bool(profile.get("verified", False)),
        }

    events = db.query(Event).order_by(Event.id.desc()).all()
    for event in events:
        email = _norm_email(getattr(event, "organizer_email", ""))
        if not email:
            continue

        existing = rows_by_email.get(email)
        if existing:
            existing["events_count"] = int(existing.get("events_count") or 0) + 1
            if not existing.get("city"):
                existing["city"] = ", ".join([x for x in [getattr(event, "city", ""), getattr(event, "state", "")] if x])
                existing["location"] = existing["city"]
            continue

        location = ", ".join([x for x in [getattr(event, "city", ""), getattr(event, "state", "")] if x])
        rows_by_email[email] = {
            "email": email,
            "business_name": email,
            "name": email,
            "city": location,
            "location": location,
            "status": "pending",
            "verified": False,
            "categories": [getattr(event, "category", "")] if getattr(event, "category", "") else [],
            "bio": "Organizer hosting events on VendCore",
            "rating": 0,
            "review_count": 0,
            "events_count": 1,
            "promoted": False,
        }

    rows = list(rows_by_email.values())
    rows.sort(key=lambda row: (not bool(row.get("verified")), str(row.get("business_name") or row.get("email") or "").lower()))
    return rows


@router.get("/organizers/public-directory")
def get_public_organizers_directory(db: Session = Depends(get_db)):
    return _public_directory_rows(db)


@router.get("/verification/public")
def get_public_organizers(db: Session = Depends(get_db)):
    return _public_directory_rows(db)
