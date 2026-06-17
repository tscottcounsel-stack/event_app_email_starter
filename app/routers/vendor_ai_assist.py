from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import store as store_module
from app.db import get_db
from app.models.event import Event
from app.models.diagram import Diagram
from app.models.profile import Profile
from app.routers.auth import get_current_user

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - dependency is runtime-configured
    OpenAI = None  # type: ignore

router = APIRouter(tags=["Vendor AI Assist"])

ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "paid", "current", "enabled"}
PREMIUM_VENDOR_PLAN_TOKENS = {
    "pro_vendor",
    "premium_vendor",
    "growth_vendor",
    "enterprise_vendor",
}

FIT_SCORE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "fit_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "overall_label": {
            "type": "string",
            "enum": ["strong_fit", "good_fit", "possible_fit", "weak_fit", "needs_more_info"],
        },
        "summary": {"type": "string"},
        "matching_reasons": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "document_readiness": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "status": {"type": "string", "enum": ["ready", "needs_attention", "missing_docs", "unknown"]},
                "ready": {"type": "array", "items": {"type": "string"}},
                "missing": {"type": "array", "items": {"type": "string"}},
                "expiring": {"type": "array", "items": {"type": "string"}},
                "notes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["status", "ready", "missing", "expiring", "notes"],
        },
        "suggested_next_steps": {"type": "array", "items": {"type": "string"}},
        "application_angle": {"type": "string"},
        "human_review_required": {"type": "boolean"},
    },
    "required": [
        "fit_score",
        "overall_label",
        "summary",
        "matching_reasons",
        "concerns",
        "document_readiness",
        "suggested_next_steps",
        "application_angle",
        "human_review_required",
    ],
}



BOOTH_ADVISOR_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "strategy_summary": {"type": "string"},
        "top_recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "booth_id": {"type": "string"},
                    "label": {"type": "string"},
                    "score": {"type": "integer", "minimum": 0, "maximum": 100},
                    "tag": {"type": "string"},
                    "reason": {"type": "string"},
                    "tradeoffs": {"type": "array", "items": {"type": "string"}},
                    "best_for": {"type": "string"},
                },
                "required": ["booth_id", "label", "score", "tag", "reason", "tradeoffs", "best_for"],
            },
        },
        "best_value": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "booth_id": {"type": "string"},
                "label": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["booth_id", "label", "reason"],
        },
        "highest_visibility": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "booth_id": {"type": "string"},
                "label": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["booth_id", "label", "reason"],
        },
        "budget_friendly": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "booth_id": {"type": "string"},
                "label": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["booth_id", "label", "reason"],
        },
        "avoid": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "booth_id": {"type": "string"},
                    "label": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["booth_id", "label", "reason"],
            },
        },
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "vendor_tip": {"type": "string"},
        "human_review_required": {"type": "boolean"},
    },
    "required": [
        "strategy_summary",
        "top_recommendations",
        "best_value",
        "highest_visibility",
        "budget_friendly",
        "avoid",
        "assumptions",
        "vendor_tip",
        "human_review_required",
    ],
}


APPLICATION_NOTE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "application_note": {"type": "string"},
        "short_pitch": {"type": "string"},
        "talking_points": {"type": "array", "items": {"type": "string"}},
        "questions_for_organizer": {"type": "array", "items": {"type": "string"}},
        "prep_checklist": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": [
        "application_note",
        "short_pitch",
        "talking_points",
        "questions_for_organizer",
        "prep_checklist",
        "confidence",
    ],
}


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _category_slug(value: Any) -> str:
    text = _safe_lower(value)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    aliases = {
        "food": "food-vendor",
        "food-vendors": "food-vendor",
        "food-truck": "food-truck",
        "food-trucks": "food-truck",
        "tech": "technology",
        "technology-electronics": "technology",
        "technology-and-electronics": "technology",
        "arts-crafts": "arts-and-crafts",
        "art": "arts-and-crafts",
        "artists": "arts-and-crafts",
        "beauty-wellness": "beauty-and-wellness",
        "beauty": "beauty-and-wellness",
    }
    return aliases.get(text, text)


