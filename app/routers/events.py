from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.permissions import require_event_limit
from app.db import get_db
from app.models.event import Event
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
    _apply_event_patch_model(ev, dict(payload or {}))
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    _sync_event_to_store(serialized, user)
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
    ev.published = True
    ev.archived = False
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
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


@router.get("/events/{event_id}")
def public_get_event_alias(event_id: int, db: Session = Depends(get_db)):
    return public_get_event(event_id, db)


@router.get("/vendor/events")
def vendor_list_events_alias(db: Session = Depends(get_db)):
    return public_list_events(db)


@router.patch("/events/{event_id}")
def public_patch_event_alias(
    event_id: int,
    payload: Dict[str, Any] = Body(default={}),
    db: Session = Depends(get_db),
):
    ev = _get_event_row_or_404(db, event_id)
    _apply_event_patch_model(ev, dict(payload or {}))
    db.add(ev)
    db.commit()
    db.refresh(ev)
    serialized = _serialize_event_model(ev)
    _sync_event_to_store(serialized)
    return serialized


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
