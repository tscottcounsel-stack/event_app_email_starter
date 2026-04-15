# app/routers/events.py
from __future__ import annotations

print("🔥 EVENTS.PY LOADED — NEW VERSION")

from datetime import datetime, timezone
import os
import re
import logging
logger = logging.getLogger(__name__)
logger.warning("🔥 app.routers.events loaded")

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.core.permissions import require_event_limit
from app.routers.applications import _APPLICATIONS, expire_reservations_if_needed
from app.routers.auth import get_current_user
from app.store import (
    _DIAGRAMS,
    _EVENTS,
    _PAYMENTS,
    _REQUIREMENTS,
    get_store_snapshot,
    next_event_id,
    save_store,
)

router = APIRouter(tags=["Events"])


from pathlib import Path

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

    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

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


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: Optional[str] = None
    description: Optional[str] = None

    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

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

    published: Optional[bool] = None
    archived: Optional[bool] = None
    requirements_published: Optional[bool] = None
    layout_published: Optional[bool] = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_email(value: Any) -> str:
    return str(value or "").strip().lower()


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


def _owned_events_for_user(user: Dict[str, Any]) -> list[Dict[str, Any]]:
    return [
        e
        for e in _EVENTS.values()
        if isinstance(e, dict) and _event_belongs_to_user(e, user)
    ]


def _get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def _get_owned_event_or_404(event_id: int, user: Dict[str, Any]) -> Dict[str, Any]:
    event = _get_event_or_404(event_id)
    if not _event_belongs_to_user(event, user):
        raise HTTPException(status_code=403, detail="Not allowed to access this event.")
    return event


def _as_event_dict(e: Dict[str, Any]) -> Dict[str, Any]:
    return dict(e)


def _looks_like_diagram_doc(d: Dict[str, Any]) -> bool:
    if not isinstance(d, dict):
        return False
    return "levels" in d or "booths" in d or "floors" in d


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


def _ensure_diagram_slot(event_id: int) -> Dict[str, Any]:
    ev = _get_event_or_404(event_id)
    slot = ev.get("diagram")

    if isinstance(slot, dict) and "diagram" in slot:
        if not isinstance(slot.get("version"), int):
            slot["version"] = 1
        if slot.get("diagram") is None:
            slot["diagram"] = {}
        if isinstance(slot.get("diagram"), dict):
            for key, value in (slot.get("diagram") or {}).items():
                slot.setdefault(key, value)
        ev["diagram"] = slot
        return slot

    if isinstance(slot, dict) and _looks_like_diagram_doc(slot):
        migrated = {"diagram": slot, "version": 1}
        ev["diagram"] = migrated
        ev["updated_at"] = utc_now_iso()
        save_store()
        return migrated

    new_slot = {"diagram": {}, "version": 1, "levels": [], "elements": []}
    ev["diagram"] = new_slot
    ev["updated_at"] = utc_now_iso()
    save_store()
    return new_slot


def _next_diagram_version(current: Optional[int], incoming: Optional[int]) -> int:
    if isinstance(current, int) and current >= 1:
        return current + 1
    if isinstance(incoming, int) and incoming >= 1:
        return incoming
    return 1


def _coerce_incoming_diagram_payload(payload: Any) -> Tuple[Dict[str, Any], Optional[int]]:
    if not isinstance(payload, dict):
        return {}, None

    incoming_version = payload.get("version") if isinstance(payload.get("version"), int) else None

    if "diagram" in payload and isinstance(payload.get("diagram"), dict):
        return payload.get("diagram") or {}, incoming_version

    return payload, incoming_version


def _is_effectively_empty_diagram(doc: Dict[str, Any]) -> bool:
    if not isinstance(doc, dict):
        return True
    if doc == {}:
        return True
    if "levels" in doc and isinstance(doc.get("levels"), list) and len(doc.get("levels")) == 0:
        return True
    return False