def _flatten_categories(value: Any) -> List[str]:
    out: List[str] = []

    def add(item: Any) -> None:
        if item is None:
            return
        if isinstance(item, list):
            for sub in item:
                add(sub)
            return
        if isinstance(item, tuple) or isinstance(item, set):
            for sub in item:
                add(sub)
            return
        if isinstance(item, dict):
            for key in ("name", "label", "category", "value", "title"):
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


def _active_paid_vendor(profile: Optional[Profile], user: Optional[Dict[str, Any]] = None) -> bool:
    """Strict paid gate for vendor AI tools.

    This does NOT unlock from verification, featured, promoted, or visibility_tier alone.
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
    if profile is None:
        return _unique_categories([
            data.get("categories"),
            data.get("vendor_categories"),
            data.get("business_type"),
            data.get("businessType"),
        ])

    return _unique_categories([
        profile.categories,
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
    ])


def _event_categories(event_data: Dict[str, Any]) -> List[str]:
    return _unique_categories([
        event_data.get("desired_vendor_categories"),
        event_data.get("desiredVendorCategories"),
        event_data.get("vendor_categories_needed"),
        event_data.get("vendorCategoriesNeeded"),
        event_data.get("looking_for_categories"),
        event_data.get("lookingForCategories"),
        event_data.get("vendor_categories"),
        event_data.get("vendorCategories"),
        event_data.get("categories"),
        event_data.get("category"),
    ])


def _dt_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return _safe_str(value) or None


AI_PAYLOAD_MAX_CHARS = int(os.getenv("OPENAI_VENDOR_ASSIST_PAYLOAD_MAX_CHARS", "18000"))


def _clip(value: Any, limit: int = 900) -> str:
    """Keep AI prompts small and strip huge data URLs/base64 blobs."""
    text = _safe_str(value)
    if not text:
        return ""

    if text.startswith("data:"):
        comma = text.find(",")
        header = text[:comma] if comma > 0 else "data"
        return f"{header},[omitted-large-file-data]"

    text = re.sub(r"data:[^\\s,;]+;base64,[A-Za-z0-9+/=]{200,}", "[omitted-large-file-data]", text)
    text = re.sub(r"[A-Za-z0-9+/=]{1500,}", "[omitted-large-encoded-content]", text)

    if len(text) > limit:
        return text[:limit].rstrip() + "…"
    return text


def _compact_list(value: Any, *, limit: int = 12, text_limit: int = 220) -> List[str]:
    items = _flatten_categories(value) if not isinstance(value, list) else value
    out: List[str] = []
    for item in items:
        if isinstance(item, dict):
            label = _safe_str(item.get("name") or item.get("label") or item.get("category") or item.get("title") or item.get("value"))
        else:
            label = _safe_str(item)
        if not label:
            continue
        clipped = _clip(label, text_limit)
        if clipped and clipped not in out:
            out.append(clipped)
        if len(out) >= limit:
            break
    return out


def _compact_offerings(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    out: List[Dict[str, Any]] = []
    for item in value[:10]:
        if not isinstance(item, dict):
            label = _safe_str(item)
            if label:
                out.append({"name": _clip(label, 140)})
            continue

        out.append({
            "name": _clip(item.get("name") or item.get("title") or item.get("label"), 140),
            "category": _clip(item.get("category") or item.get("type"), 120),
            "description": _clip(item.get("description") or item.get("details"), 280),
            "price": _clip(item.get("price") or item.get("price_label") or item.get("priceLabel"), 80),
            "tags": _compact_list(item.get("tags") or item.get("keywords") or [], limit=5, text_limit=60),
        })

    return [row for row in out if any(row.values())]


def _compact_documents(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for doc in docs[:25]:
        if not isinstance(doc, dict):
            continue

        out.append({
            "document_type": _clip(doc.get("document_type") or doc.get("type") or doc.get("category"), 90),
            "display_name": _clip(doc.get("display_name") or doc.get("label") or doc.get("name"), 120),
            "status": _clip(doc.get("status"), 80),
            "review_status": _clip(doc.get("review_status"), 80),
            "scan_status": _clip(doc.get("scan_status"), 80),
            "expires_at": _clip(doc.get("expires_at") or doc.get("expiration_date") or doc.get("expirationDate"), 80),
            "uploaded_at": _clip(doc.get("uploaded_at") or doc.get("uploadedAt"), 80),
        })

    return out


def _compact_ai_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Last safety pass so one oversized profile/event cannot break OpenAI context."""
    def compact(value: Any, depth: int = 0) -> Any:
        if depth > 5:
            return _clip(value, 180)

        if isinstance(value, str):
            return _clip(value, 900 if depth < 3 else 320)

        if isinstance(value, (int, float, bool)) or value is None:
            return value

        if isinstance(value, list):
            return [compact(item, depth + 1) for item in value[:20]]

        if isinstance(value, dict):
            clean: Dict[str, Any] = {}
            for key, item in value.items():
                key_text = _safe_lower(key)
                if any(token in key_text for token in ("image", "photo", "video", "file", "url", "base64", "data_url", "raw", "blob")):
                    if key_text in {"event_url", "apply_url"}:
                        clean[key] = _clip(item, 180)
                    continue
                clean[str(key)[:80]] = compact(item, depth + 1)
            return clean

        return _clip(value, 180)

    compacted = compact(payload)
    dumped = json.dumps(compacted, default=str)

    if len(dumped) <= AI_PAYLOAD_MAX_CHARS:
        return compacted

    # Hard fallback: preserve only the most important decision inputs.
    vendor = compacted.get("vendor", {}) if isinstance(compacted, dict) else {}
    event = compacted.get("event", {}) if isinstance(compacted, dict) else {}
    return {
        "task": compacted.get("task") if isinstance(compacted, dict) else "vendor_ai_assist",
        "vendor": {
            "business_name": vendor.get("business_name"),
            "city": vendor.get("city"),
            "state": vendor.get("state"),
            "categories": (vendor.get("categories") or [])[:10],
            "description": _clip(vendor.get("description"), 500),
            "offerings": (vendor.get("offerings") or [])[:6],
            "documents": (vendor.get("documents") or [])[:15],
        },
        "event": {
            "id": event.get("id"),
            "title": event.get("title") or event.get("name"),
            "description": _clip(event.get("description"), 700),
            "city": event.get("city"),
            "state": event.get("state"),
            "venue_name": event.get("venue_name") or event.get("venueName"),
            "start_date": event.get("start_date") or event.get("startDate"),
            "end_date": event.get("end_date") or event.get("endDate"),
            "category": event.get("category"),
            "desired_vendor_categories": (event.get("desired_vendor_categories") or event.get("desiredVendorCategories") or [])[:12],
            "requirements": (event.get("requirements") or event.get("event_requirements") or [])[:15],
        },
        "matching_hint": compacted.get("matching_hint", {}) if isinstance(compacted, dict) else {},
    }


