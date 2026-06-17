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
        "title": ev.title,
        "name": ev.title,
        "description": ev.description,
        "start_date": _dt_to_iso(ev.start_date),
        "startDate": _dt_to_iso(ev.start_date),
        "end_date": _dt_to_iso(ev.end_date),
        "endDate": _dt_to_iso(ev.end_date),
        "venue_name": ev.venue_name,
        "venueName": ev.venue_name,
        "city": ev.city,
        "state": ev.state,
        "category": ev.category,
        "published": bool(ev.published),
        "archived": bool(ev.archived),
        "organizer_email": ev.organizer_email,
        "owner_email": ev.owner_email,
    }

    for key, value in store_payload.items():
        if key not in payload or value not in (None, "", [], {}):
            payload[key] = value

    categories = _event_categories(payload)
    if categories:
        payload["desired_vendor_categories"] = categories
        payload["desiredVendorCategories"] = categories
        payload["vendor_categories_needed"] = categories

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

    return {
        "email": email,
        "business_name": (
            (profile.business_name if profile is not None else None)
            or data.get("business_name")
            or data.get("businessName")
            or data.get("company_name")
            or data.get("companyName")
            or data.get("display_name")
            or user.get("full_name")
            or user.get("email")
        ),
        "display_name": (
            (profile.display_name if profile is not None else None)
            or data.get("display_name")
            or data.get("displayName")
        ),
        "city": (profile.city if profile is not None else None) or data.get("city"),
        "state": (profile.state if profile is not None else None) or data.get("state"),
        "categories": _profile_categories(profile),
        "description": data.get("description") or data.get("business_description") or data.get("businessDescription") or data.get("bio"),
        "offerings": data.get("offerings") or data.get("vendor_offerings") or data.get("vendorOfferings") or data.get("menu_items") or data.get("menuItems") or [],
        "setup_requirements": data.get("setup_requirements") or data.get("setupRequirements") or data.get("booth_needs") or data.get("boothNeeds"),
        "service_area": data.get("service_area") or data.get("serviceArea"),
        "documents": docs[:50],
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
                    "content": json.dumps(payload, default=str),
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
        raise HTTPException(status_code=502, detail=f"AI vendor assist failed: {exc}")


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
