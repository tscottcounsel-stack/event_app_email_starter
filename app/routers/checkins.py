from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, text, cast, String
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event_checkin import EventCheckIn
from app.models.application import Application
try:
    from app.models.event import Event
except Exception:  # pragma: no cover
    Event = None  # type: ignore
from app.utils.qr_tokens import generate_qr_token, verify_qr_token

try:
    from app import store as legacy_store  # type: ignore
except Exception:  # pragma: no cover
    legacy_store = None  # type: ignore

router = APIRouter(tags=["checkins"])

APPROVED_APPLICATION_STATUSES = ("approved", "paid", "confirmed", "checked_in", "participated")
PAID_PAYMENT_STATUSES = ("paid", "succeeded", "completed", "complete", "confirmed", "settled")


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
    if isinstance(obj, dict):
        for name in names:
            value = obj.get(name)
            if value not in (None, ""):
                return value
        return None

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
    parsed = _to_int(raw)
    # Some imported/test applications do not have a numeric user/vendor id.
    # Use the application id as a stable non-zero fallback so EventCheckIn rows
    # can still be persisted and matched by application_id.
    return int(parsed or _application_id(app) or 0)


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
            "assigned_booth_id",
            "assignedBoothId",
            "selected_booth_id",
            "selectedBoothId",
            "booth_number",
            "boothNumber",
            "booth_label",
            "boothLabel",
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


def _has_assigned_booth(app: Application) -> bool:
    return bool(_application_booth(app))


def _has_paid_or_completed_payment(app: Application) -> bool:
    return _payment_status(app) in PAID_PAYMENT_STATUSES


def _has_approved_operational_status(app: Application) -> bool:
    return _application_status(app) in APPROVED_APPLICATION_STATUSES


def _is_approved_or_ready(app: Application) -> bool:
    """Single eligibility source for QR pass, roster, and check-in lookup."""
    return _has_approved_operational_status(app) or _has_paid_or_completed_payment(app)


def _ready_for_checkin(app: Application) -> bool:
    """Single readiness source for QR/pass/check-in flows."""
    return _has_assigned_booth(app) and _is_approved_or_ready(app)


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


def _legacy_app_event_id(app: Any) -> str:
    return _safe_str(
        _model_value(app, "event_id", "eventId", "event", "eventID")
        or ""
    )


def _legacy_app_match_values(app: Any) -> set[str]:
    values: set[str] = set()
    for value in (
        _model_value(app, "id", "application_id", "applicationId", "app_id", "appId", "app_ref", "appRef"),
        _model_value(app, "vendor_id", "vendorId", "user_id", "userId"),
        _model_value(app, "vendor_email", "vendorEmail", "email", "user_email"),
    ):
        text_value = _safe_str(value)
        if text_value:
            values.add(text_value.lower())
    return values


def _iter_legacy_applications() -> list[Any]:
    if legacy_store is None:
        return []

    raw = getattr(legacy_store, "_APPLICATIONS", {})
    if isinstance(raw, dict):
        out = []
        for key, value in raw.items():
            if isinstance(value, dict):
                merged = {"id": value.get("id") or key, **value}
                out.append(merged)
        return out

    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]

    return []


def _find_legacy_application(event_id: int, application_id: Any = None, vendor_id: Any = None) -> Any:
    event_id_text = _safe_str(event_id)
    wanted_values = {
        _safe_str(application_id).lower(),
        _safe_str(vendor_id).lower(),
    }
    wanted_values = {value for value in wanted_values if value}

    candidates = []
    for app in _iter_legacy_applications():
        if _legacy_app_event_id(app) != event_id_text:
            continue
        candidates.append(app)

    # Strong match first: app id, vendor id, or email.
    for app in candidates:
        if wanted_values & _legacy_app_match_values(app):
            return app

    # If this vendor only has one eligible app for this event, use it.
    eligible = [app for app in candidates if _is_approved_or_ready(app)]
    if len(eligible) == 1:
        return eligible[0]

    if len(candidates) == 1:
        return candidates[0]

    return None


def _debug_application_lookup_payload(
    *,
    event_id: int,
    application_id: Any = None,
    vendor_id: Any = None,
    db_count: int = 0,
    legacy_count: int = 0,
) -> Dict[str, Any]:
    return {
        "event_id": int(event_id),
        "application_id": _safe_str(application_id),
        "vendor_id": _safe_str(vendor_id),
        "db_candidates_for_event": int(db_count),
        "legacy_candidates_for_event": int(legacy_count),
    }