def _event_from_db(db: Session, event_id: int) -> Optional[Event]:
    return db.query(Event).filter(Event.id == int(event_id)).one_or_none()


def _event_payload(db: Session, event_id: int) -> Dict[str, Any]:
    ev = _event_from_db(db, event_id)
    if ev is None:
        raise HTTPException(status_code=404, detail="Event not found.")

    try:
        store_module.load_store()
    except Exception:
        pass

    store_payload = {}
    try:
        store_payload = store_module._EVENTS.get(int(ev.id or 0), {})  # type: ignore[attr-defined]
        if not isinstance(store_payload, dict):
            store_payload = {}
    except Exception:
        store_payload = {}

    payload: Dict[str, Any] = {
        "id": ev.id,
        "title": _clip(ev.title, 180),
        "name": _clip(ev.title, 180),
        "description": _clip(ev.description, 1100),
        "start_date": _dt_to_iso(ev.start_date),
        "startDate": _dt_to_iso(ev.start_date),
        "end_date": _dt_to_iso(ev.end_date),
        "endDate": _dt_to_iso(ev.end_date),
        "venue_name": _clip(ev.venue_name, 180),
        "venueName": _clip(ev.venue_name, 180),
        "city": _clip(ev.city, 100),
        "state": _clip(ev.state, 80),
        "category": _clip(ev.category, 100),
        "published": bool(ev.published),
        "archived": bool(ev.archived),
        "organizer_email": _clip(ev.organizer_email, 140),
        "owner_email": _clip(ev.owner_email, 140),
    }

    # Whitelist only useful event fields. Do NOT copy the whole store payload;
    # older events can contain data URLs / base64 media that exceed model context.
    allowed_store_keys = [
        "status",
        "lifecycle_status",
        "lifecycleStatus",
        "accepting_vendors",
        "acceptingVendors",
        "desired_vendor_categories",
        "desiredVendorCategories",
        "vendor_categories_needed",
        "vendorCategoriesNeeded",
        "looking_for_categories",
        "lookingForCategories",
        "vendor_categories",
        "vendorCategories",
        "categories",
        "requirements",
        "event_requirements",
        "requirement_summary",
        "booth_price",
        "booth_fee",
        "vendor_fee",
        "price",
        "available_booths",
        "remaining_booths",
        "total_booths",
        "booth_count",
        "application_count",
        "applications_count",
    ]

    for key in allowed_store_keys:
        value = store_payload.get(key)
        if value in (None, "", [], {}):
            continue
        if "categor" in key.lower():
            payload[key] = _compact_list(value, limit=15, text_limit=120)
        elif "requirement" in key.lower():
            if isinstance(value, list):
                payload[key] = [_clip(item, 220) if not isinstance(item, dict) else {
                    "name": _clip(item.get("name") or item.get("label") or item.get("title"), 120),
                    "type": _clip(item.get("type") or item.get("document_type"), 100),
                    "required": item.get("required", True),
                    "category": _clip(item.get("category"), 100),
                } for item in value[:20]]
            else:
                payload[key] = _clip(value, 600)
        else:
            payload[key] = value if isinstance(value, (int, float, bool)) else _clip(value, 180)

    categories = _event_categories(payload)
    if categories:
        compact_categories = _compact_list(categories, limit=15, text_limit=120)
        payload["desired_vendor_categories"] = compact_categories
        payload["desiredVendorCategories"] = compact_categories
        payload["vendor_categories_needed"] = compact_categories

    return payload



