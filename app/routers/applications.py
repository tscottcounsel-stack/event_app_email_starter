from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.routers.auth import get_current_user
from app.store import (
    _APPLICATIONS,
    _AUDIT_LOGS,
    _EVENTS,
    _PAYMENTS,
    _PAYOUTS,
    get_or_create_application,
    save_store,
)

PLATFORM_FEE_PERCENT = 10
FEE_VERSION = "v1"

router = APIRouter(tags=["Applications"])


RUNTIME_DIR = Path("/tmp/vendorconnect")
DATA_DIR = RUNTIME_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

REVIEWS_FILE = DATA_DIR / "reviews.json"


def _load_reviews() -> Dict[str, Dict[str, Any]]:
    if not REVIEWS_FILE.exists():
        return {}
    try:
        raw = json.loads(REVIEWS_FILE.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


_REVIEWS: Dict[str, Dict[str, Any]] = _load_reviews()


def _save_reviews() -> None:
    REVIEWS_FILE.write_text(json.dumps(_REVIEWS, indent=2), encoding="utf-8")


def _next_review_id() -> int:
    max_id = 0
    for key, value in _REVIEWS.items():
        try:
            max_id = max(max_id, int(key))
        except Exception:
            pass
        if isinstance(value, dict):
            try:
                max_id = max(max_id, int(value.get("id") or 0))
            except Exception:
                pass
    return max_id + 1


def _reviewer_display_name(user: Dict[str, Any]) -> str:
    full_name = str(user.get("full_name") or "").strip()
    if full_name:
        return full_name
    email = _norm_email(user.get("email"))
    if email and "@" in email:
        return email.split("@", 1)[0]
    return "Anonymous"


def _find_public_organizer_reviews(organizer_email: str) -> List[Dict[str, Any]]:
    organizer_email = _norm_email(organizer_email)
    out: List[Dict[str, Any]] = []
    for review in _REVIEWS.values():
        if not isinstance(review, dict):
            continue
        if _norm_email(review.get("organizer_email")) == organizer_email:
            out.append(dict(review))
    out.sort(
        key=lambda r: (
            str(r.get("created_at") or ""),
            int(r.get("id") or 0),
        ),
        reverse=True,
    )
    return out


def _review_summary(reviews: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not reviews:
        return {"rating": 0.0, "review_count": 0}
    total = 0.0
    count = 0
    for review in reviews:
        try:
            total += float(review.get("rating") or 0)
            count += 1
        except Exception:
            continue
    avg = round(total / count, 1) if count else 0.0
    return {"rating": avg, "review_count": count}


def _can_vendor_review_organizer(
    *,
    organizer_email: str,
    reviewer_email: str,
    event_id: Optional[int] = None,
) -> tuple[bool, Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    organizer_email = _norm_email(organizer_email)
    reviewer_email = _norm_email(reviewer_email)

    matched_app: Optional[Dict[str, Any]] = None
    matched_event: Optional[Dict[str, Any]] = None

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue
        if _norm_email(app.get("vendor_email")) != reviewer_email:
            continue

        app_event_id = int(app.get("event_id") or 0)
        if event_id is not None and app_event_id != int(event_id):
            continue

        event = _EVENTS.get(app_event_id)
        if not isinstance(event, dict):
            continue

        event_organizer_email = _norm_email(
            event.get("organizer_email") or event.get("owner_email")
        )
        if event_organizer_email != organizer_email:
            continue

        status = str(app.get("status") or "").strip().lower()
        payment_status = str(app.get("payment_status") or "").strip().lower()

        if status in {"approved", "completed"} or payment_status == "paid":
            matched_app = app
            matched_event = event
            break

    return (matched_app is not None, matched_app, matched_event)


def _stable_user_id_from_email(email: str) -> int:
    import hashlib

    e = (email or "").strip().lower()
    if not e:
        return 0
    h = hashlib.sha1(e.encode("utf-8")).hexdigest()
    return int(h[:12], 16)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_iso_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    try:
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _norm_email(x: Any) -> str:
    return str(x or "").strip().lower()


def _is_dev_mode() -> bool:
    candidates = [
        os.getenv("APP_ENV"),
        os.getenv("ENV"),
        os.getenv("FASTAPI_ENV"),
        os.getenv("PYTHON_ENV"),
    ]
    normalized = {
        str(v or "").strip().lower() for v in candidates if str(v or "").strip()
    }
    return any(v in {"dev", "development", "local"} for v in normalized)


def _next_audit_id() -> int:
    ids: List[int] = []
    for k in _AUDIT_LOGS.keys():
        try:
            ids.append(int(k))
        except Exception:
            continue
    return (max(ids) + 1) if ids else 1


def _safe_actor(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    user = user or {}
    return {
        "email": _norm_email(user.get("email")) or None,
        "role": str(user.get("role") or "").strip().lower() or None,
        "id": user.get("id")
        or user.get("sub")
        or user.get("vendor_id")
        or user.get("organizer_id")
        or None,
    }


def _audit(
    *,
    action: str,
    entity_type: str,
    entity_id: Any,
    user: Optional[Dict[str, Any]] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    entry = {
        "id": _next_audit_id(),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "actor": _safe_actor(user),
        "details": details or {},
        "created_at": utc_now_iso(),
    }
    _AUDIT_LOGS[entry["id"]] = entry
    return entry


def get_event_or_404(event_id: int) -> Dict[str, Any]:
    ev = _EVENTS.get(int(event_id))
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev


def get_application_or_404(app_id: int) -> Dict[str, Any]:
    app = _APPLICATIONS.get(int(app_id))
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


def _set_status(app: Dict[str, Any], status: str):
    app["status"] = status
    if status == "submitted" and not app.get("submitted_at"):
        app["submitted_at"] = utc_now_iso()
    app["updated_at"] = utc_now_iso()


def _coerce_payment_status(x: Any) -> str:
    s = str(x or "").strip().lower()
    if s in ("unpaid", "pending", "paid", "expired"):
        return s
    return "unpaid"


def _to_float(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except Exception:
        return 0.0


def _bool_count(values: List[Any]) -> Tuple[int, int]:
    total = len(values)
    done = sum(1 for v in values if bool(v))
    return done, total


def _application_score(app: Dict[str, Any]) -> Dict[str, Any]:
    status = str(app.get("status") or "").strip().lower()
    payment = _coerce_payment_status(app.get("payment_status"))
    booth_selected = bool(app.get("booth_id") or app.get("requested_booth_id"))

    compliance = app.get("checked") or app.get("compliance") or {}
    compliance_values = (
        [bool(x) for x in compliance.values()] if isinstance(compliance, dict) else []
    )
    docs = app.get("documents") or app.get("docs") or {}
    doc_values = [bool(v) for v in docs.values()] if isinstance(docs, dict) else []

    compliance_done, compliance_total = _bool_count(compliance_values)
    docs_done, docs_total = _bool_count(doc_values)

    score = 0
    reasons: List[str] = []

    if status == "approved":
        score += 35
        reasons.append("Organizer approved")
    elif status == "submitted":
        score += 22
        reasons.append("Application submitted")
    elif status in ("under_review", "in_review"):
        score += 18
        reasons.append("Under review")
    elif status == "draft":
        score += 5

    if booth_selected:
        score += 10
        reasons.append("Booth selected")

    if payment == "paid":
        score += 30
        reasons.append("Payment complete")
    elif payment == "pending":
        score += 12
    elif payment == "expired":
        score -= 5

    if compliance_total:
        score += round((compliance_done / compliance_total) * 15)
    if docs_total:
        score += round((docs_done / docs_total) * 10)

    score = max(0, min(100, score))
    tier = "Needs Review"
    if score >= 80:
        tier = "Top Vendor"
    elif score >= 60:
        tier = "Strong Fit"
    elif score >= 40:
        tier = "Promising"

    return {
        "score": score,
        "score_tier": tier,
        "score_reasons": reasons[:4],
        "compliance_complete": compliance_total > 0
        and compliance_done == compliance_total,
        "documents_complete": docs_total > 0 and docs_done == docs_total,
    }


def _reservation_is_expired(app: Dict[str, Any]) -> bool:
    until = parse_iso_dt(app.get("booth_reserved_until"))
    return bool(until and until <= utc_now())


def expire_reservations_if_needed() -> int:
    changed = 0
    now = utc_now()
    for a in _APPLICATIONS.values():
        if _coerce_payment_status(a.get("payment_status")) == "paid":
            continue
        until = parse_iso_dt(a.get("booth_reserved_until"))
        if until and until <= now:
            a["payment_status"] = "expired"
            a["booth_id"] = None
            a["booth_reserved_until"] = None
            a["updated_at"] = utc_now_iso()
            changed += 1
    if changed:
        save_store()
    return changed


def _booth_conflict(
    event_id: int, booth_id: str, exclude_app_id: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    booth_id = str(booth_id or "").strip()
    if not booth_id:
        return None

    now = utc_now()
    for a in _APPLICATIONS.values():
        if exclude_app_id is not None and int(a.get("id") or 0) == int(exclude_app_id):
            continue
        if int(a.get("event_id") or 0) != int(event_id):
            continue
        if str(a.get("booth_id") or "").strip() != booth_id:
            continue

        pay = _coerce_payment_status(a.get("payment_status"))
        if pay == "paid":
            return a
        if pay in ("unpaid", "pending"):
            until = parse_iso_dt(a.get("booth_reserved_until"))
            if until and until > now:
                return a
    return None


def _payment_exists_for_application(app_id: Any) -> bool:
    try:
        app_id_int = int(app_id or 0)
    except Exception:
        return False

    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        try:
            if int(payment.get("application_id") or 0) == app_id_int:
                return True
        except Exception:
            continue
    return False


def _extract_price_to_cents(value: Any) -> int:
    if value is None or isinstance(value, bool):
        return 0
    try:
        if isinstance(value, int):
            if value <= 0:
                return 0
            return value if value >= 1000 else value * 100
        if isinstance(value, float):
            if value <= 0:
                return 0
            return int(round(value * 100))
        s = str(value).strip().replace("$", "").replace(",", "")
        if not s:
            return 0
        num = float(s)
        if num <= 0:
            return 0
        return int(round(num * 100))
    except Exception:
        return 0


def _extract_price_deep(booth: Dict[str, Any]) -> int:
    direct = (
        booth.get("price_cents")
        or booth.get("price")
        or booth.get("amount_cents")
        or booth.get("amount")
        or booth.get("booth_price")
        or booth.get("boothPrice")
        or booth.get("cost")
        or booth.get("fee")
    )
    cents = _extract_price_to_cents(direct)
    if cents > 0:
        return cents

    def walk(node: Any) -> int:
        if isinstance(node, dict):
            for key, value in node.items():
                if any(token in str(key).lower() for token in ("price", "amount", "cost", "fee")):
                    val = _extract_price_to_cents(value)
                    if val > 0:
                        return val
                result = walk(value)
                if result > 0:
                    return result
        elif isinstance(node, list):
            for item in node:
                result = walk(item)
                if result > 0:
                    return result
        return 0

    return walk(booth)
def _candidate_booth_keys(booth_id: Any) -> set[str]:
    raw = str(booth_id or "").strip()
    out = {raw}
    if raw.lower().startswith("booth "):
        out.add(raw.split(" ", 1)[1].strip())
    if raw.lower().startswith("booth"):
        out.add(raw[5:].strip())
    if raw.isdigit():
        out.add(f"Booth {raw}")
        out.add(f"booth_{raw}")
        out.add(f"booth-{raw}")
    return {x for x in out if x}


def _extract_booths_from_event(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []

    def visit(node: Any):
        if isinstance(node, dict):
            if any(
                k in node for k in ("booth_id", "id", "label", "name", "number", "boothId")
            ) and any(
                k in node
                for k in (
                    "price",
                    "price_cents",
                    "priceCents",
                    "amount",
                    "amount_cents",
                    "amountCents",
                    "booth_price",
                    "boothPrice",
                    "cost",
                    "fee",
                )
            ):
                found.append(node)
            for _, value in node.items():
                if isinstance(value, (dict, list)):
                    visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(event)
    return found

def _app_booth_candidates(app: Dict[str, Any]) -> set[str]:
    candidates = set()

    for value in [
        app.get("booth_id"),
        app.get("boothId"),
        app.get("requested_booth_id"),
        app.get("booth"),
        app.get("booth_label"),
        app.get("booth_number"),
    ]:
        if value is None:
            continue

        text = str(value).strip().lower()
        if not text:
            continue

        candidates.add(text)

        if text.isdigit():
            candidates.add(f"booth {text}")
            candidates.add(f"booth_{text}")
            candidates.add(f"booth-{text}")

        if text.startswith("booth "):
            num = text.replace("booth ", "").strip()
            if num:
                candidates.add(num)

    return candidates


def _booth_match_values(item: Dict[str, Any]) -> set[str]:
    values = set()

    for value in [
        item.get("id"),
        item.get("booth_id"),
        item.get("boothId"),
        item.get("label"),
        item.get("name"),
        item.get("number"),
        item.get("booth_number"),
    ]:
        if value is None:
            continue
        text = str(value).strip().lower()
        if text:
            values.add(text)

    return values


def _find_event_booth_price_cents(app: Dict[str, Any]) -> int:
    try:
        event_id = int(app.get("event_id") or 0)
    except Exception:
        return 0

    if event_id <= 0:
        return 0

    try:
        event = get_event_or_404(event_id)
    except Exception:
        return 0

    booths = _extract_booths_from_event(event)
    if not isinstance(booths, list):
        return 0

    booth_keys = _app_booth_candidates(app)

    for booth in booths:
        if not isinstance(booth, dict):
            continue

        booth_values = set()

        for field in ["id", "label", "name", "number", "booth_id", "boothId", "booth_number"]:
            val = booth.get(field)
            if not val:
                continue

            s = str(val).strip().lower()
            booth_values.add(s)

            digits = "".join(c for c in s if c.isdigit())
            if digits:
                booth_values.add(digits)
                booth_values.add(f"booth {digits}")
                booth_values.add(f"booth_{digits}")
                booth_values.add(f"booth-{digits}")

        if not (booth_keys & booth_values):
            continue

        price_cents = _extract_price_deep(booth)
        if price_cents > 0:
            return price_cents

    return 0
def _find_booth_price_cents_for_app(app: Dict[str, Any]) -> int:
    # ✅ FIXED INDENTATION (this was your crash)
    event_cents = _find_event_booth_price_cents(app) or 0
    if event_cents > 0:
        return event_cents

    direct_amount = _extract_price_to_cents(app.get("amount_cents"))
    if direct_amount > 0:
        return direct_amount

    for key in ("booth_price", "price", "amount", "cost"):
        cents = _extract_price_to_cents(app.get(key))
        if cents > 0:
            return cents

    return 0
def _persist_resolved_booth_price(app: Dict[str, Any]) -> int:
    cents = _find_booth_price_cents_for_app(app)
    if cents > 0:
        app["amount_cents"] = cents
        app["booth_price"] = round(cents / 100.0, 2)
        return cents
    return 0


def _get_amount_cents_from_app(app: Dict[str, Any]) -> int:
    locked_cents = app.get("paid_amount_cents_locked")
    try:
        if locked_cents is not None and int(locked_cents) > 0:
            return int(locked_cents)
    except Exception:
        pass

    cents = _persist_resolved_booth_price(app)
    if cents > 0:
        return cents

    raise HTTPException(
        status_code=400,
        detail="No valid booth price found for this application."
    )


def _matches_current_organizer(
    *,
    organizer_email: str,
    organizer_id: Any,
    record_email: Any,
    record_id: Any,
) -> bool:
    rec_email = _norm_email(record_email)
    rec_id = None if record_id is None else str(record_id)

    if organizer_email:
        if rec_email:
            return rec_email == organizer_email
        return (
            rec_id is not None
            and organizer_id is not None
            and rec_id == str(organizer_id)
        )

    if organizer_id is not None:
        return rec_id is not None and rec_id == str(organizer_id)

    return False


def _derive_organizer_fields(app: Dict[str, Any]) -> Dict[str, Any]:
    event = _EVENTS.get(int(app.get("event_id") or 0), {})
    organizer_id = (
        event.get("organizer_id")
        or app.get("organizer_id")
        or event.get("owner_id")
        or event.get("created_by")
        or None
    )
    organizer_email = (
        _norm_email(
            event.get("organizer_email")
            or app.get("organizer_email")
            or event.get("owner_email")
        )
        or None
    )
    organizer_name = (
        event.get("organizer_name")
        or event.get("host_name")
        or app.get("organizer_name")
        or organizer_email
        or f"Organizer for Event #{app.get('event_id')}"
    )
    return {
        "organizer_id": organizer_id,
        "organizer_email": organizer_email,
        "organizer_name": organizer_name,
    }


def _ensure_payment_organizer_fields(payment: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payment, dict):
        return {}
    app = _APPLICATIONS.get(int(payment.get("application_id") or 0), {})
    derived = _derive_organizer_fields(app) if app else {}
    if not payment.get("organizer_name") and derived.get("organizer_name"):
        payment["organizer_name"] = derived["organizer_name"]
    if not payment.get("organizer_email") and derived.get("organizer_email"):
        payment["organizer_email"] = derived["organizer_email"]
    if not payment.get("organizer_id") and derived.get("organizer_id") is not None:
        payment["organizer_id"] = derived["organizer_id"]
    return payment


def _next_payment_id() -> int:
    ids = []
    for k in _PAYMENTS.keys():
        try:
            ids.append(int(k))
        except Exception:
            continue
    return (max(ids) + 1) if ids else 1


def _next_payout_id() -> int:
    ids = []
    for k in _PAYOUTS.keys():
        try:
            ids.append(int(k))
        except Exception:
            continue
    return (max(ids) + 1) if ids else 1


def _lock_fee_snapshot(app: Dict[str, Any], amount: float) -> Dict[str, Any]:
    amount = round(float(amount), 2)
    amount_cents = int(round(amount * 100))
    platform_fee_percent = int(PLATFORM_FEE_PERCENT)
    platform_fee = round(amount * (platform_fee_percent / 100), 2)
    organizer_payout = round(amount - platform_fee, 2)

    app["fee_locked"] = True
    app["fee_locked_at"] = utc_now_iso()
    app["fee_version"] = FEE_VERSION
    app["platform_fee_percent_locked"] = platform_fee_percent
    app["platform_fee_locked"] = platform_fee
    app["organizer_payout_locked"] = organizer_payout
    app["paid_amount_locked"] = amount
    app["paid_amount_cents_locked"] = amount_cents
    return {
        "amount": amount,
        "amount_cents": amount_cents,
        "platform_fee_percent": platform_fee_percent,
        "platform_fee": platform_fee,
        "organizer_payout": organizer_payout,
    }


def _create_payment_record(app: Dict[str, Any], amount: float) -> Dict[str, Any]:
    existing = next(
        (
            p
            for p in _PAYMENTS.values()
            if isinstance(p, dict)
            and int(p.get("application_id") or 0) == int(app.get("id") or 0)
        ),
        None,
    )
    if existing:
        return _ensure_payment_organizer_fields(existing)

    event = _EVENTS.get(int(app.get("event_id") or 0), {})
    organizer = _derive_organizer_fields(app)
    snapshot = _lock_fee_snapshot(app, amount)

    payment = {
        "id": _next_payment_id(),
        "application_id": app.get("id"),
        "event_id": app.get("event_id"),
        "vendor_email": app.get("vendor_email"),
        "vendor_name": app.get("vendor_name")
        or app.get("vendor_company_name")
        or app.get("vendor_email"),
        "organizer_id": organizer.get("organizer_id"),
        "organizer_email": organizer.get("organizer_email"),
        "organizer_name": organizer.get("organizer_name"),
        "event_title": event.get("title")
        or app.get("event_title")
        or app.get("event_name")
        or f"Event #{app.get('event_id')}",
        "booth_id": app.get("booth_id"),
        "amount": snapshot["amount"],
        "amount_cents": snapshot["amount_cents"],
        "platform_fee_percent": snapshot["platform_fee_percent"],
        "platform_fee": snapshot["platform_fee"],
        "organizer_payout": snapshot["organizer_payout"],
        "fee_locked": True,
        "fee_locked_at": app.get("fee_locked_at"),
        "fee_version": FEE_VERSION,
        "status": "paid",
        "payout_status": "unpaid",
        "payout_sent_at": None,
        "payout_method": None,
        "payout_notes": None,
        "payout_batch_id": None,
        "paid_at": app.get("paid_at") or utc_now_iso(),
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
    }

    _PAYMENTS[payment["id"]] = payment
    return payment


def get_payment_totals() -> Dict[str, Any]:
    gross_sales = 0.0
    platform_revenue = 0.0
    organizer_payouts_owed = 0.0
    organizer_payouts_paid = 0.0
    unpaid_count = 0
    paid_count = 0
    scheduled_count = 0
    payment_count = 0

    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        payment = _ensure_payment_organizer_fields(payment)

        if str(payment.get("status") or "") != "paid":
            continue

        payment_count += 1
        amount = _to_float(payment.get("amount"))
        platform_fee = _to_float(payment.get("platform_fee"))
        organizer_payout = _to_float(payment.get("organizer_payout"))
        payout_status = str(payment.get("payout_status") or "unpaid").strip().lower()

        gross_sales = round(gross_sales + amount, 2)
        platform_revenue = round(platform_revenue + platform_fee, 2)

        if payout_status == "paid":
            organizer_payouts_paid = round(organizer_payouts_paid + organizer_payout, 2)
            paid_count += 1
        else:
            organizer_payouts_owed = round(organizer_payouts_owed + organizer_payout, 2)
            if payout_status == "scheduled":
                scheduled_count += 1
            else:
                unpaid_count += 1

    return {
        "payment_count": payment_count,
        "gross_sales": gross_sales,
        "platform_revenue": platform_revenue,
        "organizer_payouts_owed": organizer_payouts_owed,
        "organizer_payouts_paid": organizer_payouts_paid,
        "payout_status_counts": {
            "unpaid": unpaid_count,
            "scheduled": scheduled_count,
            "paid": paid_count,
        },
    }


def _organizer_metrics() -> Dict[str, Any]:
    organizer_keys = set()
    live_event_keys = set()
    payout_due_keys = set()

    for event in _EVENTS.values():
        if not isinstance(event, dict):
            continue
        key = (
            str(event.get("organizer_id") or "").strip()
            or _norm_email(event.get("organizer_email"))
            or _norm_email(event.get("owner_email"))
            or str(event.get("owner_id") or "").strip()
            or ""
        )
        if key:
            organizer_keys.add(key)
            live_event_keys.add(key)

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue
        derived = _derive_organizer_fields(app)
        key = (
            str(derived.get("organizer_id") or "").strip()
            or _norm_email(derived.get("organizer_email"))
            or ""
        )
        if key:
            organizer_keys.add(key)

    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        payment = _ensure_payment_organizer_fields(payment)
        key = (
            str(payment.get("organizer_id") or "").strip()
            or _norm_email(payment.get("organizer_email"))
            or ""
        )
        if key:
            organizer_keys.add(key)
            if (
                str(payment.get("status") or "").lower() == "paid"
                and str(payment.get("payout_status") or "unpaid").lower() != "paid"
            ):
                payout_due_keys.add(key)

    return {
        "total_organizers": len(organizer_keys),
        "organizers_with_live_events": len(live_event_keys),
        "organizers_with_payouts_due": len(payout_due_keys),
    }


def _require_admin(user: Dict[str, Any]) -> None:
    if str(user.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


def _require_organizer_or_admin(user: Dict[str, Any]) -> None:
    role = str(user.get("role") or "").strip().lower()
    if role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Organizer access required.")


def _ensure_event_access_for_current_organizer(
    event: Dict[str, Any], user: Dict[str, Any]
) -> None:
    organizer_email = _norm_email(user.get("email"))
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    if str(user.get("role") or "").strip().lower() == "admin":
        return

    if _matches_current_organizer(
        organizer_email=organizer_email,
        organizer_id=organizer_id,
        record_email=event.get("organizer_email") or event.get("owner_email"),
        record_id=event.get("organizer_id")
        or event.get("owner_id")
        or event.get("created_by"),
    ):
        return

    raise HTTPException(status_code=403, detail="Not allowed to view this event")


def _mark_application_paid(
    app: Dict[str, Any],
    amount: float,
    user: Optional[Dict[str, Any]] = None,
    source: str = "system",
) -> Dict[str, Any]:
    app["payment_status"] = "paid"
    app["paid_at"] = utc_now_iso()
    app["booth_reserved_until"] = None
    app["status"] = "approved"
    app["updated_at"] = utc_now_iso()
    payment = _create_payment_record(app, amount)

    _audit(
        action="payment_recorded",
        entity_type="payment",
        entity_id=payment.get("id"),
        user=user,
        details={
            "source": source,
            "application_id": app.get("id"),
            "event_id": app.get("event_id"),
            "amount": payment.get("amount"),
            "platform_fee": payment.get("platform_fee"),
            "organizer_payout": payment.get("organizer_payout"),
            "fee_version": payment.get("fee_version"),
        },
    )

    save_store()
    return payment


class ReviewCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rating: float
    comment: Optional[str] = ""
    event_id: Optional[int] = None


class ApplyBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: Optional[str] = None
    notes: Optional[str] = None
    checked: Optional[Dict[str, bool]] = None


class UploadedDocMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    size: int
    type: Optional[str] = None
    lastModified: Optional[int] = None


class ApplicationProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    checked: Optional[Dict[str, bool]] = None
    docs: Optional[Dict[str, List[UploadedDocMeta]]] = None
    documents: Optional[Dict[str, Any]] = None
    booth_id: Optional[str] = None
    booth_category_id: Optional[str] = None


class CheckoutCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    amount_cents: Optional[int] = None
    currency: str = "usd"
    description: Optional[str] = None


class ReserveBoothBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: str
    hold_hours: int = 24


class ExtendReservationBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    extend_hours: int = 24


class ChangeBoothBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booth_id: str


class PayoutMarkBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    method: Optional[str] = "manual"
    notes: Optional[str] = None


class SendOrganizerPayoutBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    organizer_id: Optional[int] = None
    organizer_email: Optional[str] = None
    method: Optional[str] = "manual"
    notes: Optional[str] = None


@router.post("/applications/events/{event_id}/apply")
def apply_to_event(
    event_id: int,
    request: Request,
    body: ApplyBody = Body(...),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    get_event_or_404(event_id)

    email = _norm_email(user.get("email"))
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")

    vendor_id = (
        user.get("vendor_id")
        or user.get("id")
        or user.get("sub")
        or _stable_user_id_from_email(email)
        or None
    )

    app = get_or_create_application(
        vendor_email=email,
        event_id=int(event_id),
        defaults={
            "vendor_id": vendor_id,
            "requested_booth_id": None,
            "booth_id": None,
            "booth_reserved_until": None,
            "notes": body.notes or "",
            "checked": body.checked or {},
            "docs": {},
            "documents": {},
            "submitted_at": None,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "payment_status": "unpaid",
            "paid_at": None,
            "amount_cents": 0,
            "booth_price": None,
        },
    )

    if body.notes is not None:
        app["notes"] = body.notes or ""
    if body.checked is not None:
        app["checked"] = body.checked or {}

    if body.booth_id is not None:
        requested_booth_id = str(body.booth_id or "").strip()
        app["requested_booth_id"] = requested_booth_id or None

    app["updated_at"] = utc_now_iso()
    _persist_resolved_booth_price(app)
    save_store()
    return {"ok": True, "application": app}


@router.put("/applications/{app_id}/progress")
def update_application_progress(
    app_id: int,
    payload: ApplicationProgressUpdate = Body(...),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    email = _norm_email(user.get("email"))
    if _norm_email(app.get("vendor_email")) != email:
        raise HTTPException(status_code=403, detail="Forbidden")

    if payload.checked is not None:
        if not isinstance(payload.checked, dict):
            raise HTTPException(status_code=400, detail="checked must be an object")
        app["checked"] = {str(k): bool(v) for k, v in payload.checked.items()}

    incoming_docs: Any = (
        payload.documents if payload.documents is not None else payload.docs
    )
    if incoming_docs is not None:
        if not isinstance(incoming_docs, dict):
            raise HTTPException(
                status_code=400, detail="documents/docs must be an object"
            )
        normalized: Dict[str, List[Dict[str, Any]]] = {}
        for doc_id, metas in incoming_docs.items():
            if metas is None:
                continue
            meta_list: List[Any] = metas if isinstance(metas, list) else [metas]
            cleaned: List[Dict[str, Any]] = []
            for m in meta_list:
                if m is None:
                    continue
                if isinstance(m, UploadedDocMeta):
                    name = m.name
                    size = int(m.size)
                    mtype = m.type or ""
                    last_mod = int(m.lastModified or 0)
                elif isinstance(m, dict):
                    name = str(m.get("name") or "").strip()
                    if not name:
                        continue
                    size = int(m.get("size") or 0)
                    mtype = str(m.get("type") or "")
                    last_mod = int(m.get("lastModified") or 0)
                else:
                    continue

                cleaned.append(
                    {
                        "name": name,
                        "size": size,
                        "type": mtype,
                        "lastModified": last_mod,
                    }
                )
            if cleaned:
                normalized[str(doc_id)] = cleaned

        app["docs"] = normalized
        app["documents"] = normalized

    if payload.booth_id is not None:
        if _coerce_payment_status(app.get("payment_status")) == "paid":
            raise HTTPException(
                status_code=400,
                detail="Booth is already confirmed and cannot be changed after payment.",
            )
        requested_booth_id = str(payload.booth_id or "").strip()
        app["requested_booth_id"] = requested_booth_id or None

    if payload.booth_category_id is not None:
        app["booth_category_id"] = str(payload.booth_category_id).strip() or None

    _persist_resolved_booth_price(app)
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.put("/vendor/applications/{app_id}/progress")
def vendor_update_application_progress(
    app_id: int,
    payload: ApplicationProgressUpdate = Body(...),
    user: dict = Depends(get_current_user),
):
    return update_application_progress(app_id=app_id, payload=payload, user=user)


@router.patch("/vendor/applications/{app_id}")
def vendor_update_application(
    app_id: int,
    payload: ApplicationProgressUpdate = Body(...),
    user: dict = Depends(get_current_user),
):
    app = get_application_or_404(app_id)

    if _norm_email(app.get("vendor_email")) != _norm_email(user.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed")

    return update_application_progress(app_id=app_id, payload=payload, user=user)


@router.get("/vendor/applications/{app_id}")
def vendor_get_application(app_id: int, user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if _norm_email(app.get("vendor_email")) != _norm_email(user.get("email")):
        raise HTTPException(status_code=403, detail="Not allowed")

    d = app.get("documents") or app.get("docs") or {}
    app["documents"] = d
    app["docs"] = d
    app["payment_status"] = _coerce_payment_status(app.get("payment_status"))
    _persist_resolved_booth_price(app)
    return {"application": app}


@router.get("/vendor/applications")
def list_vendor_applications(user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    email = _norm_email(user.get("email"))
    apps = [
        a for a in _APPLICATIONS.values() if _norm_email(a.get("vendor_email")) == email
    ]
    for a in apps:
        d = a.get("documents") or a.get("docs") or {}
        a["documents"] = d
        a["docs"] = d
        _persist_resolved_booth_price(a)
    return {"applications": apps}


@router.post("/vendor/applications/{application_id}/submit")
def submit_application(application_id: int, user: dict = Depends(get_current_user)):
    expire_reservations_if_needed()
    app = get_application_or_404(application_id)

    if _norm_email(app.get("vendor_email")) != _norm_email(user.get("email")):
        raise HTTPException(status_code=403, detail="Forbidden")

    checked = app.get("checked") or {}
    docs = app.get("documents") or app.get("docs") or {}
    booth = app.get("requested_booth_id") or app.get("booth_id")

    requirements_exist = (
        any(checked.values()) if isinstance(checked, dict) else False
    ) or (any(docs.values()) if isinstance(docs, dict) else False)

    requirements_complete = (
        not checked or all(bool(v) for v in checked.values())
    ) and (not docs or all(bool(v) for v in docs.values()))

    if not booth:
        raise HTTPException(
            status_code=400,
            detail="Please request a booth before submitting.",
        )

    if requirements_exist and not requirements_complete:
        raise HTTPException(
            status_code=400,
            detail="Application requirements incomplete. Complete compliance items and upload required documents before submitting.",
        )

    _set_status(app, "submitted")
    save_store()
    return {"application": app}


@router.get("/organizer/events")
def organizer_events(user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    organizer_email = _norm_email(user.get("email"))
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    out: List[Dict[str, Any]] = []
    for event in _EVENTS.values():
        if not isinstance(event, dict):
            continue

        if _matches_current_organizer(
            organizer_email=organizer_email,
            organizer_id=organizer_id,
            record_email=event.get("organizer_email") or event.get("owner_email"),
            record_id=event.get("organizer_id")
            or event.get("owner_id")
            or event.get("created_by"),
        ):
            out.append(dict(event))

    out.sort(
        key=lambda e: (
            str(e.get("updated_at") or e.get("created_at") or ""),
            int(e.get("id") or 0),
        ),
        reverse=True,
    )
    return {"events": out}


@router.get("/organizer/earnings")
def organizer_earnings(user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    organizer_email = _norm_email(user.get("email"))
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    event_rows: Dict[int, Dict[str, Any]] = {}

    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        payment = _ensure_payment_organizer_fields(payment)

        if not _matches_current_organizer(
            organizer_email=organizer_email,
            organizer_id=organizer_id,
            record_email=payment.get("organizer_email"),
            record_id=payment.get("organizer_id"),
        ):
            continue

        event_id = int(payment.get("event_id") or 0)
        row = event_rows.setdefault(
            event_id,
            {
                "event_id": event_id,
                "event_title": payment.get("event_title") or f"Event #{event_id}",
                "gross_sales": 0.0,
                "platform_fees": 0.0,
                "net_earnings": 0.0,
                "payouts_paid": 0.0,
                "payouts_owed": 0.0,
                "payout_status_counts": {"unpaid": 0, "scheduled": 0, "paid": 0},
            },
        )

        amount = _to_float(payment.get("amount"))
        platform_fee = _to_float(payment.get("platform_fee"))
        organizer_payout = _to_float(payment.get("organizer_payout"))
        payout_status = str(payment.get("payout_status") or "unpaid").strip().lower()

        row["gross_sales"] = round(row["gross_sales"] + amount, 2)
        row["platform_fees"] = round(row["platform_fees"] + platform_fee, 2)
        row["net_earnings"] = round(row["net_earnings"] + organizer_payout, 2)

        if payout_status == "paid":
            row["payouts_paid"] = round(row["payouts_paid"] + organizer_payout, 2)
            row["payout_status_counts"]["paid"] += 1
        else:
            row["payouts_owed"] = round(row["payouts_owed"] + organizer_payout, 2)
            if payout_status == "scheduled":
                row["payout_status_counts"]["scheduled"] += 1
            else:
                row["payout_status_counts"]["unpaid"] += 1

    events = list(event_rows.values())
    events.sort(key=lambda row: row["net_earnings"], reverse=True)

    summary = {
        "gross_sales": round(sum(_to_float(r["gross_sales"]) for r in events), 2),
        "platform_fees": round(sum(_to_float(r["platform_fees"]) for r in events), 2),
        "net_earnings": round(sum(_to_float(r["net_earnings"]) for r in events), 2),
        "payouts_paid": round(sum(_to_float(r["payouts_paid"]) for r in events), 2),
        "payouts_owed": round(sum(_to_float(r["payouts_owed"]) for r in events), 2),
    }

    return {"summary": summary, "events": events}


@router.get("/organizer/activity")
def organizer_activity(limit: int = 10, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    organizer_email = _norm_email(user.get("email"))
    organizer_id = user.get("organizer_id") or user.get("id") or user.get("sub")

    activities: List[Dict[str, Any]] = []
    owned_event_ids = set()

    for event in _EVENTS.values():
        if not isinstance(event, dict):
            continue
        if _matches_current_organizer(
            organizer_email=organizer_email,
            organizer_id=organizer_id,
            record_email=event.get("organizer_email") or event.get("owner_email"),
            record_id=event.get("organizer_id")
            or event.get("owner_id")
            or event.get("created_by"),
        ):
            owned_event_ids.add(int(event.get("id") or 0))

    for app in _APPLICATIONS.values():
        if not isinstance(app, dict):
            continue
        if int(app.get("event_id") or 0) not in owned_event_ids:
            continue

        event = _EVENTS.get(int(app.get("event_id") or 0), {})
        event_name = event.get("title")

        activities.append(
            {
                "type": "application",
                "title": "Application Submitted",
                "message": "Vendor applied",
                "event_name": event_name,
                "time": app.get("created_at"),
            }
        )

        if str(app.get("status") or "").lower() == "approved":
            activities.append(
                {
                    "type": "approved",
                    "title": "Vendor Approved",
                    "message": "Vendor approved",
                    "event_name": event_name,
                    "time": app.get("updated_at"),
                }
            )

        if str(app.get("payment_status") or "").lower() == "paid":
            activities.append(
                {
                    "type": "payment",
                    "title": "Payment Received",
                    "message": "Vendor paid",
                    "event_name": event_name,
                    "time": app.get("paid_at") or app.get("updated_at"),
                }
            )

    activities = [a for a in activities if a.get("time")]
    activities.sort(key=lambda x: str(x.get("time") or ""), reverse=True)
    return {"activity": activities[: max(1, min(int(limit or 10), 100))]}


@router.get("/organizer/events/{event_id}/applications")
def organizer_list_event_applications(
    event_id: int, user: dict = Depends(get_current_user)
):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()

    event = get_event_or_404(event_id)
    _ensure_event_access_for_current_organizer(event, user)

    apps = [
        dict(a)
        for a in _APPLICATIONS.values()
        if int(a.get("event_id") or 0) == int(event_id)
    ]
    enriched = []
    for a in apps:
        d = a.get("documents") or a.get("docs") or {}
        a["documents"] = d
        a["docs"] = d
        a["payment_status"] = _coerce_payment_status(a.get("payment_status"))
        a.update(_application_score(a))
        _persist_resolved_booth_price(a)
        enriched.append(a)

    enriched.sort(
        key=lambda a: (
            -(int(a.get("score") or 0)),
            str(a.get("updated_at") or ""),
            int(a.get("id") or 0),
        ),
        reverse=False,
    )
    return {"applications": enriched}


@router.get("/organizer/events/{event_id}/applications/{app_id}")
def organizer_get_application(
    event_id: int, app_id: int, user: dict = Depends(get_current_user)
):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    event = get_event_or_404(event_id)

    _ensure_event_access_for_current_organizer(event, user)

    app = dict(get_application_or_404(app_id))
    if int(app.get("event_id") or 0) != int(event_id):
        raise HTTPException(status_code=404, detail="Application not found")

    d = app.get("documents") or app.get("docs") or {}
    app["documents"] = d
    app["docs"] = d
    app["payment_status"] = _coerce_payment_status(app.get("payment_status"))
    app.update(_application_score(app))
    _persist_resolved_booth_price(app)
    return {"application": app}


@router.get("/organizer/events/{event_id}/stats")
def organizer_event_stats(event_id: int, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    event = dict(get_event_or_404(event_id))

    _ensure_event_access_for_current_organizer(event, user)

    apps = [
        a
        for a in _APPLICATIONS.values()
        if int(a.get("event_id") or 0) == int(event_id)
    ]

    applications = len(apps)
    approved = sum(1 for a in apps if str(a.get("status") or "").lower() == "approved")
    pending = sum(
        1
        for a in apps
        if str(a.get("status") or "").lower()
        in {"submitted", "under_review", "in_review"}
    )
    paid = sum(1 for a in apps if str(a.get("payment_status") or "").lower() == "paid")
    reserved = sum(1 for a in apps if bool(str(a.get("booth_id") or "").strip()))
    revenue = 0.0
    for a in apps:
        if str(a.get("payment_status") or "").lower() != "paid":
            continue
        if a.get("paid_amount_locked") is not None:
            revenue += _to_float(a.get("paid_amount_locked"))
        else:
            cents = _get_amount_cents_from_app(a)
            revenue += round(cents / 100.0, 2)

    return {
        "event": event,
        "stats": {
            "applications": applications,
            "approved": approved,
            "pending": pending,
            "paid": paid,
            "reserved": reserved,
            "revenue": round(revenue, 2),
        },
    }


@router.post("/organizer/applications/{app_id}/approve")
def organizer_approve_application(app_id: int, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)

    booth_id = str(app.get("requested_booth_id") or app.get("booth_id") or "").strip()
    if not booth_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot approve application without a requested or assigned booth.",
        )

    event_id = int(app.get("event_id") or 0)
    get_event_or_404(event_id)

    conflict = _booth_conflict(
        event_id=event_id,
        booth_id=booth_id,
        exclude_app_id=int(app_id),
    )
    if conflict:
        raise HTTPException(
            status_code=409,
            detail="Cannot approve because this booth is already reserved or occupied by another application.",
        )

    _set_status(app, "approved")

    app["booth_id"] = booth_id
    if not app.get("requested_booth_id"):
        app["requested_booth_id"] = booth_id

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay != "paid":
        app["payment_status"] = "unpaid"
        app["booth_reserved_until"] = (utc_now() + timedelta(hours=24)).isoformat()

    _persist_resolved_booth_price(app)
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/reject")
def organizer_reject_application(app_id: int, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    _set_status(app, "rejected")
    app["payment_status"] = "expired"
    app["requested_booth_id"] = None
    app["booth_id"] = None
    app["booth_reserved_until"] = None
    app["amount_cents"] = 0
    app["booth_price"] = None
    save_store()
    return {"ok": True, "application": app}


@router.delete("/organizer/applications/{app_id}")
def organizer_delete_application(app_id: int, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    get_application_or_404(app_id)
    _APPLICATIONS.pop(int(app_id), None)
    save_store()
    return {"ok": True, "deleted": int(app_id)}


@router.post("/organizer/applications/{app_id}/reserve-booth")
def organizer_reserve_booth(
    app_id: int,
    body: ReserveBoothBody = Body(...),
    user: dict = Depends(get_current_user),
):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if str(app.get("status") or "").lower() not in ("submitted", "approved"):
        raise HTTPException(
            status_code=400,
            detail="Only submitted or approved applications can reserve a booth.",
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot reserve: already paid/occupied."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot reserve while payment is pending."
        )

    event_id = int(app.get("event_id") or 0)
    get_event_or_404(event_id)

    booth_id = str(body.booth_id or "").strip()
    if not booth_id:
        raise HTTPException(status_code=400, detail="booth_id is required")

    conflict = _booth_conflict(
        event_id=event_id, booth_id=booth_id, exclude_app_id=int(app_id)
    )
    if conflict:
        raise HTTPException(
            status_code=409, detail="Booth is not available (reserved or occupied)."
        )

    hold_hours = max(1, min(168, int(body.hold_hours or 24)))
    app["booth_id"] = booth_id
    app["requested_booth_id"] = None
    app["booth_reserved_until"] = (utc_now() + timedelta(hours=hold_hours)).isoformat()
    app["payment_status"] = "unpaid"
    _persist_resolved_booth_price(app)
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/extend-reservation")
def organizer_extend_reservation(
    app_id: int,
    body: ExtendReservationBody = Body(default=ExtendReservationBody()),
    user: dict = Depends(get_current_user),
):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Only approved applications can extend reservation."
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot extend after payment (occupied)."
        )
    if pay not in ("unpaid", "pending"):
        raise HTTPException(
            status_code=400, detail="Only unpaid/pending reservations can be extended."
        )
    if not app.get("booth_id") or not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No active reservation to extend.")
    if _reservation_is_expired(app):
        raise HTTPException(status_code=400, detail="Reservation already expired.")

    extend_hours = max(1, min(168, int(body.extend_hours or 24)))
    until = parse_iso_dt(app.get("booth_reserved_until")) or utc_now()
    app["booth_reserved_until"] = (until + timedelta(hours=extend_hours)).isoformat()
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/change-booth")
def organizer_change_booth(
    app_id: int,
    body: ChangeBoothBody = Body(...),
    user: dict = Depends(get_current_user),
):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if str(app.get("status") or "").lower() not in ("submitted", "approved"):
        raise HTTPException(
            status_code=400,
            detail="Only submitted or approved applications can change booth.",
        )
    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot change booth after payment."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot change booth while payment is pending."
        )
    if pay not in ("unpaid", "expired"):
        raise HTTPException(
            status_code=400, detail="Invalid payment_status for booth change."
        )
    if not app.get("booth_id") or not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No active reservation to change.")
    if _reservation_is_expired(app):
        raise HTTPException(status_code=400, detail="Reservation expired.")

    event_id = int(app.get("event_id") or 0)
    get_event_or_404(event_id)

    new_booth_id = str(body.booth_id or "").strip()
    if not new_booth_id:
        raise HTTPException(status_code=400, detail="booth_id is required")

    conflict = _booth_conflict(
        event_id=event_id, booth_id=new_booth_id, exclude_app_id=int(app_id)
    )
    if conflict:
        raise HTTPException(
            status_code=409, detail="Booth is not available (reserved or occupied)."
        )

    app["booth_id"] = new_booth_id
    app["requested_booth_id"] = None
    _persist_resolved_booth_price(app)
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


@router.post("/organizer/applications/{app_id}/release-reservation")
def organizer_release_reservation(app_id: int, user: dict = Depends(get_current_user)):
    _require_organizer_or_admin(user)
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400,
            detail="Only approved applications can release reservation.",
        )

    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(
            status_code=400, detail="Cannot release after payment (occupied)."
        )
    if pay == "pending":
        raise HTTPException(
            status_code=400, detail="Cannot release while payment is pending."
        )

    app["payment_status"] = "expired"
    app["requested_booth_id"] = None
    app["booth_id"] = None
    app["booth_reserved_until"] = None
    app["amount_cents"] = 0
    app["booth_price"] = None
    app["updated_at"] = utc_now_iso()
    save_store()
    return {"ok": True, "application": app}


def _ensure_can_pay_now(app: Dict[str, Any]):
    if str(app.get("status") or "").lower() != "approved":
        raise HTTPException(
            status_code=400, detail="Application must be approved before payment."
        )
    if not app.get("booth_id"):
        raise HTTPException(
            status_code=400,
            detail="No booth reserved yet. Waiting for organizer assignment.",
        )
    if not app.get("booth_reserved_until"):
        raise HTTPException(status_code=400, detail="No reservation deadline set.")
    if _reservation_is_expired(app):
        raise HTTPException(
            status_code=400,
            detail="Reservation expired. Waiting for organizer to reassign.",
        )
    pay = _coerce_payment_status(app.get("payment_status"))
    if pay == "paid":
        raise HTTPException(status_code=400, detail="Already paid.")
    return pay


@router.post("/vendor/applications/{app_id}/pay-now")
def vendor_pay_now(
    app_id: int,
    body: Optional[CheckoutCreateBody] = Body(default=None),
    user: dict = Depends(get_current_user),
):
    expire_reservations_if_needed()
    app = get_application_or_404(app_id)
    if _norm_email(app.get("vendor_email")) != _norm_email(user.get("email")):
        raise HTTPException(status_code=403, detail="Forbidden")
    _ensure_can_pay_now(app)

    amount_cents = _get_amount_cents_from_app(app)

    body_success_url = body.success_url if body else None
    body_cancel_url = body.cancel_url if body else None
    body_description = body.description if body else None
    body_currency = body.currency if body and body.currency else "usd"

    frontend_base = (
        os.getenv("FRONTEND_BASE_URL")
        or "https://event-app-frontend-7xlfphwaf-tscottcounsel-stacks-projects.vercel.app"
    ).rstrip("/")

    default_success = (
        f"{frontend_base}/vendor/applications"
        f"?payment=success&appId={app_id}&session_id={{CHECKOUT_SESSION_ID}}"
    )
    success_url = (body_success_url or default_success).strip()
    cancel_url = (
        body_cancel_url or f"{frontend_base}/vendor/applications?payment=cancel"
    ).strip()
    desc = (body_description or f"Booth payment for application #{app_id}").strip()
    currency = (body_currency or "usd").strip().lower()

    try:
        import stripe

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_SECRET_KEY not set")

        stripe.api_key = secret

        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=[
                {
                    "price_data": {
                        "currency": currency,
                        "product_data": {"name": desc},
                        "unit_amount": amount_cents,
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "application_id": str(app_id),
                "event_id": str(app.get("event_id") or ""),
                "vendor_email": str(app.get("vendor_email") or ""),
                "vendor_id": str(app.get("vendor_id") or ""),
                "booth_id": str(app.get("booth_id") or ""),
                "amount_cents": str(amount_cents),
            },
        )

        app["payment_status"] = "pending"
        app["updated_at"] = utc_now_iso()
        _audit(
            action="checkout_session_created",
            entity_type="application",
            entity_id=app_id,
            user=user,
            details={"session_id": session.id, "amount_cents": amount_cents},
        )
        save_store()
        return {"ok": True, "url": session.url, "session_id": session.id}

    except HTTPException:
        raise
    except Exception as e:
        return {
            "ok": False,
            "mock": True,
            "detail": f"Stripe not configured: {str(e)}",
            "amount_cents": amount_cents,
        }


@router.post("/vendor/applications/{app_id}/checkout")
def vendor_create_checkout_session_legacy(
    app_id: int,
    body: Optional[CheckoutCreateBody] = Body(default=None),
    user: dict = Depends(get_current_user),
):
    return vendor_pay_now(app_id=app_id, body=body, user=user)


@router.post("/vendor/applications/{app_id}/confirm-payment")
def vendor_confirm_payment(
    app_id: int,
    body: Dict[str, Any] = Body(default={}),
    user: dict = Depends(get_current_user),
):
    if not _is_dev_mode():
        raise HTTPException(
            status_code=403,
            detail="Frontend payment confirmation is disabled outside development. Rely on Stripe webhook.",
        )

    app = get_application_or_404(app_id)
    if _norm_email(app.get("vendor_email")) != _norm_email(user.get("email")):
        raise HTTPException(status_code=403, detail="Forbidden")

    if _payment_exists_for_application(app_id):
        return {"ok": True, "already_paid": True}

    session_id = str((body or {}).get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    try:
        import stripe

        secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        if not secret:
            raise RuntimeError("STRIPE_SECRET_KEY not set")

        stripe.api_key = secret
        session = stripe.checkout.Session.retrieve(session_id)

        if not session:
            raise HTTPException(status_code=404, detail="Stripe session not found")

        payment_status = str(getattr(session, "payment_status", "") or "")
        status = str(getattr(session, "status", "") or "")
        if payment_status != "paid" and status != "complete":
            raise HTTPException(status_code=400, detail="Stripe session not paid")

        metadata = getattr(session, "metadata", None) or {}
        session_app_id = str(metadata.get("application_id") or "").strip()
        if session_app_id and session_app_id != str(app_id):
            raise HTTPException(
                status_code=400, detail="Stripe session does not match this application"
            )

        expected_amount_cents = _get_amount_cents_from_app(app)
        amount_total = getattr(session, "amount_total", None)
        if amount_total is not None:
            try:
                if int(amount_total) != int(expected_amount_cents):
                    raise HTTPException(
                        status_code=400,
                        detail="Stripe amount does not match application total",
                    )
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(
                    status_code=400, detail="Invalid Stripe amount_total"
                )

        amount = (
            round((int(amount_total) / 100.0), 2)
            if amount_total is not None
            else round(expected_amount_cents / 100.0, 2)
        )
        payment = _mark_application_paid(
            app, amount, user=user, source="frontend_confirm_dev"
        )
        return {"ok": True, "application_id": app_id, "payment": payment}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Payment confirmation failed: {e}")


@router.post("/applications/{application_id}/mark-paid")
def mark_application_paid(application_id: int, user: dict = Depends(get_current_user)):
    _require_admin(user)
    expire_reservations_if_needed()

    app = get_application_or_404(application_id)
    if not app.get("booth_id"):
        raise HTTPException(
            status_code=400, detail="Cannot mark paid without a booth selection."
        )
    if _payment_exists_for_application(application_id):
        return {"ok": True, "message": "Payment already recorded."}

    amount = round(_get_amount_cents_from_app(app) / 100.0, 2)
    payment = _mark_application_paid(app, amount, user=user, source="admin_manual")

    return {
        "ok": True,
        "application_id": int(application_id),
        "payment_status": "paid",
        "status": app["status"],
        "booth_id": app.get("booth_id"),
        "payment": payment,
    }


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    import os

    print("WEBHOOK SECRET PRESENT:", bool(os.getenv("STRIPE_WEBHOOK_SECRET")))

    webhook_secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not webhook_secret:
        raise HTTPException(status_code=500, detail="Webhook not configured")

    sig = (request.headers.get("stripe-signature") or "").strip()
    if not sig:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    payload = await request.body()
    try:
        import stripe

        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig,
            secret=webhook_secret,
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    etype = str(event.get("type") or "").strip()
    data_obj = (event.get("data") or {}).get("object") or {}

    _audit(
        action="stripe_webhook_received",
        entity_type="stripe_event",
        entity_id=data_obj.get("id") or etype,
        user=None,
        details={"event_type": etype},
    )

    if etype == "checkout.session.completed":
        meta = data_obj.get("metadata") or {}
        try:
            app_id = int(meta.get("application_id") or 0)
        except Exception:
            app_id = 0

        app = _APPLICATIONS.get(app_id)
        if app and not _payment_exists_for_application(app_id):
            expected_amount_cents = _get_amount_cents_from_app(app)
            amount_total = data_obj.get("amount_total")
            if amount_total is not None:
                try:
                    if int(amount_total) != int(expected_amount_cents):
                        raise HTTPException(
                            status_code=400,
                            detail="Stripe amount does not match application total",
                        )
                except HTTPException:
                    raise
                except Exception:
                    raise HTTPException(
                        status_code=400, detail="Invalid Stripe amount_total"
                    )

            amount = (
                round((int(amount_total) / 100.0), 2)
                if amount_total is not None
                else round(expected_amount_cents / 100.0, 2)
            )
            _mark_application_paid(app, amount, user=None, source="stripe_webhook")

    return {"ok": True}


@router.get("/admin/revenue-summary")
def admin_revenue_summary(user=Depends(get_current_user)):
    _require_admin(user)
    totals = get_payment_totals()
    return {"ok": True, "summary": totals}


@router.get("/admin/payments")
def admin_list_payments(user: dict = Depends(get_current_user)):
    _require_admin(user)
    out: List[Dict[str, Any]] = []
    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        enriched = dict(_ensure_payment_organizer_fields(payment))
        out.append(enriched)

    out.sort(
        key=lambda p: (
            str(p.get("payout_status") or ""),
            str(p.get("paid_at") or p.get("created_at") or ""),
            int(p.get("id") or 0),
        ),
        reverse=True,
    )
    return {"summary": get_payment_totals(), "payments": out}


@router.put("/admin/payments/{payment_id}/mark-payout-paid")
def admin_mark_payout_paid(
    payment_id: int,
    body: PayoutMarkBody = Body(default=PayoutMarkBody()),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    payment = _PAYMENTS.get(int(payment_id))
    if not isinstance(payment, dict):
        raise HTTPException(status_code=404, detail="Payment not found")

    payment = _ensure_payment_organizer_fields(payment)
    if str(payment.get("status") or "").lower() != "paid":
        raise HTTPException(status_code=400, detail="Vendor payment is not complete.")
    if str(payment.get("payout_status") or "").lower() == "paid":
        return {
            "ok": True,
            "payment_id": int(payment_id),
            "payout_status": "paid",
            "payout_sent_at": payment.get("payout_sent_at"),
        }

    now = utc_now_iso()
    payment["payout_status"] = "paid"
    payment["payout_sent_at"] = now
    payment["updated_at"] = now
    payment["payout_method"] = body.method or payment.get("payout_method") or "manual"
    if body.notes is not None:
        payment["payout_notes"] = body.notes

    payout_id = _next_payout_id()
    payout = {
        "id": payout_id,
        "organizer_id": payment.get("organizer_id"),
        "organizer_email": payment.get("organizer_email"),
        "organizer_name": payment.get("organizer_name"),
        "amount": round(_to_float(payment.get("organizer_payout")), 2),
        "payment_ids": [int(payment_id)],
        "payment_count": 1,
        "method": payment.get("payout_method") or "manual",
        "notes": payment.get("payout_notes"),
        "created_at": now,
        "created_by": _norm_email(user.get("email")),
    }
    _PAYOUTS[payout_id] = payout
    payment["payout_batch_id"] = payout_id

    _audit(
        action="payout_marked_paid",
        entity_type="payment",
        entity_id=payment_id,
        user=user,
        details={
            "payout_batch_id": payout_id,
            "organizer_name": payment.get("organizer_name"),
            "organizer_payout": payment.get("organizer_payout"),
            "method": payment.get("payout_method"),
        },
    )

    save_store()

    return {
        "ok": True,
        "payment_id": int(payment_id),
        "payout_status": "paid",
        "payout_sent_at": now,
        "payout_batch_id": payout_id,
    }


@router.get("/admin/payouts")
def admin_list_payouts(user: dict = Depends(get_current_user)):
    _require_admin(user)
    items = [dict(p) for p in _PAYOUTS.values() if isinstance(p, dict)]
    items.sort(
        key=lambda p: (str(p.get("created_at") or ""), int(p.get("id") or 0)),
        reverse=True,
    )
    return {"payouts": items}


@router.post("/admin/payouts/send")
def admin_send_organizer_payout(
    body: SendOrganizerPayoutBody = Body(...),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)

    organizer_id = body.organizer_id
    organizer_email = _norm_email(body.organizer_email)
    if organizer_id is None and not organizer_email:
        raise HTTPException(
            status_code=400, detail="organizer_id or organizer_email is required."
        )

    eligible: List[Dict[str, Any]] = []
    for payment in _PAYMENTS.values():
        if not isinstance(payment, dict):
            continue
        payment = _ensure_payment_organizer_fields(payment)
        if str(payment.get("status") or "").lower() != "paid":
            continue
        if str(payment.get("payout_status") or "unpaid").lower() == "paid":
            continue

        matches = False
        if organizer_id is not None:
            try:
                matches = int(payment.get("organizer_id") or 0) == int(organizer_id)
            except Exception:
                matches = False
        if not matches and organizer_email:
            matches = _norm_email(payment.get("organizer_email")) == organizer_email

        if matches:
            eligible.append(payment)

    if not eligible:
        raise HTTPException(
            status_code=404,
            detail="No unpaid organizer payouts found for that organizer.",
        )

    now = utc_now_iso()
    payment_ids: List[int] = []
    amount = 0.0
    organizer_name = None
    organizer_email_final = organizer_email or None
    organizer_id_final = organizer_id

    for payment in eligible:
        pid = int(payment.get("id") or 0)
        payment_ids.append(pid)
        amount = round(amount + _to_float(payment.get("organizer_payout")), 2)
        organizer_name = organizer_name or payment.get("organizer_name")
        organizer_email_final = organizer_email_final or payment.get("organizer_email")
        organizer_id_final = organizer_id_final or payment.get("organizer_id")
        payment["payout_status"] = "paid"
        payment["payout_sent_at"] = now
        payment["updated_at"] = now
        payment["payout_method"] = body.method or "manual"
        payment["payout_notes"] = body.notes

    payout_id = _next_payout_id()
    payout = {
        "id": payout_id,
        "organizer_id": organizer_id_final,
        "organizer_email": organizer_email_final,
        "organizer_name": organizer_name
        or organizer_email_final
        or f"Organizer #{organizer_id_final}",
        "amount": amount,
        "payment_ids": payment_ids,
        "payment_count": len(payment_ids),
        "method": body.method or "manual",
        "notes": body.notes,
        "created_at": now,
        "created_by": _norm_email(user.get("email")),
    }
    _PAYOUTS[payout_id] = payout

    for payment in eligible:
        payment["payout_batch_id"] = payout_id

    _audit(
        action="organizer_payout_sent",
        entity_type="payout",
        entity_id=payout_id,
        user=user,
        details={
            "organizer_name": payout.get("organizer_name"),
            "organizer_email": payout.get("organizer_email"),
            "amount": payout.get("amount"),
            "payment_count": payout.get("payment_count"),
            "method": payout.get("method"),
        },
    )

    save_store()
    return {"ok": True, "payout": payout}


@router.get("/admin/audit-log")
def admin_audit_log(limit: int = 100, user: dict = Depends(get_current_user)):
    _require_admin(user)
    items = [dict(item) for item in _AUDIT_LOGS.values() if isinstance(item, dict)]
    items.sort(
        key=lambda item: (str(item.get("created_at") or ""), int(item.get("id") or 0)),
        reverse=True,
    )
    return {"audit_log": items[: max(1, min(int(limit or 100), 500))]}


@router.get("/admin/dashboard")
def admin_dashboard(user: dict = Depends(get_current_user)):
    _require_admin(user)
    expire_reservations_if_needed()

    organizer_metrics = _organizer_metrics()

    stats = {
        "total_vendors": len(
            {
                str(a.get("vendor_email") or "").strip().lower()
                for a in _APPLICATIONS.values()
                if str(a.get("vendor_email") or "").strip()
            }
        ),
        "total_organizers": organizer_metrics["total_organizers"],
        "organizers_with_live_events": organizer_metrics["organizers_with_live_events"],
        "organizers_with_payouts_due": organizer_metrics["organizers_with_payouts_due"],
        "live_events": len(_EVENTS),
        "applications_submitted": len(_APPLICATIONS),
        "approved_awaiting_payment": sum(
            1
            for a in _APPLICATIONS.values()
            if str(a.get("status") or "").lower() == "approved"
            and str(a.get("payment_status") or "").lower() != "paid"
        ),
        "paid_applications": sum(
            1
            for a in _APPLICATIONS.values()
            if str(a.get("payment_status") or "").lower() == "paid"
        ),
        "pending_verifications": 0,
        "platform_revenue": get_payment_totals().get("platform_revenue", 0),
    }

    recent_payments: List[Dict[str, Any]] = []
    for payment in list(_PAYMENTS.values())[-5:]:
        if isinstance(payment, dict):
            recent_payments.append(dict(_ensure_payment_organizer_fields(payment)))

    recent_payments.sort(
        key=lambda p: str(p.get("paid_at") or p.get("created_at") or ""), reverse=True
    )

    return {
        "stats": stats,
        "recent_activity": [],
        "pending_verifications": [],
        "recent_payments": recent_payments,
    }


@router.get("/organizers/public/{organizer_email}/reviews")
def organizer_public_reviews(organizer_email: str):
    reviews = _find_public_organizer_reviews(organizer_email)
    summary = _review_summary(reviews)
    return {
        "reviews": reviews,
        "rating": summary["rating"],
        "review_count": summary["review_count"],
    }


@router.post("/organizers/public/{organizer_email}/reviews")
def create_organizer_review(
    organizer_email: str,
    body: ReviewCreateBody = Body(...),
    user: dict = Depends(get_current_user),
):
    reviewer_email = _norm_email(user.get("email"))
    if not reviewer_email:
        raise HTTPException(status_code=401, detail="Not authenticated")

    role = str(user.get("role") or "").strip().lower()
    if role not in {"vendor", "admin"}:
        raise HTTPException(
            status_code=403, detail="Only vendors can leave organizer reviews."
        )

    organizer_email = _norm_email(organizer_email)
    if not organizer_email:
        raise HTTPException(status_code=400, detail="Organizer email is required")

    rating = round(float(body.rating or 0), 1)
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5.")

    allowed, matched_app, matched_event = _can_vendor_review_organizer(
        organizer_email=organizer_email,
        reviewer_email=reviewer_email,
        event_id=body.event_id,
    )
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="You can only review organizers for events you were approved or paid for.",
        )

    event_id = int(body.event_id or matched_app.get("event_id") or 0)
    review_key = None
    for key, existing in _REVIEWS.items():
        if not isinstance(existing, dict):
            continue
        if (
            _norm_email(existing.get("organizer_email")) == organizer_email
            and _norm_email(existing.get("reviewer_email")) == reviewer_email
            and int(existing.get("event_id") or 0) == event_id
        ):
            review_key = key
            break

    record = {
        "id": int(review_key or _next_review_id()),
        "organizer_email": organizer_email,
        "reviewer_email": reviewer_email,
        "reviewer_name": _reviewer_display_name(user),
        "rating": rating,
        "comment": str(body.comment or "").strip(),
        "event_id": event_id or None,
        "event_title": (matched_event or {}).get("title"),
        "application_id": (matched_app or {}).get("id"),
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
    }

    _REVIEWS[str(record["id"])] = record
    _save_reviews()

    reviews = _find_public_organizer_reviews(organizer_email)
    summary = _review_summary(reviews)

    return {
        "ok": True,
        "review": record,
        "reviews": reviews,
        "rating": summary["rating"],
        "review_count": summary["review_count"],
    }
