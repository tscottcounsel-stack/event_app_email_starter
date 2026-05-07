from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event_checkin import EventCheckIn
from app.models.application import Application
from app.utils.qr_tokens import generate_qr_token, verify_qr_token

router = APIRouter(tags=["checkins"])

APPROVED_APPLICATION_STATUSES = ("approved", "paid", "checked_in")
PAID_PAYMENT_STATUSES = ("paid", "succeeded", "completed", "complete")


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _to_int(value: Any) -> Optional[int]:
    text = _safe_str(value)
    if not text:
        return None
    try:
        return int(text)
    except Exception:
        return None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _model_value(obj: Any, *names: str) -> Any:
    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value not in (None, ""):
                return value
    return None


def _application_id(app: Application) -> int:
    return int(_model_value(app, "id") or 0)


def _application_vendor_id(app: Application) -> int:
    raw = _model_value(app, "user_id", "vendor_id", "userId", "vendorId")
    return int(raw or 0)


def _application_email(app: Application) -> str:
    return _safe_lower(_model_value(app, "vendor_email", "email", "vendorEmail", "user_email") or "")


def _application_name(app: Application) -> str:
    return _safe_str(
        _model_value(
            app,
            "business_name",
            "businessName",
            "company_name",
            "companyName",
            "vendor_name",
            "vendorName",
        )
        or _application_email(app)
        or f"Vendor #{_application_vendor_id(app) or _application_id(app)}"
    )


def _application_booth(app: Application) -> str:
    return _safe_str(
        _model_value(
            app,
            "booth_id",
            "boothId",
            "requested_booth_id",
            "requestedBoothId",
            "booth_number",
            "boothNumber",
        )
        or ""
    )


def _application_category(app: Application) -> str:
    return _safe_str(
        _model_value(
            app,
            "booth_category",
            "boothCategory",
            "vendor_category",
            "vendorCategory",
            "category",
        )
        or "General"
    )


def _application_status(app: Application) -> str:
    return _safe_lower(_model_value(app, "status") or "")


def _payment_status(app: Application) -> str:
    return _safe_lower(_model_value(app, "payment_status", "paymentStatus") or "")


def _is_approved_or_ready(app: Application) -> bool:
    status = _application_status(app)
    payment = _payment_status(app)
    return status in APPROVED_APPLICATION_STATUSES or payment in PAID_PAYMENT_STATUSES


def _ready_for_checkin(app: Application) -> bool:
    return bool(_application_booth(app)) and _payment_status(app) in PAID_PAYMENT_STATUSES


def _row_payload(app: Application, checkin: Optional[EventCheckIn] = None) -> Dict[str, Any]:
    checked = bool(checkin and checkin.status == "checked_in")
    checked_at = checkin.checked_in_at.isoformat() if checkin and checkin.checked_in_at else None
    vendor_id = _application_vendor_id(app)
    app_id = _application_id(app)

    return {
        "application_id": app_id,
        "applicationId": app_id,
        "id": app_id,
        "vendor_id": vendor_id,
        "vendorId": vendor_id,
        "vendor_email": _application_email(app),
        "vendorEmail": _application_email(app),
        "vendor_name": _application_name(app),
        "vendorName": _application_name(app),
        "business_name": _application_name(app),
        "businessName": _application_name(app),
        "booth_id": _application_booth(app),
        "boothId": _application_booth(app),
        "booth_category": _application_category(app),
        "boothCategory": _application_category(app),
        "category": _application_category(app),
        "status": _application_status(app) or "approved",
        "payment_status": _payment_status(app),
        "paymentStatus": _payment_status(app),
        "checked_in": checked,
        "checkedIn": checked,
        "checked_in_at": checked_at,
        "checkedInAt": checked_at,
        "ready_for_checkin": _ready_for_checkin(app),
        "readyForCheckIn": _ready_for_checkin(app),
        "roster_note": "Checked in — booth locked." if checked else "Ready for event check-in." if _ready_for_checkin(app) else "Approved, but not fully ready yet.",
        "source": "event_checkins" if checked else "applications",
    }


