from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.routers.auth import get_current_user

from app.db import get_db
from app.models.event import Event

try:
    from app.routers.auth import _USERS, _USERS_BY_EMAIL
except Exception:
    _USERS = {}
    _USERS_BY_EMAIL = {}

try:
    from app.store import _VERIFICATIONS
except Exception:
    _VERIFICATIONS = {}

router = APIRouter(tags=["Organizers"])

DATA_DIR = Path("/data") if Path("/data").exists() else Path(__file__).resolve().parent.parent
PROFILE_STORE_PATH = DATA_DIR / "organizer_profiles.json"
REVIEWS_STORE_PATH = DATA_DIR / "organizer_reviews.json"


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_datetime(value: Any) -> datetime | None:
    raw = _safe_str(value)
    if not raw:
        return None

    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def compute_verification_status(profile: Dict[str, Any]) -> str:
    """Return the public verification lifecycle status for an organizer profile."""
    now = datetime.utcnow()
    explicit_status = _safe_str(
        profile.get("verification_status")
        or profile.get("verificationStatus")
        or profile.get("status")
    ).lower()

    if explicit_status in {"expired", "expiring_soon", "verified", "pending", "rejected"}:
        return explicit_status

    documents = profile.get("documents") or profile.get("verification_documents") or profile.get("verificationDocuments") or []
    if isinstance(documents, dict):
        documents = list(documents.values())

    has_expiration = False
    if isinstance(documents, list):
        for doc in documents:
            if not isinstance(doc, dict):
                continue

            exp_date = _parse_datetime(
                doc.get("expiration_date")
                or doc.get("expirationDate")
                or doc.get("expires_at")
                or doc.get("expiresAt")
            )

            if not exp_date:
                continue

            has_expiration = True
            if exp_date < now:
                return "expired"
            if exp_date - now <= timedelta(days=30):
                return "expiring_soon"

    if bool(profile.get("verified")) or explicit_status in {"approved", "complete"}:
        if has_expiration:
            return "verified"

        # Temporary lifecycle proxy until upload flows persist real expiration_date values.
        updated = _parse_datetime(profile.get("updatedAt") or profile.get("updated_at"))
        if updated:
            age_days = (now - updated).days
            if age_days > 365:
                return "expired"
            if age_days >= 335:
                return "expiring_soon"

        return "verified"

    return "pending"


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()



def _public_verification_display(verification_status: str, review_status: str = "") -> Dict[str, str]:
    status = _safe_str(verification_status).lower()
    review = _safe_str(review_status).lower()

    if status in {"verified", "expiring_soon"}:
        return {
            "public_verification_status": "verified",
            "public_verification_label": "Verified",
        }

    if status == "pending" or review in {"pending", "renewal_pending"}:
        return {
            "public_verification_status": "renewal_pending",
            "public_verification_label": "Renewal pending",
        }

    return {
        "public_verification_status": "not_verified",
        "public_verification_label": "Not verified",
    }




def _latest_verification_for_email(email: str, role: str = "organizer") -> Dict[str, Any]:
    """Read latest verification directly from app.store at request time.

    This avoids stale imports if app.store rebinds _VERIFICATIONS during startup/load.
    """
    normalized_email = _norm_email(email)
    normalized_role = _safe_str(role).lower()
    if not normalized_email:
        return {}

    try:
        import app.store as live_store  # type: ignore
        verification_store = getattr(live_store, "_VERIFICATIONS", {})
    except Exception:
        verification_store = _VERIFICATIONS

    matches: List[Dict[str, Any]] = []
    try:
        records = verification_store.values() if isinstance(verification_store, dict) else []
        for record in records:
            if not isinstance(record, dict):
                continue
            if _norm_email(record.get("email")) != normalized_email:
                continue
            if normalized_role and _safe_str(record.get("role")).lower() != normalized_role:
                continue
            matches.append(record)
    except Exception:
        return {}

    if not matches:
        return {}

    matches.sort(
        key=lambda item: _safe_str(
            item.get("reviewed_at")
            or item.get("submitted_at")
            or item.get("created_at")
            or item.get("id")
            or ""
        ),
        reverse=True,
    )
    return matches[0]