def _apply_event_patch(ev: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in patch.items():
        if k in ("start_date", "end_date") and isinstance(v, datetime):
            ev[k] = v.isoformat()
        else:
            ev[k] = v
    ev["updated_at"] = utc_now_iso()
    save_store()
    return _as_event_dict(ev)


def _safe_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        s = str(value).strip().replace("$", "").replace(",", "")
        return float(s or 0)
    except Exception:
        return 0.0


def _resolve_booth_price(booth: dict, pricing_categories: list | None) -> float:
    # 1. Explicit booth price wins
    price = booth.get("price")
    if price not in (None, "", 0):
        return _safe_float(price)

    # 2. Category-based pricing
    category_id = booth.get("categoryId") or booth.get("category")
    if category_id and isinstance(pricing_categories, list):
        for c in pricing_categories:
            if str(c.get("id")) == str(category_id):
                return _safe_float(c.get("price"))

    # 3. Fallback
    return _safe_float(price)


def _normalize_public_requirements_payload(payload: Any) -> Dict[str, Any]:
    root = payload if isinstance(payload, dict) else {}
    nested = root.get("requirements") if isinstance(root.get("requirements"), dict) else {}

    def pick_list(*keys: str) -> List[Any]:
        for source in (root, nested):
            if not isinstance(source, dict):
                continue
            for key in keys:
                value = source.get(key)
                if isinstance(value, list):
                    return value
        return []

    def pick_dict(*keys: str) -> Dict[str, Any]:
        for source in (root, nested):
            if not isinstance(source, dict):
                continue
            for key in keys:
                value = source.get(key)
                if isinstance(value, dict):
                    return value
        return {}

    def pick_value(*keys: str) -> Any:
        for source in (root, nested):
            if not isinstance(source, dict):
                continue
            for key in keys:
                value = source.get(key)
                if value not in (None, ""):
                    return value
        return ""

    booth_categories = pick_list("booth_categories", "boothCategories", "categories")
    custom_restrictions = pick_list("custom_restrictions", "customRestrictions", "restrictions")
    compliance_items = pick_list("compliance_items", "complianceItems", "compliance", "requirements_list")
    document_requirements = pick_list(
        "document_requirements",
        "documentRequirements",
        "required_documents",
        "requiredDocuments",
        "documents",
    )
    payment_settings = pick_dict("payment_settings", "paymentSettings")
    updated_at = pick_value("updated_at", "updatedAt")

    return {
        "version": root.get("version") or nested.get("version") or 2,
        "requirements": {
            "booth_categories": booth_categories,
            "custom_restrictions": custom_restrictions,
            "compliance_items": compliance_items,
            "document_requirements": document_requirements,
            "payment_settings": payment_settings,
            "updated_at": updated_at,
        },
        "booth_categories": booth_categories,
        "custom_restrictions": custom_restrictions,
        "compliance_items": compliance_items,
        "document_requirements": document_requirements,
        "payment_settings": payment_settings,
        "updated_at": updated_at,
    }


def _public_diagram_payload_for_event(event_id: int) -> Dict[str, Any]:
    ev = _get_event_or_404(event_id)

    slot = ev.get("diagram")
    version = 1
    doc: Dict[str, Any] = {}

    if isinstance(slot, dict) and isinstance(slot.get("diagram"), dict):
        version = slot.get("version") if isinstance(slot.get("version"), int) else 1
        doc = slot.get("diagram") or {}
    elif isinstance(slot, dict) and _looks_like_diagram_doc(slot):
        doc = slot
    elif isinstance(_DIAGRAMS.get(int(event_id)), dict):
        raw = _DIAGRAMS.get(int(event_id)) or {}
        if isinstance(raw.get("diagram"), dict):
            version = raw.get("version") if isinstance(raw.get("version"), int) else 1
            doc = raw.get("diagram") or {}
        elif _looks_like_diagram_doc(raw):
            doc = raw

    booth_state_by_id = {}
    if isinstance(doc, dict):
        raw_state = doc.get("booth_state_by_id")
        if isinstance(raw_state, dict):
            booth_state_by_id = raw_state

    return {
        "diagram": doc or {},
        "version": version,
        "booth_state_by_id": booth_state_by_id,
    }

def _event_marketplace_stats(event: dict, applications: dict) -> dict:
    booths = []

    event_id = int(event.get("id") or 0)

    diagram_doc = {}

    # 1. Try event-local diagram
    diagram_slot = event.get("diagram")
    if isinstance(diagram_slot, dict):
        if isinstance(diagram_slot.get("diagram"), dict):
            diagram_doc = diagram_slot.get("diagram") or {}
        elif "levels" in diagram_slot:
            diagram_doc = diagram_slot

    # 2. FALLBACK → global diagram store
    if not diagram_doc:
        raw = _DIAGRAMS.get(event_id)
        if isinstance(raw, dict):
            if isinstance(raw.get("diagram"), dict):
                diagram_doc = raw.get("diagram") or {}
            elif "levels" in raw:
                diagram_doc = raw

    levels = diagram_doc.get("levels", [])

    for lvl in levels:
        if isinstance(lvl, dict):
            bs = lvl.get("booths", [])
            if isinstance(bs, list):
                booths.extend([b for b in bs if isinstance(b, dict)])

    prices = []
    for b in booths:
        raw_price = b.get("price")
        if raw_price not in (None, "", 0):
            try:
                price = float(str(raw_price).replace("$", "").replace(",", "").strip())
                if price > 0:
                    prices.append(price)
            except Exception:
                continue

    total_booths = len(booths)
    paid_booths = sum(
        1 for a in applications.values()
        if a.get("event_id") == event_id and a.get("status") == "paid"
    )

    booths_from_price = min(prices) if prices else None
    spots_left = max(total_booths - paid_booths, 0)

    return {
        "booths_from_price": booths_from_price,
        "total_booths": total_booths,
        "paid_booths": paid_booths,
        "spots_left": spots_left,
    }


@router.get("/events")
async def get_events():
    events_list = list(_EVENTS.values())

    result = []
    for event in events_list:
        e = dict(event)
        stats = _event_marketplace_stats(e, _APPLICATIONS)
        e.update(stats)
        result.append(e)

    return result


@router.get("/organizer/events")
def organizer_list_events(user: dict = Depends(get_current_user)):
    return {"events": [_as_event_dict(e) for e in _owned_events_for_user(user)]}


@router.post("/organizer/events")
def organizer_create_event(payload: EventCreate, user: dict = Depends(get_current_user)):
    organizer_email = _norm_email(user.get("email"))
    if not organizer_email:
        raise HTTPException(status_code=401, detail="Authenticated user email missing")

    existing_event_count = len(_owned_events_for_user(user))
    require_event_limit(user, existing_event_count)

    eid = next_event_id()
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    e = {
        "id": eid,
        "title": payload.title,
        "description": payload.description,
        "start_date": payload.start_date.isoformat() if payload.start_date else None,
        "end_date": payload.end_date.isoformat() if payload.end_date else None,
        "venue_name": payload.venue_name,
        "street_address": payload.street_address,
        "city": payload.city,
        "state": payload.state,
        "zip_code": payload.zip_code,
        "ticket_sales_url": payload.ticket_sales_url,
        "google_maps_url": payload.google_maps_url,
        "category": payload.category,
        "heroImageUrl": payload.heroImageUrl,
        "imageUrls": payload.imageUrls or [],
        "videoUrls": payload.videoUrls or [],
        "published": False,
        "archived": False,
        "requirements_published": False,
        "layout_published": False,
        "organizer_email": organizer_email,
        "owner_email": organizer_email,
        "organizer_id": organizer_id,
        "owner_id": organizer_id,
        "created_by": organizer_id,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "diagram": {"diagram": {}, "version": 1, "levels": [], "elements": []},
    }
    _EVENTS[eid] = e
    save_store()
    return _as_event_dict(e)


@router.get("/organizer/events/{event_id}")
def organizer_get_event(event_id: int, user: dict = Depends(get_current_user)):
    return _as_event_dict(_get_owned_event_or_404(event_id, user))


@router.patch("/organizer/events/{event_id}")
def organizer_patch_event(
    event_id: int,
    payload: Dict[str, Any] = Body(default={}),
    user: dict = Depends(get_current_user),
):
    ev = _get_owned_event_or_404(event_id, user)
    return _apply_event_patch(ev, dict(payload or {}))


@router.delete("/organizer/events/{event_id}")
def organizer_delete_event(event_id: int, user: dict = Depends(get_current_user)):
    _get_owned_event_or_404(event_id, user)
    eid = int(event_id)
    _EVENTS.pop(eid, None)
    _REQUIREMENTS.pop(eid, None)
    save_store()
    return {"ok": True}


@router.post("/organizer/events/{event_id}/publish")
def organizer_publish_event(event_id: int, user: dict = Depends(get_current_user)):
    ev = _get_owned_event_or_404(event_id, user)
    ev["published"] = True
    ev["archived"] = False
    ev["updated_at"] = utc_now_iso()
    save_store()
    return _as_event_dict(ev)


@router.get("/organizer/events/{event_id}/diagram")
def organizer_get_event_diagram(event_id: int, user: dict = Depends(get_current_user)):
    _get_owned_event_or_404(event_id, user)
    slot = _ensure_diagram_slot(event_id)
    doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}
    return doc or {}