def _document_rows(db: Session, email: str) -> List[Dict[str, Any]]:
    docs: List[Dict[str, Any]] = []
    try:
        from app.models.verification_document import VerificationDocument

        rows = (
            db.query(VerificationDocument)
            .filter(func.lower(VerificationDocument.owner_email) == _safe_lower(email))
            .filter(VerificationDocument.owner_role == "vendor")
            .order_by(VerificationDocument.updated_at.desc())
            .limit(50)
            .all()
        )
        for row in rows:
            docs.append({
                "document_type": row.document_type,
                "display_name": row.display_name,
                "status": row.status,
                "review_status": row.review_status,
                "scan_status": row.scan_status,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
            })
    except Exception:
        pass
    return docs


def _profile_documents(profile: Optional[Profile]) -> List[Dict[str, Any]]:
    data = _profile_data(profile)
    raw_docs = data.get("documents")
    if not isinstance(raw_docs, list):
        return []

    docs: List[Dict[str, Any]] = []
    for item in raw_docs:
        if not isinstance(item, dict):
            continue
        docs.append({
            "document_type": item.get("document_type") or item.get("type") or item.get("category"),
            "display_name": item.get("display_name") or item.get("label") or item.get("name"),
            "status": item.get("status") or item.get("review_status"),
            "review_status": item.get("review_status"),
            "expires_at": item.get("expires_at") or item.get("expiration_date") or item.get("expirationDate"),
            "uploaded_at": item.get("uploaded_at") or item.get("uploadedAt"),
        })
    return docs


