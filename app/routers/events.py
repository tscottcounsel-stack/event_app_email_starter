from __future__ import annotations

# VENDCORE_REQUIREMENTS_SAVE_FIX_2026_06_05

import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.permissions import require_event_limit
from app.db import get_db
from app.models.event import Event
from app.models.diagram import Diagram
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


DEFAULT_PAGE_LIMIT = 24
MAX_PAGE_LIMIT = 100


def _page_limit(value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = DEFAULT_PAGE_LIMIT
    return max(1, min(n, MAX_PAGE_LIMIT))


def _page_offset(value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = 0
    return max(0, n)


def _pagination_payload(items: list[Dict[str, Any]], limit: int, offset: int) -> Dict[str, Any]:
    safe_limit = _page_limit(limit)
    safe_offset = _page_offset(offset)
    total = len(items)
    page = items[safe_offset:safe_offset + safe_limit]
    return {
        "events": page,
        "items": page,
        "count": len(page),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + safe_limit < total,
    }


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



def _event_end_datetime_value(event_data: Dict[str, Any]) -> Optional[datetime]:
    """Return the best lifecycle date for an event as UTC.

    End date wins; start date is the fallback for one-day events.
    """
    value = event_data.get("end_date") or event_data.get("endDate") or event_data.get("start_date") or event_data.get("startDate")
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _event_is_past(event_data: Dict[str, Any]) -> bool:
    lifecycle_date = _event_end_datetime_value(event_data)
    if lifecycle_date is None:
        return False
    today = datetime.now(timezone.utc).date()
    return lifecycle_date.date() < today


def _event_is_canceled(event_data: Dict[str, Any]) -> bool:
    status = str(
        event_data.get("status")
        or event_data.get("lifecycle_status")
        or event_data.get("lifecycleStatus")
        or ""
    ).strip().lower()
    return bool(
        event_data.get("canceled")
        or event_data.get("cancelled")
        or event_data.get("canceled_at")
        or event_data.get("cancelled_at")
        or status in {"canceled", "cancelled", "event_canceled"}
    )


def _event_lifecycle_status(event_data: Dict[str, Any]) -> str:
    raw_status = str(event_data.get("status") or "").strip().lower()
    if _event_is_canceled(event_data):
        return "canceled"
    if raw_status == "closed":
        return "closed"
    if bool(event_data.get("archived")):
        return "archived"
    if _event_is_past(event_data):
        return "completed"
    if bool(event_data.get("published")):
        return "published"
    return "draft"


def _event_is_active_marketplace_event(event_data: Dict[str, Any]) -> bool:
    return (
        bool(event_data.get("published"))
        and not bool(event_data.get("archived"))
        and not _event_is_canceled(event_data)
        and not _event_is_past(event_data)
    )


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
    store_payload = _EVENTS.get(int(ev.id or 0), {}) if isinstance(_EVENTS.get(int(ev.id or 0)), dict) else {}
    payload = {
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

    # Store-only operational metadata is preserved here because the Event model
    # currently stores published/archived in Postgres while cancellation details
    # live in the event store until the schema is expanded.
    for key in (
        "status",
        "accepting_vendors",
        "acceptingVendors",
        "canceled",
        "cancelled",
        "canceled_at",
        "cancelled_at",
        "cancellation_reason",
        "cancellation_message",
        "canceled_by",
        # Organizer-selected needs live in the runtime store until the
        # Event model grows dedicated JSON columns. Keep these fields on every
        # event payload so the public event page can show "What the organizer needs".
        "desired_vendor_categories",
        "desiredVendorCategories",
        "vendor_categories_needed",
        "looking_for_categories",
        "vendor_categories",
    ):
        if key in store_payload:
            payload[key] = store_payload.get(key)

    # Canonicalize the selected needs across old/new field names.
    selected_needs = _unique_categories([
        payload.get("desired_vendor_categories"),
        payload.get("desiredVendorCategories"),
        payload.get("vendor_categories_needed"),
        payload.get("looking_for_categories"),
        payload.get("vendor_categories"),
    ])
    if selected_needs:
        payload["desired_vendor_categories"] = selected_needs
        payload["desiredVendorCategories"] = selected_needs
        payload["vendor_categories_needed"] = selected_needs
        payload["looking_for_categories"] = selected_needs
        payload["vendor_categories"] = selected_needs

    payload["is_past"] = _event_is_past(payload)
    payload["lifecycle_status"] = _event_lifecycle_status(payload)
    payload["active_marketplace_event"] = _event_is_active_marketplace_event(payload)
    return payload


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


# ---------------- Requirements public payload helpers ----------------

def _req_as_list(value: Any) -> list[Dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        out: list[Dict[str, Any]] = []
        for key, raw in value.items():
            if isinstance(raw, dict):
                out.append({"id": str(key), **raw})
            elif raw:
                out.append({"id": str(key), "text": str(raw)})
        return out
    return []


def _req_bucket(raw: Any) -> Dict[str, list[Dict[str, Any]]]:
    if not isinstance(raw, dict):
        return {"compliance": [], "documents": []}
    compliance: list[Dict[str, Any]] = []
    documents: list[Dict[str, Any]] = []
    for key in ("compliance", "compliance_items", "complianceItems", "items", "requirements"):
        compliance.extend(_req_as_list(raw.get(key)))
    for key in ("documents", "docs", "document_requirements", "documentRequirements", "required_documents", "requiredDocuments"):
        documents.extend(_req_as_list(raw.get(key)))
    return {"compliance": _dedupe_req_items(compliance), "documents": _dedupe_req_items(documents)}


def _dedupe_req_items(items: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    seen: set[str] = set()
    out: list[Dict[str, Any]] = []
    for item in items:
        key = str(item.get("id") or item.get("key") or item.get("name") or item.get("title") or item.get("label") or item.get("text") or "").strip().lower()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(item)
    return out


def _merge_req_bucket(target: Dict[str, list[Dict[str, Any]]], raw: Any) -> None:
    bucket = _req_bucket(raw)
    target.setdefault("compliance", [])
    target.setdefault("documents", [])
    target["compliance"].extend(bucket.get("compliance") or [])
    target["documents"].extend(bucket.get("documents") or [])
    target["compliance"] = _dedupe_req_items(target["compliance"])
    target["documents"] = _dedupe_req_items(target["documents"])

def _event_wide_baseline_bucket() -> Dict[str, list[Dict[str, Any]]]:
    """Baseline requirements that apply to every vendor.

    The organizer requirements page uses these as the default global rules.
    Keeping the same fallback here prevents the public/vendor endpoint from
    returning an empty global bucket when the legacy runtime store has been
    reset or the save payload arrives in an older shape.
    """
    return {
        "compliance": [
            {
                "id": "event_rules",
                "text": "Vendors must follow all event rules and staff instructions",
                "required": True,
            },
            {
                "id": "setup_teardown",
                "text": "Vendors must comply with setup and teardown timing",
                "required": True,
            },
        ],
        "documents": [],
    }


def _ensure_event_wide_baseline(global_bucket: Dict[str, list[Dict[str, Any]]]) -> Dict[str, list[Dict[str, Any]]]:
    bucket = {
        "compliance": _dedupe_req_items(list((global_bucket or {}).get("compliance") or [])),
        "documents": _dedupe_req_items(list((global_bucket or {}).get("documents") or [])),
    }
    if not bucket["compliance"] and not bucket["documents"]:
        return _event_wide_baseline_bucket()
    return bucket



def _requirements_payload_for_event(event_id: int, db: Optional[Session] = None) -> Dict[str, Any]:
    """Return requirements in the vendor-facing shape.

    Event-wide requirements are intentionally pulled from every legacy key we
    have used so the vendor page does not show 0 global items when the organizer
    actually saved all-vendor requirements.
    """
    sources: list[Dict[str, Any]] = []

    for key in (event_id, str(event_id)):
        value = _REQUIREMENTS.get(key)
        if isinstance(value, dict):
            sources.append(value)

    store_event = _EVENTS.get(event_id) or _EVENTS.get(str(event_id))
    if isinstance(store_event, dict):
        if isinstance(store_event.get("requirements"), dict):
            sources.append(store_event.get("requirements") or {})
        for key in (
            "global",
            "globalRequirements",
            "global_requirements",
            "allVendorRequirements",
            "all_vendor_requirements",
            "appliesToAllVendors",
            "applies_to_all_vendors",
            "categories",
            "categoryRequirements",
            "category_requirements",
        ):
            if isinstance(store_event.get(key), (dict, list)):
                sources.append({key: store_event.get(key)})

    # Some deployments keep requirement JSON in the SQL event row data fields.
    if db is not None:
        try:
            row = db.query(Event).filter(Event.id == int(event_id)).first()
            if row:
                for attr in ("requirements", "data", "settings", "metadata", "extra"):
                    value = getattr(row, attr, None)
                    if isinstance(value, dict):
                        sources.append(value)
        except Exception:
            pass

    global_bucket: Dict[str, list[Dict[str, Any]]] = {"compliance": [], "documents": []}
    categories: Dict[str, Dict[str, list[Dict[str, Any]]]] = {}

    for source in sources:
        root = source.get("requirements") if isinstance(source.get("requirements"), dict) else source
        if not isinstance(root, dict):
            continue

        for key in (
            "global",
            "globalRequirements",
            "global_requirements",
            "eventWide",
            "event_wide",
            "eventWideRequirements",
            "event_wide_requirements",
            "allVendors",
            "all_vendors",
            "allVendorRequirements",
            "all_vendor_requirements",
            "appliesToAllVendors",
            "applies_to_all_vendors",
            "appliesToAll",
            "applies_to_all",
        ):
            _merge_req_bucket(global_bucket, root.get(key))

        # Root-level compliance/documents are event-wide requirements.
        _merge_req_bucket(global_bucket, root)

        category_source = root.get("categories") or root.get("categoryRequirements") or root.get("category_requirements") or {}
        if isinstance(category_source, dict):
            for category_name, raw_bucket in category_source.items():
                name = str(category_name or "").strip()
                if not name:
                    continue
                target = categories.setdefault(name, {"compliance": [], "documents": []})
                _merge_req_bucket(target, raw_bucket)

    global_bucket = _ensure_event_wide_baseline(global_bucket)

    return {
        "requirements": {
            "global": global_bucket,
            "categories": categories,
        },
        "version": 1,
    }


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


def _iter_diagram_booths(diagram_payload: Any) -> list[Dict[str, Any]]:
    """Return booth objects from either current multi-level diagrams or older flat diagrams."""
    if not isinstance(diagram_payload, dict):
        return []

    booths: list[Dict[str, Any]] = []

    raw_levels = diagram_payload.get("levels")
    if isinstance(raw_levels, list):
        for level in raw_levels:
            if not isinstance(level, dict):
                continue
            for booth in level.get("booths") or []:
                if isinstance(booth, dict):
                    booths.append(booth)

    for booth in diagram_payload.get("booths") or []:
        if isinstance(booth, dict):
            booths.append(booth)

    # Some very old map saves stored booths inside elements. Keep this as a safe fallback.
    for element in diagram_payload.get("elements") or []:
        if not isinstance(element, dict):
            continue
        if str(element.get("type") or "").strip().lower() == "booth":
            booths.append(element)

    return booths


def _booth_price_value(booth: Dict[str, Any]) -> float:
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    candidates = [
        booth.get("price"),
        booth.get("booth_price"),
        booth.get("boothPrice"),
        booth.get("amount"),
        booth.get("cost"),
        meta.get("price"),
        meta.get("booth_price"),
        meta.get("amount"),
        meta.get("cost"),
    ]
    for value in candidates:
        n = _safe_float(value)
        if n > 0:
            return n
    return 0.0


def _booth_is_sellable(booth: Dict[str, Any]) -> bool:
    sale_mode = str(booth.get("saleMode") or booth.get("sale_mode") or "").strip().lower()
    status = str(booth.get("status") or "").strip().lower()
    if sale_mode in {"hidden", "internal"}:
        return False
    if status in {"blocked", "hidden", "inactive", "unavailable"}:
        return False
    return True


def _event_marketplace_stats(event: dict, applications: dict, db: Optional[Session] = None) -> dict:
    event_id = int(event.get("id") or 0)

    diagram_payload: Dict[str, Any] = {}
    if db is not None and event_id:
        try:
            slot = (
                db.query(Diagram)
                .filter(Diagram.event_id == event_id)
                .order_by(Diagram.id.desc())
                .first()
            )
            if slot and isinstance(slot.diagram, dict):
                diagram_payload = slot.diagram
        except Exception:
            logger.exception("Unable to load diagram marketplace stats for event %s", event_id)

    booths = [booth for booth in _iter_diagram_booths(diagram_payload) if _booth_is_sellable(booth)]
    total_booths = len(booths)
    paid_prices = [_booth_price_value(booth) for booth in booths if _booth_price_value(booth) > 0]
    booths_from_price = min(paid_prices) if paid_prices else None

    paid_booth_ids: set[str] = set()
    reserved_booth_ids: set[str] = set()

    for app in applications.values():
        if not isinstance(app, dict):
            continue
        if int(app.get("event_id") or app.get("eventId") or 0) != event_id:
            continue

        booth_id = str(app.get("booth_id") or app.get("requested_booth_id") or "").strip()
        payment_status = _coerce_payment_status(app.get("payment_status") or app.get("paymentStatus"))

        if payment_status == "paid":
            if booth_id:
                paid_booth_ids.add(booth_id)
            continue

        if booth_id and payment_status in {"pending", "unpaid"}:
            reserved_until = app.get("booth_reserved_until")
            try:
                if reserved_until and datetime.fromisoformat(str(reserved_until).replace("Z", "+00:00")) > datetime.now(timezone.utc):
                    reserved_booth_ids.add(booth_id)
            except Exception:
                pass

    paid_booths = len(paid_booth_ids)
    held_booths = len(reserved_booth_ids - paid_booth_ids)
    spots_left = max(total_booths - paid_booths - held_booths, 0)

    return {
        "booths_from_price": booths_from_price,
        "starting_booth_price": booths_from_price,
        "booth_price": booths_from_price,
        "total_booths": total_booths,
        "booths_total": total_booths,
        "paid_booths": paid_booths,
        "held_booths": held_booths,
        "spots_left": spots_left,
        "booths_remaining": spots_left,
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
async def get_events(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    all_rows = (
        db.query(Event)
        .filter(Event.published == True)  # noqa: E712
        .filter(Event.archived == False)  # noqa: E712
        .order_by(Event.id.desc())
        .all()
    )

    active_rows = [row for row in all_rows if _event_is_active_marketplace_event(_serialize_event_model(row))]
    total = len(active_rows)
    safe_limit = _page_limit(limit)
    safe_offset = _page_offset(offset)
    rows = active_rows[safe_offset:safe_offset + safe_limit]

    result = []
    for row in rows:
        event_dict = _serialize_event_model(row)
        event_dict.update(_event_marketplace_stats(event_dict, _APPLICATIONS, db))
        result.append(event_dict)

    return {
        "events": result,
        "items": result,
        "count": len(result),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + safe_limit < total,
    }


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

    # Preserve organizer-selected vendor/service needs even before the SQL Event
    # model has dedicated columns for them. These fields power the public event
    # detail page section: "What the organizer needs".
    selected_needs = _unique_categories([
        payload.get("desired_vendor_categories"),
        payload.get("desiredVendorCategories"),
        payload.get("vendor_categories_needed"),
        payload.get("looking_for_categories"),
        payload.get("vendor_categories"),
    ])
    if selected_needs:
        serialized["desired_vendor_categories"] = selected_needs
        serialized["desiredVendorCategories"] = selected_needs
        serialized["vendor_categories_needed"] = selected_needs
        serialized["looking_for_categories"] = selected_needs
        serialized["vendor_categories"] = selected_needs

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


@router.post("/organizer/events/{event_id}/cancel")
def organizer_cancel_event(
    event_id: int,
    payload: Dict[str, Any] = Body(default={}),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    now_iso = utc_now_iso()
    reason = str((payload or {}).get("reason") or (payload or {}).get("cancellation_reason") or "").strip()
    message = str((payload or {}).get("message") or (payload or {}).get("cancellation_message") or "").strip()

    # Canceled events leave public/vendor discovery immediately but remain
    # available to the organizer as operational records.
    ev.published = False
    ev.archived = True
    db.add(ev)
    db.commit()
    db.refresh(ev)

    serialized = _serialize_event_model(ev)
    serialized.update({
        "status": "canceled",
        "lifecycle_status": "canceled",
        "accepting_vendors": False,
        "acceptingVendors": False,
        "canceled": True,
        "canceled_at": now_iso,
        "cancellation_reason": reason,
        "cancellation_message": message,
        "canceled_by": str(user.get("email") or ""),
    })
    _sync_event_to_store(serialized, user)

    # Mark existing application records without destroying payment/history data.
    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue
        try:
            app_event_id = int(app.get("event_id") or app.get("eventId") or 0)
        except Exception:
            app_event_id = 0
        if app_event_id != int(event_id):
            continue
        app["event_canceled"] = True
        app["event_canceled_at"] = now_iso
        app["event_cancellation_reason"] = reason
        if str(app.get("status") or "").strip().lower() not in {"paid", "confirmed"}:
            app["status"] = "event_canceled"

    save_store()
    return serialized


@router.post("/organizer/events/{event_id}/archive")
def organizer_archive_event(
    event_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    ev.archived = True
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    _sync_event_to_store(serialized, user)
    return serialized


@router.post("/organizer/events/{event_id}/restore")
def organizer_restore_event(
    event_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ev = _get_owned_event_or_404(db, event_id, user)
    ev.archived = False
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    serialized.update({
        "status": "draft" if not bool(ev.published) else "published",
        "lifecycle_status": "draft" if not bool(ev.published) else "published",
        "canceled": False,
        "cancelled": False,
        "canceled_at": None,
        "cancelled_at": None,
        "cancellation_reason": "",
        "cancellation_message": "",
    })
    _sync_event_to_store(serialized, user)
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



def _normalize_saved_requirements_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize organizer requirements into the canonical store shape.

    The frontend saves { requirements: { global, categories }, version }. Older
    screens may send global/categoryRequirements at the root. Keep all-vendor
    requirements in requirements.global so vendor pages never see an empty
    event-wide bucket after save.
    """
    raw = payload if isinstance(payload, dict) else {}
    root = raw.get("requirements") if isinstance(raw.get("requirements"), dict) else raw
    if not isinstance(root, dict):
        root = {}

    global_bucket = _req_bucket(
        root.get("global")
        or root.get("globalRequirements")
        or root.get("global_requirements")
        or root.get("eventWide")
        or root.get("event_wide")
        or root.get("eventWideRequirements")
        or root.get("event_wide_requirements")
        or root.get("allVendors")
        or root.get("all_vendors")
        or root.get("allVendorRequirements")
        or root.get("all_vendor_requirements")
        or root.get("appliesToAllVendors")
        or root.get("applies_to_all_vendors")
        or {}
    )

    # Root-level compliance/documents also mean event-wide requirements.
    _merge_req_bucket(global_bucket, root)

    category_source = root.get("categories") or root.get("categoryRequirements") or root.get("category_requirements") or {}
    categories: Dict[str, Dict[str, list[Dict[str, Any]]]] = {}
    if isinstance(category_source, dict):
        for name, bucket in category_source.items():
            clean_name = str(name or "").strip()
            if not clean_name:
                continue
            categories[clean_name] = _req_bucket(bucket)

    version = raw.get("version") or root.get("version") or 1
    try:
        version = int(version or 1)
    except Exception:
        version = 1

    global_bucket = _ensure_event_wide_baseline(global_bucket)

    return {
        "requirements": {
            "global": global_bucket,
            "categories": categories,
        },
        "version": version,
        "updated_at": utc_now_iso(),
    }


def _save_requirements_for_event(event_id: int, payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
    ev = _get_event_row_or_404(db, int(event_id))
    normalized = _normalize_saved_requirements_payload(payload)

    # File/runtime store remains the requirements store for now, but this route
    # is the single writer. Applications and public/vendor pages read the same
    # normalized shape after this save.
    # Store under both int and string keys because legacy routes have used both
    # forms over time. This prevents public/vendor reads from seeing an empty
    # requirement set immediately after an organizer save.
    _REQUIREMENTS[int(event_id)] = normalized
    _REQUIREMENTS[str(int(event_id))] = normalized

    store_event = _EVENTS.get(int(event_id), {}) if isinstance(_EVENTS.get(int(event_id)), dict) else {}
    store_event = {
        **store_event,
        "id": int(event_id),
        "requirements": normalized,
        "global": normalized.get("requirements", {}).get("global", {}),
        "categories": normalized.get("requirements", {}).get("categories", {}),
        "requirements_published": True,
    }
    _EVENTS[int(event_id)] = store_event
    _EVENTS[str(int(event_id))] = store_event

    ev.requirements_published = True
    db.add(ev)
    db.commit()
    save_store()

    return _requirements_payload_for_event(int(event_id), db=db)


@router.put("/organizer/events/{event_id}/requirements")
def put_organizer_event_requirements(
    event_id: int,
    payload: Dict[str, Any] = Body(default_factory=dict),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return _save_requirements_for_event(int(event_id), payload, db)


@router.post("/organizer/events/{event_id}/requirements")
def post_organizer_event_requirements(
    event_id: int,
    payload: Dict[str, Any] = Body(default_factory=dict),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return _save_requirements_for_event(int(event_id), payload, db)


@router.put("/events/{event_id}/requirements")
def put_public_event_requirements(
    event_id: int,
    payload: Dict[str, Any] = Body(default_factory=dict),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    return _save_requirements_for_event(int(event_id), payload, db)


@router.get("/events/{event_id}/requirements")
def get_public_event_requirements(event_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    return _requirements_payload_for_event(int(event_id), db=db)


@router.get("/organizer/events/{event_id}/requirements")
def get_organizer_event_requirements(event_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    return _requirements_payload_for_event(int(event_id), db=db)


@router.get("/public/events")
def public_list_events(
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows_all = (
        db.query(Event)
        .filter(Event.published == True)  # noqa: E712
        .filter(Event.archived == False)  # noqa: E712
        .order_by(Event.id.desc())
        .all()
    )
    active_rows = [row for row in rows_all if _event_is_active_marketplace_event(_serialize_event_model(row))]
    total = len(active_rows)
    safe_limit = _page_limit(limit)
    safe_offset = _page_offset(offset)
    rows = active_rows[safe_offset:safe_offset + safe_limit]

    out = []
    for event in rows:
        event_dict = _serialize_event_model(event)
        event_dict.update(_event_marketplace_stats(event_dict, _APPLICATIONS, db))
        out.append(event_dict)

    return {
        "events": out,
        "items": out,
        "count": len(out),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + safe_limit < total,
    }


def _public_booth_label(booth: Dict[str, Any], fallback: str) -> str:
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    value = (
        booth.get("label")
        or booth.get("booth_label")
        or booth.get("boothLabel")
        or booth.get("number")
        or booth.get("name")
        or booth.get("code")
        or meta.get("label")
        or meta.get("booth_label")
        or meta.get("number")
        or fallback
    )
    return str(value or fallback).strip()


def _public_booth_id(booth: Dict[str, Any], fallback: str) -> str:
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    value = (
        booth.get("id")
        or booth.get("booth_id")
        or booth.get("boothId")
        or booth.get("key")
        or booth.get("code")
        or meta.get("id")
        or meta.get("booth_id")
        or fallback
    )
    return str(value or fallback).strip()


def _public_booth_category(booth: Dict[str, Any]) -> str:
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    return str(
        booth.get("category")
        or booth.get("booth_category")
        or booth.get("boothCategory")
        or booth.get("vendor_category")
        or booth.get("vendorCategory")
        or booth.get("category_name")
        or booth.get("categoryName")
        or meta.get("category")
        or meta.get("booth_category")
        or meta.get("vendor_category")
        or ""
    ).strip()


def _public_booth_number(value: Any, fallback: float) -> float:
    try:
        if value is None or value == "":
            return fallback
        return float(value)
    except Exception:
        return fallback


def _public_booth_match_tokens(booth: Dict[str, Any], booth_id: str, label: str) -> set[str]:
    tokens = {str(booth_id or "").strip().lower(), str(label or "").strip().lower()}
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    for key in (
        "id",
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
        "selected_booth_id",
        "selectedBoothId",
        "assigned_booth_id",
        "assignedBoothId",
        "label",
        "booth_label",
        "boothLabel",
        "number",
        "name",
        "code",
    ):
        raw = booth.get(key)
        if raw not in (None, ""):
            tokens.add(str(raw).strip().lower())
        raw_meta = meta.get(key)
        if raw_meta not in (None, ""):
            tokens.add(str(raw_meta).strip().lower())
    return {token for token in tokens if token}


def _public_application_booth_tokens(app: Dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for key in (
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
        "selected_booth_id",
        "selectedBoothId",
        "assigned_booth_id",
        "assignedBoothId",
        "booth_label",
        "boothLabel",
        "booth_number",
        "boothNumber",
        "booth_name",
        "boothName",
    ):
        raw = app.get(key)
        if raw not in (None, ""):
            tokens.add(str(raw).strip().lower())
    booth = app.get("booth")
    if isinstance(booth, dict):
        for key in ("id", "label", "number", "name", "code"):
            raw = booth.get(key)
            if raw not in (None, ""):
                tokens.add(str(raw).strip().lower())
    return {token for token in tokens if token}


def _public_application_status(app: Dict[str, Any]) -> str:
    payment_status = _coerce_payment_status(app.get("payment_status") or app.get("paymentStatus"))
    status = str(app.get("status") or app.get("application_status") or "").strip().lower()
    if payment_status == "paid":
        return "paid"
    if status in {"approved", "accepted", "confirmed"}:
        return "assigned"
    if status in {"submitted", "under_review", "pending"}:
        return "reserved"
    if payment_status in {"pending", "processing"}:
        return "reserved"
    return status or "assigned"


def _public_profile_for_vendor(db: Session, email: str) -> Optional[Profile]:
    normalized = _norm_email(email)
    if not normalized:
        return None
    try:
        return (
            db.query(Profile)
            .filter(Profile.role == "vendor")
            .filter(func.lower(Profile.email) == normalized)
            .first()
        )
    except Exception:
        return None


def _public_vendor_payload_from_app(db: Session, app: Dict[str, Any]) -> Dict[str, Any]:
    email = _norm_email(app.get("vendor_email") or app.get("email") or app.get("user_email"))
    profile = _public_profile_for_vendor(db, email)
    profile_data = dict(profile.data or {}) if profile and isinstance(profile.data, dict) else {}
    business_name = str(
        app.get("business_name")
        or app.get("vendor_name")
        or app.get("vendor_business_name")
        or profile_data.get("business_name")
        or profile_data.get("businessName")
        or profile_data.get("company_name")
        or (getattr(profile, "business_name", None) if profile else "")
        or email
        or ""
    ).strip()
    logo_url = str(
        app.get("vendor_logo_url")
        or app.get("logo_url")
        or profile_data.get("logo_url")
        or profile_data.get("logoUrl")
        or profile_data.get("logo")
        or ""
    ).strip()
    category = str(
        app.get("vendor_category")
        or app.get("requested_booth_category")
        or app.get("booth_category")
        or profile_data.get("category")
        or profile_data.get("business_category")
        or ""
    ).strip()
    verified = bool(
        app.get("verified")
        or app.get("vendor_verified")
        or profile_data.get("verified")
        or profile_data.get("is_verified")
        or str(profile_data.get("verification_status") or "").lower() == "verified"
    )
    return {
        "vendor_name": business_name,
        "vendor_email": email,
        "vendor_logo_url": logo_url,
        "category": category,
        "verified": verified,
    }


def _public_applications_for_event(event_id: int) -> list[Dict[str, Any]]:
    out: list[Dict[str, Any]] = []
    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue
        try:
            app_event_id = int(app.get("event_id") or app.get("eventId") or 0)
        except Exception:
            continue
        if app_event_id == int(event_id):
            out.append(app)
    return out


@router.get("/public/events/{event_id}/diagram")
def public_event_diagram(event_id: int, db: Session = Depends(get_db)):
    """Return a no-login, read-only floorplan payload for public visitors.

    This intentionally exposes only map geometry and assigned/reserved vendor
    display data. It does not expose vendor application controls or private
    application documents.
    """
    event = (
        db.query(Event)
        .filter(Event.id == int(event_id))
        .filter(Event.published == True)  # noqa: E712
        .filter(Event.archived == False)  # noqa: E712
        .first()
    )

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event_dict = _serialize_event_model(event)
    if not _event_is_active_marketplace_event(event_dict):
        raise HTTPException(status_code=404, detail="Event not found")

    diagram_row = (
        db.query(Diagram)
        .filter(Diagram.event_id == int(event_id))
        .order_by(Diagram.id.desc())
        .first()
    )

    diagram_payload = diagram_row.diagram if diagram_row and isinstance(diagram_row.diagram, dict) else {}
    raw_booths = _iter_diagram_booths(diagram_payload)
    event_apps = _public_applications_for_event(int(event_id))

    public_booths: list[Dict[str, Any]] = []
    for index, booth in enumerate(raw_booths, start=1):
        if not isinstance(booth, dict) or not _booth_is_sellable(booth):
            continue

        booth_id = _public_booth_id(booth, f"booth-{index}")
        label = _public_booth_label(booth, f"B{index}")
        booth_tokens = _public_booth_match_tokens(booth, booth_id, label)

        matched_app: Optional[Dict[str, Any]] = None
        for app in event_apps:
            app_tokens = _public_application_booth_tokens(app)
            if booth_tokens.intersection(app_tokens):
                status = str(app.get("status") or "").strip().lower()
                payment_status = _coerce_payment_status(app.get("payment_status") or app.get("paymentStatus"))
                if status in {"approved", "accepted", "confirmed", "submitted", "under_review", "pending"} or payment_status in {"paid", "pending"}:
                    matched_app = app
                    break

        vendor_payload: Dict[str, Any] = {}
        if matched_app:
            vendor_payload = _public_vendor_payload_from_app(db, matched_app)

        meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
        base_status = str(booth.get("status") or meta.get("status") or "available").strip().lower()
        status = _public_application_status(matched_app) if matched_app else base_status
        category = vendor_payload.get("category") or _public_booth_category(booth)

        public_booths.append(
            {
                "id": booth_id,
                "booth_id": booth_id,
                "label": label,
                "booth_label": label,
                "name": label,
                "type": "booth",
                "x": _public_booth_number(booth.get("x") or booth.get("left") or meta.get("x"), 40 + ((index - 1) % 5) * 150),
                "y": _public_booth_number(booth.get("y") or booth.get("top") or meta.get("y"), 40 + ((index - 1) // 5) * 120),
                "width": _public_booth_number(booth.get("width") or booth.get("w") or meta.get("width"), 110),
                "height": _public_booth_number(booth.get("height") or booth.get("h") or meta.get("height"), 72),
                "rotation": _public_booth_number(booth.get("rotation") or meta.get("rotation"), 0),
                "status": status,
                "category": category,
                "vendor_category": category,
                "price": _booth_price_value(booth) or None,
                "vendor_name": vendor_payload.get("vendor_name") or "",
                "vendor_email": vendor_payload.get("vendor_email") or "",
                "vendor_logo_url": vendor_payload.get("vendor_logo_url") or "",
                "verified": bool(vendor_payload.get("verified")),
            }
        )

    public_diagram = dict(diagram_payload or {})
    public_diagram["booths"] = public_booths

    return {
        "ok": True,
        "event_id": int(event_id),
        "diagram": public_diagram,
        "booths": public_booths,
        "count": len(public_booths),
    }


@router.get("/public/events/{event_id}")
def public_get_event(event_id: int, db: Session = Depends(get_db)):
    ev = _get_event_row_or_404(db, event_id)
    event_dict = _serialize_event_model(ev)
    if not _event_is_active_marketplace_event(event_dict):
        raise HTTPException(status_code=404, detail="Event not found")
    event_dict.update(_event_marketplace_stats(event_dict, _APPLICATIONS, db))
    return event_dict


@router.get("/events/{event_id}/vendors/{vendor_id}/qr")
def get_vendor_event_qr_pass(
    event_id: int,
    vendor_id: str,
    db: Session = Depends(get_db),
):
    """Return the event-specific vendor QR/check-in pass.

    This route is used by VendorEventPassPage. It must match the same application
    records the vendor dashboard and organizer roster display. During rollout,
    event applications can be identified by a large application id, vendor email,
    vendor id, user id, or profile id, so this lookup intentionally supports all
    of those keys.
    """
    event = _get_event_row_or_404(db, int(event_id))
    expire_reservations_if_needed()

    requested_vendor = str(vendor_id or "").strip().lower()
    if not requested_vendor:
        raise HTTPException(status_code=400, detail="Vendor id is required")

    approved_app = None

    for raw_app in _APPLICATIONS.values():
        if not isinstance(raw_app, dict):
            continue

        app_event_id = _safe_int(
            raw_app.get("event_id")
            or raw_app.get("eventId")
            or raw_app.get("event")
            or raw_app.get("eventID")
        )
        if app_event_id != int(event_id):
            continue

        app_vendor_values = [
            raw_app.get("id"),
            raw_app.get("application_id"),
            raw_app.get("applicationId"),
            raw_app.get("app_id"),
            raw_app.get("appId"),
            raw_app.get("app_ref"),
            raw_app.get("appRef"),
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
        app_vendor_keys = {
            str(value).strip().lower()
            for value in app_vendor_values
            if str(value or "").strip()
        }

        if requested_vendor not in app_vendor_keys:
            continue

        status = str(
            raw_app.get("status")
            or raw_app.get("application_status")
            or raw_app.get("applicationStatus")
            or ""
        ).strip().lower()
        review_status = str(raw_app.get("review_status") or raw_app.get("reviewStatus") or "").strip().lower()
        payment_status = _coerce_payment_status(raw_app.get("payment_status") or raw_app.get("paymentStatus"))

        has_booth = bool(
            raw_app.get("booth_id")
            or raw_app.get("boothId")
            or raw_app.get("requested_booth_id")
            or raw_app.get("requestedBoothId")
            or raw_app.get("selected_booth_id")
            or raw_app.get("selectedBoothId")
            or raw_app.get("assigned_booth_id")
            or raw_app.get("assignedBoothId")
            or raw_app.get("booth_number")
            or raw_app.get("boothNumber")
            or raw_app.get("booth_label")
            or raw_app.get("boothLabel")
        )

        approved_state = (
            payment_status == "paid"
            or status in {"approved", "accepted", "confirmed", "complete", "completed", "paid", "checked_in", "participated"}
            or review_status in {"approved", "accepted", "confirmed", "complete", "completed"}
        )

        # Do not fail paid/approved legacy records just because a booth field is
        # named differently. The pass can still show "Booth assigned" or the raw
        # assignment value returned below.
        if approved_state or has_booth:
            approved_app = dict(raw_app)
            break

    if approved_app is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "Vendor not approved for event. "
                "No matching event/application record was found for this QR pass."
            ),
        )

    app_id = (
        approved_app.get("id")
        or approved_app.get("application_id")
        or approved_app.get("applicationId")
        or approved_app.get("app_id")
        or approved_app.get("appId")
        or requested_vendor
    )
    app_vendor_id = (
        approved_app.get("vendor_id")
        or approved_app.get("vendorId")
        or approved_app.get("user_id")
        or approved_app.get("userId")
        or approved_app.get("vendor_email")
        or approved_app.get("vendorEmail")
        or approved_app.get("email")
        or requested_vendor
    )
    vendor_email = (
        approved_app.get("vendor_email")
        or approved_app.get("vendorEmail")
        or approved_app.get("email")
        or ""
    )

    token = _build_vendor_event_pass_token(int(event_id), app_vendor_id, app_id)
    qr_value = (
        f"vendcore://check-in?event_id={int(event_id)}"
        f"&vendor_id={app_vendor_id}"
        f"&application_id={app_id}"
        f"&token={token}"
    )

    booth_id = (
        approved_app.get("booth_id")
        or approved_app.get("boothId")
        or approved_app.get("requested_booth_id")
        or approved_app.get("requestedBoothId")
        or approved_app.get("selected_booth_id")
        or approved_app.get("selectedBoothId")
        or approved_app.get("assigned_booth_id")
        or approved_app.get("assignedBoothId")
    )
    booth_label = (
        approved_app.get("booth_label")
        or approved_app.get("boothLabel")
        or approved_app.get("booth_number")
        or approved_app.get("boothNumber")
        or booth_id
    )

    return {
        "ok": True,
        "token": token,
        "qr_code": qr_value,
        "qrCode": qr_value,
        "pass_url": qr_value,
        "passUrl": qr_value,
        "event_id": int(event_id),
        "eventId": int(event_id),
        "event_title": getattr(event, "title", None) or approved_app.get("event_title") or approved_app.get("eventTitle") or f"Event #{event_id}",
        "eventTitle": getattr(event, "title", None) or approved_app.get("event_title") or approved_app.get("eventTitle") or f"Event #{event_id}",
        "vendor_id": app_vendor_id,
        "vendorId": app_vendor_id,
        "vendor_email": vendor_email,
        "vendorEmail": vendor_email,
        "vendor_name": approved_app.get("vendor_name") or approved_app.get("vendorName") or approved_app.get("business_name") or approved_app.get("businessName") or vendor_email or "Vendor",
        "vendorName": approved_app.get("vendor_name") or approved_app.get("vendorName") or approved_app.get("business_name") or approved_app.get("businessName") or vendor_email or "Vendor",
        "business_name": approved_app.get("business_name") or approved_app.get("businessName") or approved_app.get("vendor_name") or approved_app.get("vendorName") or vendor_email or "Vendor",
        "businessName": approved_app.get("business_name") or approved_app.get("businessName") or approved_app.get("vendor_name") or approved_app.get("vendorName") or vendor_email or "Vendor",
        "application_id": app_id,
        "applicationId": app_id,
        "booth_id": booth_id,
        "boothId": booth_id,
        "booth_label": booth_label,
        "boothLabel": booth_label,
        "booth_category": approved_app.get("booth_category") or approved_app.get("boothCategory") or approved_app.get("requested_booth_category") or approved_app.get("requestedBoothCategory") or approved_app.get("category") or "General",
        "boothCategory": approved_app.get("booth_category") or approved_app.get("boothCategory") or approved_app.get("requested_booth_category") or approved_app.get("requestedBoothCategory") or approved_app.get("category") or "General",
        "payment_status": _coerce_payment_status(approved_app.get("payment_status") or approved_app.get("paymentStatus")) or "paid",
        "paymentStatus": _coerce_payment_status(approved_app.get("payment_status") or approved_app.get("paymentStatus")) or "paid",
        "status": approved_app.get("status") or approved_app.get("application_status") or approved_app.get("applicationStatus") or "approved",
        "checked_in": bool(approved_app.get("checked_in") or approved_app.get("checkedIn")),
        "checkedIn": bool(approved_app.get("checked_in") or approved_app.get("checkedIn")),
        "checked_in_at": approved_app.get("checked_in_at") or approved_app.get("checkedInAt"),
        "checkedInAt": approved_app.get("checked_in_at") or approved_app.get("checkedInAt"),
        "payload": {
            "event_id": int(event_id),
            "vendor_id": app_vendor_id,
            "vendor_email": vendor_email,
            "application_id": app_id,
        },
    }


@router.post("/check-in")
async def check_in_vendor(
    request: Request,
    db: Session = Depends(get_db),
):
    """Public QR check-in endpoint for scanned vendor passes.

    Accepts direct JSON fields:
    {event_id, vendor_id, application_id, token}

    Also accepts a scanned QR/pass value:
    {qr_code: "vendcore://check-in?event_id=...&vendor_id=...&application_id=...&token=..."}

    For easier field testing, query-string values are merged in too, so this also works:
    POST /check-in?event_id=...&vendor_id=...&application_id=...&token=...
    """
    try:
        data = await request.json()
    except Exception:
        data = {}

    if not isinstance(data, dict):
        data = {}

    # Merge query params without overwriting JSON body values. This makes scanner
    # integrations and manual field testing less brittle.
    for key, value in request.query_params.items():
        data.setdefault(key, value)

    normalized = _extract_checkin_payload(data)
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

    if already_checked_in:
        # Duplicate scans should be safe and clear for the organizer. Do not
        # overwrite the original check-in timestamp.
        checked_in_at = app.get("checked_in_at") or now
        app["check_in_status"] = "checked_in"
        save_store()
        return {
            "ok": True,
            "message": "Vendor already checked in",
            "already_checked_in": True,
            "alreadyCheckedIn": True,
            "checked_in": True,
            "checkedIn": True,
            "checked_in_at": checked_in_at,
            "checkedInAt": checked_in_at,
            "application": _serialize_checkin_application(app, event_id, stored_key),
        }

    app["checked_in"] = True
    app["checked_in_at"] = now
    app["check_in_status"] = "checked_in"
    app["updated_at"] = now

    checked_in_by = _norm_email(
        data.get("checked_in_by")
        or data.get("checkedInBy")
        or data.get("scanner_email")
        or data.get("scannerEmail")
    )
    if checked_in_by:
        app["checked_in_by"] = checked_in_by

    save_store()

    return {
        "ok": True,
        "message": "Vendor checked in successfully",
        "already_checked_in": False,
        "alreadyCheckedIn": False,
        "checked_in": True,
        "checkedIn": True,
        "checked_in_at": now,
        "checkedInAt": now,
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

    marketplace_stats = _event_marketplace_stats(_serialize_event_model(event), _APPLICATIONS, db)
    booths_total = int(marketplace_stats.get("booths_total") or marketplace_stats.get("total_booths") or 0)
    booths_remaining = int(marketplace_stats.get("booths_remaining") or marketplace_stats.get("spots_left") or max(0, booths_total - sold))
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