@router.put("/organizer/events/{event_id}/diagram")
def organizer_put_event_diagram(
    event_id: int, payload: Dict[str, Any], user: dict = Depends(get_current_user)
):
    ev = _get_owned_event_or_404(event_id, user)
    slot = _ensure_diagram_slot(event_id)

    incoming_doc, incoming_version = _coerce_incoming_diagram_payload(payload)
    existing_doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}

    if _is_effectively_empty_diagram(incoming_doc) and not _is_effectively_empty_diagram(existing_doc):
        return existing_doc or {}

    current_version = slot.get("version") if isinstance(slot, dict) else None
    next_version = _next_diagram_version(current_version, incoming_version)

    incoming_clean = incoming_doc or {}
    mirrored_slot = {"diagram": incoming_clean, "version": next_version}
    if isinstance(incoming_clean, dict):
        for key, value in incoming_clean.items():
            mirrored_slot[key] = value

    ev["diagram"] = mirrored_slot
    ev["updated_at"] = utc_now_iso()
    save_store()

    return incoming_doc or {}


@router.get("/organizer/earnings")
def organizer_earnings(user: dict = Depends(get_current_user)):
    store = get_store_snapshot()

    events = store.get("events", {}) or {}
    payments = store.get("payments", {}) or {}

    if not isinstance(events, dict):
        events = {}
    if not isinstance(payments, dict):
        payments = {}

    owned_event_ids = {
        int(e.get("id") or 0)
        for e in _owned_events_for_user(user)
        if isinstance(e, dict)
    }

    gross_sales = 0.0
    platform_fees = 0.0
    net_earnings = 0.0
    payouts_paid = 0.0
    payouts_owed = 0.0

    event_totals: Dict[int, Dict[str, Any]] = {}

    for p in payments.values():
        if not isinstance(p, dict):
            continue

        if str(p.get("status", "")).lower() != "paid":
            continue

        event_id = int(p.get("event_id") or 0)
        event_row = events.get(str(event_id)) or events.get(event_id) or {}

        payment_email = _norm_email(
            p.get("organizer_email")
            or (event_row or {}).get("organizer_email")
            or (event_row or {}).get("owner_email")
        )
        payment_owner_id = (
            p.get("organizer_id")
            or (event_row or {}).get("organizer_id")
            or (event_row or {}).get("owner_id")
            or (event_row or {}).get("created_by")
        )

        payment_belongs = event_id in owned_event_ids or _event_belongs_to_user(
            {
                "organizer_email": payment_email,
                "organizer_id": payment_owner_id,
            },
            user,
        )

        if not payment_belongs:
            continue

        amount = float(p.get("amount") or 0)
        fee = float(p.get("platform_fee") or 0)
        payout = float(p.get("organizer_payout") or 0)
        payout_status = str(p.get("payout_status") or "unpaid").strip().lower()

        gross_sales += amount
        platform_fees += fee
        net_earnings += payout

        if payout_status == "paid":
            payouts_paid += payout
        else:
            payouts_owed += payout

        title = p.get("event_title") or (event_row or {}).get("title") or f"Event {event_id}"

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

    return {
        "summary": {
            "gross_sales": round(gross_sales, 2),
            "platform_fees": round(platform_fees, 2),
            "net_earnings": round(net_earnings, 2),
            "payouts_paid": round(payouts_paid, 2),
            "payouts_owed": round(payouts_owed, 2),
        },
        "events": event_rows,
    }
    gross_sales = 0.0
    platform_fees = 0.0
    net_earnings = 0.0
    payouts_paid = 0.0
    payouts_owed = 0.0

    event_totals: Dict[int, Dict[str, Any]] = {}

    for p in payments.values():
        if not isinstance(p, dict):
            continue

        if str(p.get("status", "")).lower() != "paid":
            continue

        event_id = int(p.get("event_id") or 0)
        event_row = events.get(str(event_id)) or events.get(event_id) or {}

        payment_email = _norm_email(
            p.get("organizer_email")
            or (event_row or {}).get("organizer_email")
            or (event_row or {}).get("owner_email")
        )
        payment_owner_id = (
            p.get("organizer_id")
            or (event_row or {}).get("organizer_id")
            or (event_row or {}).get("owner_id")
            or (event_row or {}).get("created_by")
        )

        payment_belongs = event_id in owned_event_ids or _event_belongs_to_user(
            {
                "organizer_email": payment_email,
                "organizer_id": payment_owner_id,
            },
            user,
        )

        if not payment_belongs:
            continue

        amount = float(p.get("amount") or 0)
        fee = float(p.get("platform_fee") or 0)
        payout = float(p.get("organizer_payout") or 0)
        payout_status = str(p.get("payout_status") or "unpaid").strip().lower()

        gross_sales += amount
        platform_fees += fee
        net_earnings += payout

        if payout_status == "paid":
            payouts_paid += payout
        else:
            payouts_owed += payout

        title = p.get("event_title") or (event_row or {}).get("title") or f"Event {event_id}"

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

    return {
        "summary": {
            "gross_sales": round(gross_sales, 2),
            "platform_fees": round(platform_fees, 2),
            "net_earnings": round(net_earnings, 2),
            "payouts_paid": round(payouts_paid, 2),
            "payouts_owed": round(payouts_owed, 2),
        },
        "events": event_rows,
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

    for payment_id_raw, p in payments.items():
        if not isinstance(p, dict):
            continue

        payment_status = str(p.get("status") or "").strip().lower()
        if payment_status != "paid":
            continue

        try:
            payment_id = int(payment_id_raw)
        except Exception:
            payment_id = int(p.get("id") or 0)

        amount = round(float(p.get("amount") or 0), 2)
        platform_fee = round(float(p.get("platform_fee") or 0), 2)
        organizer_payout = round(float(p.get("organizer_payout") or 0), 2)
        payout_status = str(p.get("payout_status") or "unpaid").strip().lower()
        payout_sent_at = p.get("payout_sent_at")

        event_id = int(p.get("event_id") or 0)
        event_row = events.get(str(event_id)) or events.get(event_id) or {}
        event_title = p.get("event_title") or (event_row or {}).get("title") or f"Event {event_id}"

        row = {
            "payment_id": payment_id,
            "event_id": event_id,
            "event_title": event_title,
            "application_id": p.get("application_id"),
            "vendor_email": p.get("vendor_email"),
            "vendor_name": p.get("vendor_name"),
            "organizer_id": p.get("organizer_id"),
            "organizer_email": p.get("organizer_email"),
            "amount": amount,
            "platform_fee": platform_fee,
            "organizer_payout": organizer_payout,
            "status": payment_status,
            "payout_status": payout_status,
            "payout_sent_at": payout_sent_at,
            "created_at": p.get("created_at"),
            "paid_at": p.get("paid_at") or p.get("updated_at") or p.get("created_at"),
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
    payment = _PAYMENTS.get(int(payment_id))
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
def public_list_events():
    out = []
    for event in _EVENTS.values():
        if event.get("published") and not event.get("archived"):
            e = dict(event)
            stats = _event_marketplace_stats(e, _APPLICATIONS)
            e.update(stats)
            out.append(e)
    return {"events": out}

@router.get("/public/events/{event_id}")
def public_get_event(event_id: int):
    ev = _get_event_or_404(event_id)
    if not ev.get("published") or ev.get("archived"):
        raise HTTPException(status_code=404, detail="Event not found")
    return _as_event_dict(ev)


@router.get("/events/{event_id}")
def public_get_event_alias(event_id: int):
    return public_get_event(event_id)



@router.get("/events/{event_id}/diagram")
def public_get_event_diagram(event_id: int):
    ev = _get_event_or_404(event_id)
    if not ev.get("published") or ev.get("archived"):
        raise HTTPException(status_code=404, detail="Event not found")
    return _public_diagram_payload_for_event(event_id)


@router.get("/vendor/events")
def vendor_list_events_alias():
    return public_list_events()


@router.patch("/events/{event_id}")
def public_patch_event_alias(event_id: int, payload: Dict[str, Any] = Body(default={})):
    ev = _get_event_or_404(event_id)
    return _apply_event_patch(ev, dict(payload or {}))


@router.get("/events/{event_id}/stats")
def get_event_stats(event_id: int):
    expire_reservations_if_needed()

    event = _EVENTS.get(int(event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    apps = [a for a in _APPLICATIONS.values() if int(a.get("event_id") or 0) == int(event_id)]

    slot = _ensure_diagram_slot(event_id)
    doc = slot.get("diagram", {}) if isinstance(slot, dict) else {}

    booths: list[Dict[str, Any]] = []
    if isinstance(doc, dict):
        levels = doc.get("levels")
        if isinstance(levels, list):
            for level in levels:
                if isinstance(level, dict):
                    level_booths = level.get("booths")
                    if isinstance(level_booths, list):
                        booths.extend([b for b in level_booths if isinstance(b, dict)])

        root_booths = doc.get("booths")
        if isinstance(root_booths, list):
            booths.extend([b for b in root_booths if isinstance(b, dict)])

    sold = sum(1 for a in apps if _coerce_payment_status(a.get("payment_status")) == "paid")

    pending = sum(
        1
        for a in apps
        if str(a.get("status") or "").strip().lower() in ("submitted", "under_review")
    )

    approved = sum(1 for a in apps if str(a.get("status") or "").strip().lower() == "approved")

    revenue = sum(
        _safe_float(a.get("booth_price"))
        for a in apps
        if _coerce_payment_status(a.get("payment_status")) == "paid"
    )

    booths_total = len(booths)
    booths_remaining = max(0, booths_total - sold)
    approval_rate = (approved / len(apps)) if apps else 0

    return {
        "event_id": int(event_id),
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
    # Clear all in-memory stores
    _EVENTS.clear()
    _REQUIREMENTS.clear()
    _DIAGRAMS.clear()
    _APPLICATIONS.clear()
    _PAYMENTS.clear()

    # 👇 ADD THIS (this is what removes practice accounts)
    try:
        from app.routers.users import _USERS
        _USERS.clear()
    except Exception:
        pass

    save_store()

    return {
        "ok": True,
        "message": "Full system reset complete (events, users, applications, payments, diagrams cleared)",
    }