def _vendor_context(db: Session, user: Dict[str, Any], profile: Optional[Profile]) -> Dict[str, Any]:
    data = _profile_data(profile)
    email = _safe_lower(user.get("email") or (profile.email if profile else ""))
    docs = _document_rows(db, email) + _profile_documents(profile)

    raw_offerings = (
        data.get("offerings")
        or data.get("vendor_offerings")
        or data.get("vendorOfferings")
        or data.get("menu_items")
        or data.get("menuItems")
        or []
    )

    return {
        "email": _clip(email, 140),
        "business_name": _clip(
            (profile.business_name if profile is not None else None)
            or data.get("business_name")
            or data.get("businessName")
            or data.get("company_name")
            or data.get("companyName")
            or data.get("display_name")
            or user.get("full_name")
            or user.get("email"),
            180,
        ),
        "display_name": _clip(
            (profile.display_name if profile is not None else None)
            or data.get("display_name")
            or data.get("displayName"),
            140,
        ),
        "city": _clip((profile.city if profile is not None else None) or data.get("city"), 100),
        "state": _clip((profile.state if profile is not None else None) or data.get("state"), 80),
        "categories": _compact_list(_profile_categories(profile), limit=15, text_limit=120),
        "description": _clip(data.get("description") or data.get("business_description") or data.get("businessDescription") or data.get("bio"), 900),
        "offerings": _compact_offerings(raw_offerings),
        "setup_requirements": _clip(data.get("setup_requirements") or data.get("setupRequirements") or data.get("booth_needs") or data.get("boothNeeds"), 400),
        "service_area": _clip(data.get("service_area") or data.get("serviceArea"), 220),
        "documents": _compact_documents(docs),
    }



def _booth_value(booth: Dict[str, Any], *keys: str) -> Any:
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    for key in keys:
        if key in booth and booth.get(key) not in (None, "", [], {}):
            return booth.get(key)
        if key in meta and meta.get(key) not in (None, "", [], {}):
            return meta.get(key)
    return None


def _booth_label(booth: Dict[str, Any], fallback: str = "Booth") -> str:
    return _clip(
        _booth_value(
            booth,
            "label",
            "booth_label",
            "boothLabel",
            "number",
            "booth_number",
            "boothNumber",
            "name",
            "booth_name",
            "boothName",
            "code",
            "id",
        )
        or fallback,
        90,
    )


def _booth_id(booth: Dict[str, Any], fallback: str = "") -> str:
    return _clip(
        _booth_value(booth, "id", "booth_id", "boothId", "selected_booth_id", "selectedBoothId")
        or fallback
        or _booth_label(booth, "booth"),
        120,
    )


def _booth_status(booth: Dict[str, Any]) -> str:
    return _safe_lower(_booth_value(booth, "status", "state", "availability") or "available")


def _booth_price(booth: Dict[str, Any]) -> float:
    for key in ("price", "booth_price", "boothPrice", "amount", "cost", "vendor_fee", "vendorFee"):
        raw = _booth_value(booth, key)
        if raw in (None, ""):
            continue
        try:
            value = float(str(raw).replace("$", "").replace(",", "").strip())
            if value >= 0:
                return value
        except Exception:
            continue

    for key in ("price_cents", "priceCents", "amount_cents", "amountCents", "booth_price_cents", "boothPriceCents"):
        raw = _booth_value(booth, key)
        try:
            value = float(raw)
            if value >= 0:
                return round(value / 100, 2)
        except Exception:
            continue

    return 0.0


def _booth_category(booth: Dict[str, Any]) -> str:
    return _clip(
        _booth_value(
            booth,
            "category",
            "booth_category",
            "boothCategory",
            "category_name",
            "categoryName",
            "vendor_category",
            "vendorCategory",
        )
        or "",
        120,
    )