def _parse_payload(data: Dict[str, Any], fallback_event_id: Optional[int] = None) -> Dict[str, Any]:
    raw_token = _safe_str(data.get("token") or data.get("qr_code") or data.get("qrCode") or "")
    event_id = data.get("event_id") or data.get("eventId") or fallback_event_id
    vendor_id = data.get("vendor_id") or data.get("vendorId")
    application_id = data.get("application_id") or data.get("applicationId") or data.get("app_id") or data.get("appId")

    if raw_token:
        # Signed token path.
        try:
            signed = verify_qr_token(raw_token)
            return {
                "event_id": signed.get("event_id") or event_id,
                "vendor_id": signed.get("vendor_id") or vendor_id,
                "application_id": signed.get("application_id") or application_id,
                "token": raw_token,
            }
        except Exception:
            pass

        # URL / vendcore:// path.
        if raw_token.startswith(("vendcore://", "http://", "https://")):
            try:
                parsed = urlparse(raw_token.replace("vendcore://", "https://vendcore.local/"))
                params = parse_qs(parsed.query)

                def pick(*keys: str) -> str:
                    for key in keys:
                        value = params.get(key)
                        if value and value[0]:
                            return value[0]
                    return ""

                event_id = pick("event_id", "eventId") or event_id
                vendor_id = pick("vendor_id", "vendorId", "vendor_email", "vendorEmail") or vendor_id
                application_id = pick("application_id", "applicationId", "app_id", "appId") or application_id
                raw_token = pick("token") or raw_token
            except Exception:
                pass

    return {
        "event_id": event_id,
        "vendor_id": vendor_id,
        "application_id": application_id,
        "token": raw_token,
    }


def _find_application(db: Session, event_id: int, application_id: Any = None, vendor_id: Any = None) -> Application:
    app_id_int = _to_int(application_id)
    vendor_id_text = _safe_str(vendor_id)
    vendor_id_int = _to_int(vendor_id)

    query = db.query(Application).filter(Application.event_id == int(event_id))

    if app_id_int is not None:
        app = query.filter(Application.id == app_id_int).first()
        if app and _is_approved_or_ready(app):
            return app

    if vendor_id_int is not None:
        filters = []
        if hasattr(Application, "user_id"):
            filters.append(Application.user_id == vendor_id_int)
        if hasattr(Application, "vendor_id"):
            filters.append(Application.vendor_id == vendor_id_int)
        if filters:
            app = query.filter(or_(*filters)).order_by(Application.id.desc()).first()
            if app and _is_approved_or_ready(app):
                return app

    if vendor_id_text and "@" in vendor_id_text:
        filters = []
        if hasattr(Application, "vendor_email"):
            filters.append(func.lower(Application.vendor_email) == vendor_id_text.lower())
        if hasattr(Application, "email"):
            filters.append(func.lower(Application.email) == vendor_id_text.lower())
        if filters:
            app = query.filter(or_(*filters)).order_by(Application.id.desc()).first()
            if app and _is_approved_or_ready(app):
                return app

    raise HTTPException(status_code=403, detail="Vendor is not approved or ready for this event")


def _upsert_checkin(db: Session, event_id: int, app: Application) -> tuple[EventCheckIn, bool]:
    vendor_id = _application_vendor_id(app)
    application_id = _application_id(app)

    existing = (
        db.query(EventCheckIn)
        .filter(
            EventCheckIn.event_id == int(event_id),
            EventCheckIn.application_id == int(application_id),
        )
        .first()
    )

    if not existing and vendor_id:
        existing = (
            db.query(EventCheckIn)
            .filter(
                EventCheckIn.event_id == int(event_id),
                EventCheckIn.vendor_id == int(vendor_id),
            )
            .first()
        )

    if existing:
        if existing.status != "checked_in":
            existing.status = "checked_in"
            existing.checked_in_at = existing.checked_in_at or _now_utc()
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing, False
        return existing, True

    checkin = EventCheckIn(
        event_id=int(event_id),
        vendor_id=int(vendor_id or 0),
        application_id=int(application_id),
        status="checked_in",
        checked_in_at=_now_utc(),
    )
    db.add(checkin)
    db.commit()
    db.refresh(checkin)
    return checkin, False