def _find_application(db: Session, event_id: int, application_id: Any = None, vendor_id: Any = None) -> Any:
    app_id_int = _to_int(application_id)
    app_id_text = _safe_str(application_id)
    vendor_id_text = _safe_str(vendor_id)
    vendor_id_int = _to_int(vendor_id)
    event_id_text = _safe_str(event_id)

    query = db.query(Application).filter(Application.event_id == int(event_id))

    # First try direct SQL lookups for normal records.
    if app_id_text:
        app_filters = []

        if hasattr(Application, "id"):
            app_filters.append(cast(Application.id, String) == app_id_text)
            if app_id_int is not None:
                app_filters.append(Application.id == app_id_int)

        for attr_name in ("application_id", "applicationId", "app_id", "appId", "app_ref", "appRef"):
            if hasattr(Application, attr_name):
                column = getattr(Application, attr_name)
                app_filters.append(cast(column, String) == app_id_text)

        if app_filters:
            app = (
                db.query(Application)
                .filter(cast(Application.event_id, String) == event_id_text)
                .filter(or_(*app_filters))
                .order_by(Application.id.desc())
                .first()
            )
            if app:
                return app

    # IMPORTANT FALLBACK:
    # The live roster already proves these applications exist for this event.
    # Match against the loaded event roster using the same helper functions that
    # build the check-in rows. This avoids mismatches caused by legacy/imported
    # timestamp-style ids, aliased columns, or email fields that do not behave
    # cleanly in direct SQL filters.
    event_apps = query.order_by(Application.id.desc()).all()

    for app in event_apps:
        app_id_value = _safe_str(_application_id(app))
        app_email_value = _safe_lower(_application_email(app))
        app_vendor_id_value = _safe_str(_application_vendor_id(app))

        if app_id_text and app_id_text == app_id_value:
            return app

        if app_id_text and "@" in app_id_text and app_email_value == _safe_lower(app_id_text):
            return app

        if vendor_id_text and "@" in vendor_id_text and app_email_value == _safe_lower(vendor_id_text):
            return app

        if vendor_id_int is not None and _safe_str(vendor_id_int) == app_vendor_id_value:
            return app

        if app_id_int is not None and _safe_str(app_id_int) == app_vendor_id_value:
            return app

    # Broader vendor/user id SQL lookup.
    if vendor_id_int is not None:
        filters = []
        if hasattr(Application, "user_id"):
            filters.append(Application.user_id == vendor_id_int)
        if hasattr(Application, "vendor_id"):
            filters.append(Application.vendor_id == vendor_id_int)
        if filters:
            app = query.filter(or_(*filters)).order_by(Application.id.desc()).first()
            if app:
                return app

    # Broader email SQL lookup.
    email_key = _safe_lower(vendor_id_text if "@" in vendor_id_text else app_id_text if "@" in app_id_text else "")
    if email_key:
        filters = []
        if hasattr(Application, "vendor_email"):
            filters.append(func.lower(Application.vendor_email) == email_key)
        if hasattr(Application, "email"):
            filters.append(func.lower(Application.email) == email_key)
        if filters:
            app = query.filter(or_(*filters)).order_by(Application.id.desc()).first()
            if app:
                return app

    legacy_app = _find_legacy_application(event_id, application_id=application_id, vendor_id=vendor_id)
    if legacy_app is not None:
        return legacy_app

    legacy_count = len([
        app for app in _iter_legacy_applications()
        if _legacy_app_event_id(app) == event_id_text
    ])
    db_count = len(event_apps)

    raise HTTPException(
        status_code=403,
        detail={
            "message": (
                "Vendor is not approved or ready for this event. "
                "No matching event/application record was found for this QR pass."
            ),
            "lookup": _debug_application_lookup_payload(
                event_id=event_id,
                application_id=application_id,
                vendor_id=vendor_id,
                db_count=db_count,
                legacy_count=legacy_count,
            ),
        },
    )


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
    qr_value = (
        f"vendcore://check-in?event_id={int(event_id)}"
        f"&vendor_id={vendor_id}"
        f"&application_id={application_id}"
        f"&token={token}"
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

    # Hard verification: never return success unless the row is actually in Postgres.
    persisted = (
        db.query(EventCheckIn)
        .filter(
            EventCheckIn.event_id == int(event_id),
            EventCheckIn.application_id == int(_application_id(app)),
            EventCheckIn.status == "checked_in",
        )
        .first()
    )

    if persisted is None:
        raise HTTPException(status_code=500, detail="Check-in could not be persisted. Please try again.")

    row = _row_payload(app, persisted)

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
    event_id_int = int(event_id)
    event_id_text = _safe_str(event_id_int)

    # Load normal Postgres applications first.
    db_applications = (
        db.query(Application)
        .filter(Application.event_id == event_id_int)
        .order_by(Application.id.desc())
        .all()
    )

    # Some current/live application records still come from the legacy application
    # store and use timestamp-style ids. The QR pass and vendor applications page
    # can see those records, so the check-in roster must read them too.
    legacy_applications = [
        app for app in _iter_legacy_applications()
        if _legacy_app_event_id(app) == event_id_text
    ]

    applications: list[Any] = []
    seen_keys: set[str] = set()

    for app in list(db_applications) + list(legacy_applications):
        key = (
            _safe_str(_model_value(app, "id", "application_id", "applicationId", "app_id", "appId"))
            or _application_email(app)
            or _safe_str(_application_vendor_id(app))
        ).lower()
        if key and key in seen_keys:
            continue
        if key:
            seen_keys.add(key)
        applications.append(app)

    approved_apps = [app for app in applications if _is_approved_or_ready(app)]

    checkins = db.query(EventCheckIn).filter(EventCheckIn.event_id == event_id_int).all()
    checkins_by_app = {
        int(row.application_id): row
        for row in checkins
        if row.application_id is not None
    }

    rows = []
    matched_checkin_ids: set[int] = set()

    for app in approved_apps:
        app_id = _application_id(app)
        vendor_id = _application_vendor_id(app)

        # STRICT MATCH:
        # Only treat this application as checked in if its exact
        # application_id exists in event_checkins. Do not fall back to
        # vendor_id here because multiple applications can share the same
        # vendor/user id, which makes the whole roster appear checked in.
        checkin = checkins_by_app.get(app_id)
        if checkin is not None and getattr(checkin, "id", None) is not None:
            matched_checkin_ids.add(int(checkin.id))
        rows.append(_row_payload(app, checkin))

    # If a persisted check-in exists but its application record cannot be loaded,
    # still surface it so the dashboard count does not drop back to zero.
    for checkin in checkins:
        if getattr(checkin, "id", None) is not None and int(checkin.id) in matched_checkin_ids:
            continue

        fallback = {
            "id": int(checkin.application_id or 0),
            "application_id": int(checkin.application_id or 0),
            "event_id": event_id_int,
            "vendor_id": int(checkin.vendor_id or 0),
            "status": "approved",
            "payment_status": "paid",
            "vendor_email": "",
            "vendor_name": f"Vendor #{int(checkin.vendor_id or 0)}",
            "business_name": f"Vendor #{int(checkin.vendor_id or 0)}",
            "booth_id": "",
            "booth_category": "General",
            "category": "General",
        }
        rows.append(_row_payload(fallback, checkin))

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


# ---------------------------------------------------------------------------
# Organizer-confirmed participation / trust history
# ---------------------------------------------------------------------------

TRUST_HISTORY_STATUSES = {"confirmed", "flagged"}


def _ensure_trust_history_schema(db: Session) -> None:
    """Runtime schema guard until formal migrations are added.

    This creates a durable trust history table used for organizer-confirmed
    participation records. It is intentionally small and additive.
    """
    try:
        bind = db.get_bind()
        if bind.dialect.name != "postgresql":
            return

        db.execute(text("""
            CREATE TABLE IF NOT EXISTS vendor_trust_history (
                id SERIAL PRIMARY KEY,
                vendor_email VARCHAR NOT NULL,
                vendor_id VARCHAR,
                organizer_email VARCHAR,
                organizer_name VARCHAR,
                event_id INTEGER,
                event_name VARCHAR,
                application_id INTEGER,
                trust_status VARCHAR NOT NULL DEFAULT 'confirmed',
                public_label VARCHAR,
                notes TEXT,
                confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
            )
        """))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_vendor_trust_history_vendor_email ON vendor_trust_history (lower(vendor_email))"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_vendor_trust_history_event_id ON vendor_trust_history (event_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_vendor_trust_history_application_id ON vendor_trust_history (application_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_vendor_trust_history_status ON vendor_trust_history (trust_status)"))
        db.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_trust_history_event_app_status
            ON vendor_trust_history (event_id, application_id, trust_status)
        """))
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Trust history schema guard skipped: {exc}")


def _event_for_id(db: Session, event_id: int) -> Any:
    if Event is None:
        return None
    try:
        return db.query(Event).filter(Event.id == int(event_id)).first()
    except Exception:
        return None


def _event_title_from_model(event: Any, event_id: int) -> str:
    if event is None:
        return f"Event #{event_id}"
    return _safe_str(
        _model_value(event, "title", "name", "event_title", "eventTitle")
        or f"Event #{event_id}"
    )


def _event_organizer_email_from_model(event: Any) -> str:
    if event is None:
        return ""
    return _safe_lower(
        _model_value(event, "organizer_email", "owner_email", "email")
        or ""
    )


def _event_organizer_name_from_model(event: Any) -> str:
    if event is None:
        return ""
    return _safe_str(
        _model_value(event, "organizer_name", "company_name", "host_name", "venue_name")
        or _event_organizer_email_from_model(event)
        or "Organizer"
    )


def _trust_history_row_to_payload(row: Any) -> Dict[str, Any]:
    # SQLAlchemy RowMapping / dict-like compatible
    get = row._mapping.get if hasattr(row, "_mapping") else row.get
    confirmed_at = get("confirmed_at")
    created_at = get("created_at")

    def iso(value: Any) -> str:
        try:
            return value.isoformat() if value else ""
        except Exception:
            return _safe_str(value)

    return {
        "id": get("id"),
        "vendor_email": _safe_lower(get("vendor_email")),
        "vendor_id": _safe_str(get("vendor_id")),
        "organizer_email": _safe_lower(get("organizer_email")),
        "organizer_name": _safe_str(get("organizer_name")),
        "event_id": get("event_id"),
        "event_name": _safe_str(get("event_name")),
        "application_id": get("application_id"),
        "trust_status": _safe_lower(get("trust_status") or "confirmed"),
        "public_label": _safe_str(get("public_label") or "Verified participation"),
        "notes": _safe_str(get("notes")),
        "confirmed_at": iso(confirmed_at),
        "created_at": iso(created_at),
    }


@router.post("/events/{event_id}/applications/{application_id}/confirm-participation")
def confirm_vendor_participation(
    event_id: int,
    application_id: int,
    data: Dict[str, Any] | None = None,
    db: Session = Depends(get_db),
):
    """Organizer confirms a vendor successfully participated.

    This creates a public trust-history record only after a real operational
    relationship exists: an application on the event, preferably with a
    persisted check-in row.
    """
    _ensure_trust_history_schema(db)
    data = data or {}

    app = (
        db.query(Application)
        .filter(Application.event_id == int(event_id), Application.id == int(application_id))
        .first()
    )
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found for this event")

    status = _safe_lower(data.get("trust_status") or data.get("status") or "confirmed")
    if status not in TRUST_HISTORY_STATUSES:
        raise HTTPException(status_code=400, detail="trust_status must be confirmed or flagged")

    checkin = (
        db.query(EventCheckIn)
        .filter(
            EventCheckIn.event_id == int(event_id),
            EventCheckIn.application_id == int(application_id),
            EventCheckIn.status == "checked_in",
        )
        .first()
    )

    # Confirming without check-in is allowed as a manual organizer override,
    # but the public label makes the difference clear.
    public_label = (
        "Organizer-confirmed participation"
        if checkin
        else "Organizer-confirmed participation"
    )

    event = _event_for_id(db, int(event_id))
    vendor_email = _application_email(app)
    if not vendor_email:
        raise HTTPException(status_code=400, detail="Vendor email is missing on this application")

    vendor_id = _safe_str(_application_vendor_id(app))
    event_name = _event_title_from_model(event, int(event_id))
    organizer_email = _safe_lower(data.get("organizer_email") or _event_organizer_email_from_model(event))
    organizer_name = _safe_str(data.get("organizer_name") or _event_organizer_name_from_model(event) or "Organizer")
    notes = _safe_str(data.get("notes"))

    existing = db.execute(
        text("""
            SELECT id FROM vendor_trust_history
            WHERE event_id = :event_id
              AND application_id = :application_id
              AND trust_status = :trust_status
            LIMIT 1
        """),
        {
            "event_id": int(event_id),
            "application_id": int(application_id),
            "trust_status": status,
        },
    ).first()

    if existing:
        db.execute(
            text("""
                UPDATE vendor_trust_history
                SET vendor_email = :vendor_email,
                    vendor_id = :vendor_id,
                    organizer_email = :organizer_email,
                    organizer_name = :organizer_name,
                    event_name = :event_name,
                    public_label = :public_label,
                    notes = :notes,
                    confirmed_at = now(),
                    updated_at = now()
                WHERE id = :id
            """),
            {
                "id": existing[0],
                "vendor_email": vendor_email,
                "vendor_id": vendor_id,
                "organizer_email": organizer_email,
                "organizer_name": organizer_name,
                "event_name": event_name,
                "public_label": public_label,
                "notes": notes,
            },
        )
    else:
        db.execute(
            text("""
                INSERT INTO vendor_trust_history (
                    vendor_email,
                    vendor_id,
                    organizer_email,
                    organizer_name,
                    event_id,
                    event_name,
                    application_id,
                    trust_status,
                    public_label,
                    notes,
                    confirmed_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    :vendor_email,
                    :vendor_id,
                    :organizer_email,
                    :organizer_name,
                    :event_id,
                    :event_name,
                    :application_id,
                    :trust_status,
                    :public_label,
                    :notes,
                    now(),
                    now(),
                    now()
                )
            """),
            {
                "vendor_email": vendor_email,
                "vendor_id": vendor_id,
                "organizer_email": organizer_email,
                "organizer_name": organizer_name,
                "event_id": int(event_id),
                "event_name": event_name,
                "application_id": int(application_id),
                "trust_status": status,
                "public_label": public_label,
                "notes": notes,
            },
        )

    db.commit()

    history = get_vendor_trust_history(email=vendor_email, role="vendor", db=db)
    return {
        "ok": True,
        "message": "Participation confirmed and added to trust history.",
        "vendor_email": vendor_email,
        "event_id": int(event_id),
        "application_id": int(application_id),
        "trust_history": history.get("trust_history", []),
        "summary": history.get("summary", {}),
    }


@router.get("/trust-history")
def get_vendor_trust_history(
    email: str,
    role: str = "vendor",
    limit: int = 12,
    db: Session = Depends(get_db),
):
    """Public trust history used by VendCore Verify credential pages."""
    _ensure_trust_history_schema(db)

    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)
    if normalized_role != "vendor":
        return {
            "ok": True,
            "role": normalized_role,
            "email": normalized_email,
            "trust_history": [],
            "summary": {
                "confirmed_count": 0,
                "flagged_count": 0,
                "organizer_count": 0,
                "event_count": 0,
            },
        }

    safe_limit = max(1, min(int(limit or 12), 50))
    rows = db.execute(
        text("""
            SELECT *
            FROM vendor_trust_history
            WHERE lower(vendor_email) = :email
            ORDER BY confirmed_at DESC, id DESC
            LIMIT :limit
        """),
        {"email": normalized_email, "limit": safe_limit},
    ).fetchall()

    payload = [_trust_history_row_to_payload(row) for row in rows]
    confirmed = [row for row in payload if row.get("trust_status") == "confirmed"]
    flagged = [row for row in payload if row.get("trust_status") == "flagged"]
    organizers = {row.get("organizer_name") or row.get("organizer_email") for row in confirmed if row.get("organizer_name") or row.get("organizer_email")}
    events = {row.get("event_id") or row.get("event_name") for row in confirmed if row.get("event_id") or row.get("event_name")}

    return {
        "ok": True,
        "role": normalized_role,
        "email": normalized_email,
        "trust_history": payload,
        "summary": {
            "confirmed_count": len(confirmed),
            "flagged_count": len(flagged),
            "organizer_count": len(organizers),
            "event_count": len(events),
        },
    }