def _iter_diagram_booths(diagram: Dict[str, Any]) -> List[Dict[str, Any]]:
    booths: List[Dict[str, Any]] = []

    if isinstance(diagram.get("booths"), list):
        booths.extend([item for item in diagram.get("booths", []) if isinstance(item, dict)])

    if isinstance(diagram.get("levels"), list):
        for level in diagram.get("levels", []):
            if not isinstance(level, dict):
                continue
            for booth in level.get("booths") or []:
                if isinstance(booth, dict):
                    copy = dict(booth)
                    copy.setdefault("level_id", level.get("id"))
                    copy.setdefault("level_name", level.get("name"))
                    booths.append(copy)

    seen = set()
    clean: List[Dict[str, Any]] = []
    for index, booth in enumerate(booths, start=1):
        bid = _booth_id(booth, f"booth-{index}")
        if not bid or bid in seen:
            continue
        seen.add(bid)
        clean.append(booth)

    return clean


def _iter_diagram_elements(diagram: Dict[str, Any]) -> List[Dict[str, Any]]:
    elements: List[Dict[str, Any]] = []

    if isinstance(diagram.get("elements"), list):
        elements.extend([item for item in diagram.get("elements", []) if isinstance(item, dict)])

    if isinstance(diagram.get("levels"), list):
        for level in diagram.get("levels", []):
            if not isinstance(level, dict):
                continue
            for el in level.get("elements") or []:
                if isinstance(el, dict):
                    copy = dict(el)
                    copy.setdefault("level_id", level.get("id"))
                    copy.setdefault("level_name", level.get("name"))
                    elements.append(copy)

    out: List[Dict[str, Any]] = []
    for item in elements[:60]:
        out.append({
            "id": _clip(item.get("id"), 80),
            "type": _clip(item.get("type"), 80),
            "label": _clip(item.get("label") or item.get("name"), 120),
            "x": float(item.get("x") or 0),
            "y": float(item.get("y") or 0),
            "width": float(item.get("width") or 0),
            "height": float(item.get("height") or 0),
        })
    return out