def _verification_truth(profile: Dict[str, Any], email: str) -> Dict[str, str]:
    """Resolve public organizer verification from admin records first, profile second."""
    admin_record = _latest_verification_for_email(email, "organizer")

    if admin_record:
        status = _safe_str(admin_record.get("verification_status") or admin_record.get("status")).lower()
        if status == "approved":
            status = "verified"
        if status not in {"verified", "expired", "expiring_soon", "pending", "rejected"}:
            status = compute_verification_status(admin_record)

        review_status = _safe_str(admin_record.get("review_status") or admin_record.get("reviewStatus")).lower()
        if not review_status:
            review_status = (
                "approved"
                if status in {"verified", "expiring_soon"}
                else "renewal_pending"
                if status == "pending"
                else "rejected"
                if status == "rejected"
                else "none"
            )

        return {"verification_status": status or "pending", "review_status": review_status or "none"}

    status = compute_verification_status(profile)
    if profile.get("verified") is True:
        status = "verified"

    review_status = _safe_str(profile.get("review_status") or profile.get("reviewStatus")).lower()
    if not review_status:
        review_status = (
            "approved"
            if status in {"verified", "expiring_soon"}
            else "renewal_pending"
            if status == "pending"
            else "rejected"
            if status == "rejected"
            else "none"
        )

    return {"verification_status": status or "pending", "review_status": review_status or "none"}

def _user_for_email(email: str) -> Dict[str, Any]:
    normalized = _norm_email(email)
    if not normalized:
        return {}

    try:
        user_id = _USERS_BY_EMAIL.get(normalized)
        if user_id is not None:
            user = _USERS.get(int(user_id))
            if isinstance(user, dict):
                return user
    except Exception:
        pass

    try:
        for user in _USERS.values():
            if isinstance(user, dict) and _norm_email(user.get("email")) == normalized:
                return user
    except Exception:
        pass

    return {}


def _apply_subscription_overlay(profile: Dict[str, Any], email: str) -> Dict[str, Any]:
    """Overlay live billing state from the auth user store onto organizer profiles.

    Organizer profiles are still stored separately from user billing state. This keeps
    public organizer directory/profile output in sync when Stripe updates the user
    record but the profile JSON has not been rewritten yet.
    """
    merged = dict(profile or {})
    user = _user_for_email(email)

    if not isinstance(user, dict) or not user:
        return merged

    role = _safe_str(user.get("role")).lower()
    if role and role != "organizer":
        return merged

    plan = _safe_str(user.get("plan") or "starter").lower()
    status = _safe_str(user.get("subscription_status") or "inactive").lower()
    is_enterprise = plan == "enterprise_organizer" and status in {"active", "trialing", "paid"}

    if plan:
        merged["plan"] = plan
        merged["subscription_plan"] = plan
        merged["subscriptionPlan"] = plan
    if status:
        merged["subscription_status"] = status
        merged["subscriptionStatus"] = status

    if is_enterprise:
        merged["featured"] = True
        merged["promoted"] = True
        merged["visibility_tier"] = "premium"
        merged["visibilityTier"] = "premium"
    elif plan == "starter" or status in {"inactive", "canceled", "cancelled", "unpaid", "incomplete_expired"}:
        # Only clear paid placement when billing explicitly says the account is inactive.
        merged["featured"] = False
        merged["promoted"] = False
        if _safe_str(merged.get("visibility_tier") or merged.get("visibilityTier")).lower() == "premium":
            merged.pop("visibility_tier", None)
            merged.pop("visibilityTier", None)

    return merged