# Generate QR by flexible vendor/application identifier.
# Accepts:
# - vendor/user id
# - application id
# - vendor email
# This keeps older QR pass pages working even when the frontend only has an
# application id or email available.
@router.get("/events/{event_id}/vendors/{vendor_key}/qr")
def generate_qr(event_id: int, vendor_key: str, db: Session = Depends(get_db)):
    app = _find_application(
        db,
        int(event_id),
        application_id=vendor_key,
        vendor_id=vendor_key,
    )

    vendor_id = _application_vendor_id(app)
    application_id = _application_id(app)
    token = generate_qr_token(int(event_id), vendor_id, application_id)

    return {
        "ok": True,
        "token": token,
        "qr_code": token,
        "qrCode": token,
        "event_id": int(event_id),
        "eventId": int(event_id),
        "vendor_id": vendor_id,
        "vendorId": vendor_id,
        "vendor_email": _application_email(app),
        "vendor_name": _application_name(app),
        "business_name": _application_name(app),
        "application_id": application_id,
        "applicationId": application_id,
        "booth_id": _application_booth(app),
        "booth_category": _application_category(app),
        "payment_status": _payment_status(app),
        "status": _application_status(app) or "approved",
        "payload": {
            "event_id": int(event_id),
            "vendor_id": vendor_id,
            "vendor_email": _application_email(app),
            "application_id": application_id,
        },
    }


# Compatibility path used by older scanner pages.
@router.post("/events/{event_id}/checkins/scan")
def scan_qr(data: Dict[str, Any], event_id: int, db: Session = Depends(get_db)):
    return global_check_in({**(data or {}), "event_id": event_id}, db=db)


# Primary scanner endpoint used by OrganizerEventCheckInPage.
@router.post("/check-in")
def global_check_in(data: Dict[str, Any], db: Session = Depends(get_db)):
    payload = _parse_payload(data or {})
    event_id = _to_int(payload.get("event_id"))

    if event_id is None:
        raise HTTPException(status_code=400, detail="Missing event id")

    app = _find_application(
        db,
        event_id,
        application_id=payload.get("application_id"),
        vendor_id=payload.get("vendor_id"),
    )
    checkin, already_checked_in = _upsert_checkin(db, event_id, app)
    row = _row_payload(app, checkin)

    return {
        "ok": True,
        "status": "already_checked_in" if already_checked_in else "checked_in",
        "message": "Already checked in" if already_checked_in else "Checked in",
        "already_checked_in": already_checked_in,
        "alreadyCheckedIn": already_checked_in,
        "checked_in": True,
        "checkedIn": True,
        "vendor_id": row["vendor_id"],
        "vendorId": row["vendor_id"],
        "application_id": row["application_id"],
        "applicationId": row["application_id"],
        "checked_in_at": row["checked_in_at"],
        "checkedInAt": row["checked_in_at"],
        "application": row,
        "vendor": row,
    }


# Durable stats + roster endpoint used by the check-in dashboard.
@router.get("/events/{event_id}/checkins")
def checkin_stats(event_id: int, db: Session = Depends(get_db)):
    return _checkin_stats_payload(event_id, db)


# Compatibility with current frontend hyphenated URL: /events/:id/check-ins
@router.get("/events/{event_id}/check-ins")
def checkin_stats_hyphen(event_id: int, db: Session = Depends(get_db)):
    return _checkin_stats_payload(event_id, db)


def _checkin_stats_payload(event_id: int, db: Session) -> Dict[str, Any]:
    applications = (
        db.query(Application)
        .filter(Application.event_id == int(event_id))
        .order_by(Application.id.desc())
        .all()
    )
    approved_apps = [app for app in applications if _is_approved_or_ready(app)]

    checkins = db.query(EventCheckIn).filter(EventCheckIn.event_id == int(event_id)).all()
    checkins_by_app = {int(row.application_id): row for row in checkins if row.application_id is not None}
    checkins_by_vendor = {int(row.vendor_id): row for row in checkins if row.vendor_id is not None}

    rows = []
    for app in approved_apps:
        app_id = _application_id(app)
        vendor_id = _application_vendor_id(app)
        checkin = checkins_by_app.get(app_id) or checkins_by_vendor.get(vendor_id)
        rows.append(_row_payload(app, checkin))

    checked_in = len([row for row in rows if row.get("checked_in") is True])
    late = len([row for row in checkins if row.status == "late"])
    no_show = len([row for row in checkins if row.status == "no_show"])
    total = len(rows)
    waiting = max(total - checked_in - late - no_show, 0)
    ready_total = len([row for row in rows if row.get("ready_for_checkin") is not False])

    return {
        "ok": True,
        "total": total,
        "checked_in": checked_in,
        "checkedIn": checked_in,
        "not_checked_in": waiting,
        "notCheckedIn": waiting,
        "late": late,
        "no_show": no_show,
        "pending": waiting,
        "approved_total": total,
        "approvedTotal": total,
        "ready_total": ready_total,
        "readyTotal": ready_total,
        "rows": rows,
        "checkins": rows,
        "applications": rows,
        "vendors": rows,
    }