def _compact_booths_for_ai(booths: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for index, booth in enumerate(booths[:150], start=1):
        status = _booth_status(booth)
        out.append({
            "id": _booth_id(booth, f"booth-{index}"),
            "label": _booth_label(booth, f"Booth {index}"),
            "status": status or "available",
            "is_available": status in {"", "available", "open"},
            "category": _booth_category(booth),
            "price": _booth_price(booth),
            "x": float(_booth_value(booth, "x", "left") or 0),
            "y": float(_booth_value(booth, "y", "top") or 0),
            "width": float(_booth_value(booth, "width", "w") or 0),
            "height": float(_booth_value(booth, "height", "h") or 0),
            "level": _clip(booth.get("level_name") or booth.get("level_id"), 120),
            "zone": _clip(_booth_value(booth, "zoneName", "zone", "area"), 120),
            "tier": _clip(_booth_value(booth, "tierName", "tier", "pricing_tier", "pricingTier"), 120),
            "premium": bool(_booth_value(booth, "isPremium", "is_premium", "premium")),
            "power": bool(_booth_value(booth, "power", "has_power", "hasPower", "electricity")),
            "water": bool(_booth_value(booth, "water", "has_water", "hasWater")),
        })

    return out


def _diagram_payload(db: Session, event_id: int) -> Dict[str, Any]:
    row = (
        db.query(Diagram)
        .filter(Diagram.event_id == int(event_id))
        .order_by(Diagram.id.desc())
        .first()
    )

    if row is None or not isinstance(row.diagram, dict):
        raise HTTPException(status_code=404, detail="No booth layout found for this event.")

    diagram = dict(row.diagram or {})
    canvas = diagram.get("canvas") if isinstance(diagram.get("canvas"), dict) else {}
    booths = _iter_diagram_booths(diagram)
    elements = _iter_diagram_elements(diagram)
    compact_booths = _compact_booths_for_ai(booths)

    available = [booth for booth in compact_booths if booth.get("is_available")]
    if not available:
        raise HTTPException(status_code=400, detail="No available booths found for AI recommendation.")

    return {
        "canvas": {
            "width": float(canvas.get("width") or 1400),
            "height": float(canvas.get("height") or 900),
            "gridSize": float(canvas.get("gridSize") or 20),
        },
        "booths": compact_booths,
        "available_booths": available,
        "elements": elements,
        "booth_count": len(compact_booths),
        "available_count": len(available),
    }


def _client() -> OpenAI:
    if OpenAI is None:
        raise HTTPException(status_code=500, detail="OpenAI SDK is not installed on the backend.")
    api_key = _safe_str(os.getenv("OPENAI_API_KEY"))
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured on the backend.")
    return OpenAI(api_key=api_key)


def _extract_output_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return str(output_text)

    try:
        output = getattr(response, "output", None) or []
        chunks: List[str] = []
        for item in output:
            for content in getattr(item, "content", []) or []:
                text = getattr(content, "text", None)
                if text:
                    chunks.append(str(text))
        if chunks:
            return "\n".join(chunks)
    except Exception:
        pass

    return ""


def _run_structured_ai(*, schema_name: str, schema: Dict[str, Any], system_prompt: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    model = _safe_str(os.getenv("OPENAI_VENDOR_ASSIST_MODEL") or os.getenv("OPENAI_VERIFICATION_MODEL") or "gpt-4.1-mini")
    client = _client()
    compact_payload = _compact_ai_payload(payload)

    try:
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": json.dumps(compact_payload, default=str),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        text = _extract_output_text(response)
        if not text:
            raise RuntimeError("OpenAI returned an empty response.")
        result = json.loads(text)
        result["model"] = model
        result["generated_at"] = _now_iso()
        return result
    except HTTPException:
        raise
    except Exception as exc:
        detail = str(exc)
        if "context_length_exceeded" in detail or "exceeds the context window" in detail:
            raise HTTPException(
                status_code=502,
                detail="AI vendor assist failed because the event/profile payload was too large. The backend now compacts payloads; retry the request after redeploy.",
            )
        raise HTTPException(status_code=502, detail=f"AI vendor assist failed: {detail}")



def _premium_required_response() -> Dict[str, Any]:
    return {
        "ok": True,
        "premium_required": True,
        "message": "AI vendor assistance is available to active Premium Vendor subscribers.",
    }


@router.post("/vendor/ai/event-fit/{event_id}")
def generate_vendor_event_fit(
    event_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    if not _active_paid_vendor(profile, user):
        return _premium_required_response()

    event_data = _event_payload(db, int(event_id))
    vendor_data = _vendor_context(db, user, profile)

    system_prompt = (
        "You are VendCore's AI vendor assistant. Score how well a vendor fits an event using only the provided vendor profile, "
        "event details, categories, requirements, and document metadata. Be practical, concise, and transparent. "
        "Do not claim documents are authentic. Do not claim approval is guaranteed. "
        "Document readiness is a pre-check only and final decisions remain with organizers/admins."
    )

    result = _run_structured_ai(
        schema_name="vendor_event_fit",
        schema=FIT_SCORE_SCHEMA,
        system_prompt=system_prompt,
        payload={
            "task": "score_event_fit",
            "vendor": vendor_data,
            "event": event_data,
            "matching_hint": {
                "vendor_categories": vendor_data.get("categories", []),
                "event_categories": _event_categories(event_data),
                "category_overlap": sorted(
                    list({_category_slug(x) for x in vendor_data.get("categories", [])}.intersection({_category_slug(x) for x in _event_categories(event_data)}))
                ),
            },
        },
    )

    return {
        "ok": True,
        "premium_required": False,
        "event_id": int(event_id),
        "fit": result,
        "ai_fit": result,
    }


@router.post("/vendor/ai/application-note/{event_id}")
def generate_vendor_application_note(
    event_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    if not _active_paid_vendor(profile, user):
        return _premium_required_response()

    event_data = _event_payload(db, int(event_id))
    vendor_data = _vendor_context(db, user, profile)

    system_prompt = (
        "You are VendCore's AI application assistant for vendors. Draft a professional event application note that is specific to the vendor and event. "
        "Keep it truthful and do not invent credentials, permits, insurance, sales, or experience. "
        "Mention uploaded documents only as 'uploaded/available' if they are present in the provided metadata. "
        "The tone should be confident, concise, and organizer-friendly."
    )

    result = _run_structured_ai(
        schema_name="vendor_application_note",
        schema=APPLICATION_NOTE_SCHEMA,
        system_prompt=system_prompt,
        payload={
            "task": "draft_application_note",
            "vendor": vendor_data,
            "event": event_data,
            "event_categories": _event_categories(event_data),
        },
    )

    return {
        "ok": True,
        "premium_required": False,
        "event_id": int(event_id),
        "draft": result,
        "application_assist": result,
    }




@router.post("/vendor/ai/booth-advisor/{event_id}")
def generate_vendor_booth_advisor(
    event_id: int,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _safe_lower(user.get("role")) != "vendor":
        raise HTTPException(status_code=403, detail="Vendor account required.")

    profile = _get_vendor_profile(db, user)
    if not _active_paid_vendor(profile, user):
        return _premium_required_response()

    event_data = _event_payload(db, int(event_id))
    vendor_data = _vendor_context(db, user, profile)
    diagram_data = _diagram_payload(db, int(event_id))

    system_prompt = (
        "You are VendCore's AI Booth Advisor. Recommend booths for a vendor using only the provided event, vendor, booth, and map-element data. "
        "Recommend only booth IDs that appear in available_booths. Do not invent booths. "
        "Use practical reasoning: traffic potential from map position/elements, category fit, booth price/value, booth size, premium tiers, power/water needs when available, "
        "and possible trade-offs. Do not guarantee sales or organizer approval."
    )

    result = _run_structured_ai(
        schema_name="vendor_booth_advisor",
        schema=BOOTH_ADVISOR_SCHEMA,
        system_prompt=system_prompt,
        payload={
            "task": "recommend_booth_location",
            "vendor": vendor_data,
            "event": event_data,
            "diagram": diagram_data,
            "instructions": {
                "recommend_only_available_booths": True,
                "return_exact_booth_id_from_available_booths": True,
                "include_best_value_highest_visibility_and_budget_friendly": True,
                "include_booths_to_avoid_if_any": True,
            },
        },
    )

    available_ids = {str(booth.get("id")) for booth in diagram_data.get("available_booths", [])}
    available_labels = {str(booth.get("label")) for booth in diagram_data.get("available_booths", [])}

    def clean_pick(pick: Dict[str, Any]) -> Dict[str, Any]:
        booth_id = str(pick.get("booth_id") or "").strip()
        label = str(pick.get("label") or "").strip()

        if booth_id not in available_ids and label in available_ids:
            booth_id = label

        if booth_id not in available_ids and booth_id not in available_labels:
            pick["warning"] = "AI returned a booth that is not currently available; confirm before selecting."
        return pick

    if isinstance(result.get("top_recommendations"), list):
        result["top_recommendations"] = [clean_pick(dict(item)) for item in result.get("top_recommendations", []) if isinstance(item, dict)]

    for key in ("best_value", "highest_visibility", "budget_friendly"):
        if isinstance(result.get(key), dict):
            result[key] = clean_pick(dict(result[key]))

    if isinstance(result.get("avoid"), list):
        result["avoid"] = [dict(item) for item in result.get("avoid", []) if isinstance(item, dict)]

    return {
        "ok": True,
        "premium_required": False,
        "event_id": int(event_id),
        "advisor": result,
        "booth_advisor": result,
    }


@router.get("/vendor/ai/status")
def get_vendor_ai_status(
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
        "features": {
            "event_fit_score": active,
            "application_note_assistant": active,
            "document_readiness_coach": active,
        },
    }