def _derive_visibility_tier(profile: Dict[str, Any], public_verification_status: str) -> str:
    explicit = _safe_str(profile.get("visibility_tier") or profile.get("visibilityTier")).lower()
    if explicit in {"premium", "verified", "standard"}:
        return explicit
    if explicit in {"featured", "priority"}:
        return "premium"

    plan = _safe_str(profile.get("plan") or profile.get("subscription_plan") or profile.get("subscriptionPlan")).lower()
    if profile.get("promoted") or profile.get("featured") or any(token in plan for token in ["premium", "pro", "growth", "enterprise"]):
        return "premium"

    if public_verification_status == "verified":
        return "verified"

    return "standard"


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
        "business_address": str(payload.get("business_address") or payload.get("businessAddress") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "state": str(payload.get("state") or "").strip(),
        "zip": str(payload.get("zip") or payload.get("zipcode") or payload.get("postal_code") or "").strip(),
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
        "verification_status": str(payload.get("verification_status") or payload.get("verificationStatus") or "").strip(),
        "documents": list(payload.get("documents") or payload.get("verification_documents") or payload.get("verificationDocuments") or []),
        "profileComplete": bool(payload.get("profileComplete")),
        "updatedAt": str(payload.get("updatedAt") or payload.get("updated_at") or _utc_now_iso()).strip(),
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
def save_organizer_profile(
    payload: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user),
):
    email = user.get("email")  # 🔥 FORCE AUTH USER

    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")

    profile = _profile_from_payload(payload or {})

    # 🔥 OVERRIDE ANY EMAIL COMING FROM FRONTEND
    profile["email"] = email

    profiles = _load_profiles()
    existing = profiles.get(email) or {}

    # preserve verification fields
    if "verified" not in payload:
        profile["verified"] = existing.get("verified", False)

    if not profile.get("verification_status"):
        profile["verification_status"] = existing.get("verification_status")

    profile["verification_status"] = compute_verification_status(profile)
    profile["verified"] = profile["verification_status"] == "verified"

    profiles[email] = profile
    _save_profiles(profiles)

    return {
        "ok": True,
        "profile": profile,
        "organizer": {
            "email": email,
            "profile": profile,
            "verified": profile["verified"],
            "verification_status": profile["verification_status"],
        },
    }
@router.get("/organizer/profile/{email}")
def get_organizer_profile(email: str):
    email = _norm_email(email)
    profile = _load_profiles().get(email)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = {**profile, "verification_status": compute_verification_status(profile)}
    profile["verified"] = profile["verification_status"] == "verified"

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
    profile = _apply_subscription_overlay(profiles.get(email) or {}, email)

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

    truth = _verification_truth(profile, email)
    verification_status = truth["verification_status"]
    review_status = truth["review_status"]
    public_display = _public_verification_display(verification_status, review_status)
    visibility_tier = _derive_visibility_tier(profile, public_display["public_verification_status"])

    return {
        "organizer": {
            "email": email,
            "name": name,
            "verified": public_display["public_verification_status"] == "verified",
            "verification_status": verification_status,
            "review_status": review_status,
            **public_display,
            "visibility_tier": visibility_tier,
            "visibilityTier": visibility_tier,
            "plan": profile.get("plan"),
            "subscription_plan": profile.get("subscription_plan"),
            "subscription_status": profile.get("subscription_status"),
            "featured": bool(profile.get("featured")),
            "promoted": bool(profile.get("promoted")),
            "logo_url": profile.get("logoDataUrl"),
            "banner_url": profile.get("bannerUrl") or profile.get("banner_url"),
            "yearsInBusiness": profile.get("yearsInBusiness"),
            "eventTypes": profile.get("eventTypes"),
            "eventSize": profile.get("eventSize"),
            "business_address": profile.get("business_address"),
            "city": profile.get("city") or profile.get("location"),
            "state": profile.get("state"),
            "zip": profile.get("zip"),
            "plan": profile.get("plan"),
            "subscription_plan": profile.get("subscription_plan"),
            "subscription_status": profile.get("subscription_status"),
            "featured": bool(profile.get("featured")),
            "promoted": bool(profile.get("promoted")),
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

        profile = _apply_subscription_overlay(profile, email)

        organizer_reviews = list(reviews_store.get(email, []))
        summary = _review_summary(organizer_reviews)
        name = (
            profile.get("organizationName")
            or profile.get("contactName")
            or email
        )
        location = str(
            profile.get("location")
            or ", ".join([x for x in [profile.get("city"), profile.get("state")] if x])
            or ""
        ).strip()

        truth = _verification_truth(profile, email)
        verification_status = truth["verification_status"]
        review_status = truth["review_status"]
        public_display = _public_verification_display(verification_status, review_status)
        visibility_tier = _derive_visibility_tier(profile, public_display["public_verification_status"])

        rows_by_email[email] = {
            "email": email,
            "business_name": name,
            "name": name,
            "city": location,
            "location": location,
            "business_address": profile.get("business_address"),
            "state": profile.get("state"),
            "zip": profile.get("zip"),
            "status": verification_status,
            "verification_status": verification_status,
            "review_status": review_status,
            **public_display,
            "verified": public_display["public_verification_status"] == "verified",
            "visibility_tier": visibility_tier,
            "visibilityTier": visibility_tier,
            "categories": [profile.get("organizationType")] if profile.get("organizationType") else [],
            "bio": profile.get("organizationType") or f"{name} profile on VendCore",
            "rating": summary.get("rating", 0),
            "review_count": summary.get("review_count", 0),
            "events_count": 0,
            "plan": profile.get("plan"),
            "subscription_plan": profile.get("subscription_plan") or profile.get("subscriptionPlan"),
            "subscription_status": profile.get("subscription_status") or profile.get("subscriptionStatus"),
            "featured": bool(profile.get("featured")),
            "promoted": bool(profile.get("promoted")) or visibility_tier == "premium",
            "logo_url": profile.get("logoDataUrl"),
            "banner_url": profile.get("bannerUrl") or profile.get("banner_url"),
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
        profile = _apply_subscription_overlay({}, email)
        truth = _verification_truth(profile, email)
        verification_status = truth["verification_status"]
        review_status = truth["review_status"]
        public_display = _public_verification_display(verification_status, review_status)
        visibility_tier = _derive_visibility_tier(profile, public_display["public_verification_status"])

        rows_by_email[email] = {
            "email": email,
            "business_name": email,
            "name": email,
            "city": location,
            "location": location,
            "status": verification_status,
            "verification_status": verification_status,
            "review_status": review_status,
            **public_display,
            "verified": public_display["public_verification_status"] == "verified",
            "visibility_tier": visibility_tier,
            "visibilityTier": visibility_tier,
            "categories": [getattr(event, "category", "")] if getattr(event, "category", "") else [],
            "bio": "Organizer hosting events on VendCore",
            "rating": 0,
            "review_count": 0,
            "events_count": 1,
            "promoted": False,
        }

    rows = list(rows_by_email.values())

    # --- FALLBACK DATA (so directory is never empty while live profiles/events ramp up) ---
    if not rows:
        rows = [
            {
                "email": "demo@festivalco.com",
                "business_name": "Festival Co.",
                "name": "Festival Co.",
                "city": "Atlanta, GA",
                "location": "Atlanta, GA",
                "status": "verified",
                "verification_status": "verified",
                "review_status": "approved",
                "public_verification_status": "verified",
                "public_verification_label": "Verified",
                "verified": True,
                "visibility_tier": "premium",
                "visibilityTier": "premium",
                "categories": ["Festival"],
                "bio": "Large-scale festival organizer",
                "rating": 4.8,
                "review_count": 12,
                "events_count": 5,
                "promoted": True,
            },
            {
                "email": "events@citymarket.com",
                "business_name": "City Market Events",
                "name": "City Market Events",
                "city": "Atlanta, GA",
                "location": "Atlanta, GA",
                "status": "verified",
                "verification_status": "verified",
                "review_status": "approved",
                "public_verification_status": "verified",
                "public_verification_label": "Verified",
                "verified": True,
                "visibility_tier": "verified",
                "visibilityTier": "verified",
                "categories": ["Market"],
                "bio": "Weekly community market organizer",
                "rating": 4.5,
                "review_count": 6,
                "events_count": 2,
                "promoted": False,
            },
            {
                "email": "new@organizer.com",
                "business_name": "New Organizer",
                "name": "New Organizer",
                "city": "Atlanta, GA",
                "location": "Atlanta, GA",
                "status": "pending",
                "verification_status": "pending",
                "review_status": "renewal_pending",
                "public_verification_status": "renewal_pending",
                "public_verification_label": "Renewal pending",
                "verified": False,
                "visibility_tier": "standard",
                "visibilityTier": "standard",
                "categories": ["Pop-up"],
                "bio": "Emerging event organizer",
                "rating": 0,
                "review_count": 0,
                "events_count": 0,
                "promoted": False,
            },
        ]

    tier_rank = {"premium": 0, "verified": 1, "standard": 2}
    rows.sort(
        key=lambda row: (
            tier_rank.get(_safe_str(row.get("visibility_tier") or row.get("visibilityTier")).lower(), 2),
            not bool(row.get("verified")),
            str(row.get("business_name") or row.get("email") or "").lower(),
        )
    )
    return rows


@router.get("/organizers/public-directory")
def get_public_organizers_directory(db: Session = Depends(get_db)):
    return _public_directory_rows(db)


@router.get("/verification/public")
def get_public_organizers(db: Session = Depends(get_db)):
    return _public_directory_rows(db)


@router.get("/organizers/{email}")
def get_public_organizer_alias(email: str, db: Session = Depends(get_db)):
    return get_public_organizer(email, db)
