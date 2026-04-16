from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Header, HTTPException, Request
from pydantic import BaseModel

try:
    from jose import jwt  # type: ignore
except Exception:
    jwt = None  # type: ignore

router = APIRouter(tags=["applications"])


# ---------------------------------------------------------------------------
# Shared auth decode import / fallback
# ---------------------------------------------------------------------------

try:
    from app.routers.auth import _decode_token as _shared_decode_token  # type: ignore
except Exception:
    _shared_decode_token = None  # type: ignore


# ---------------------------------------------------------------------------
# Live store module import / compatibility exports
# ---------------------------------------------------------------------------

try:
    import app.store as store  # type: ignore
except Exception:
    class _FallbackStore:
        _APPLICATIONS: Dict[Any, Dict[str, Any]] = {}
        _EVENTS: Dict[Any, Dict[str, Any]] = {}
        _PAYMENTS: Dict[Any, Dict[str, Any]] = {}

        @staticmethod
        def save_store() -> None:
            return None

    store = _FallbackStore()  # type: ignore


_APPLICATIONS = store._APPLICATIONS
_EVENTS = store._EVENTS
_PAYMENTS = store._PAYMENTS


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class BoothActionPayload(BaseModel):
    booth_id: Optional[str] = None
    hold_minutes: Optional[int] = 60 * 24


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_store() -> None:
    store.save_store()


def _applications_store() -> Dict[Any, Dict[str, Any]]:
    return store._APPLICATIONS


def _events_store() -> Dict[Any, Dict[str, Any]]:
    return store._EVENTS


def _payments_store() -> Dict[Any, Dict[str, Any]]:
    return store._PAYMENTS


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_id(value: Any) -> Optional[str]:
    text = _as_str(value)
    return text or None


def _extract_user_from_token(auth_header: Optional[str]) -> Dict[str, Any]:
    if not auth_header:
        return {}

    prefix = "Bearer "
    header_value = str(auth_header).strip()
    if not header_value.startswith(prefix):
        return {}

    token = header_value[len(prefix):].strip()
    if not token:
        return {}

    if _shared_decode_token is not None:
        try:
            payload = _shared_decode_token(token)
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    if jwt is None:
        return {}

    try:
        return jwt.decode(
            token,
            os.getenv("JWT_SECRET", "dev-secret"),
            algorithms=[os.getenv("JWT_ALG", "HS256")],
            options={"verify_aud": False},
        )
    except Exception:
        return {}


def _extract_vendor_email_from_user(user: Dict[str, Any]) -> str:
    return _as_str(
        user.get("email") or user.get("sub") or user.get("username")
    ).strip().lower()


def _extract_vendor_identity(user: Dict[str, Any]) -> tuple[Optional[str], str]:
    vendor_id = _normalize_id(user.get("vendor_id") or user.get("id") or user.get("sub"))
    vendor_email = _extract_vendor_email_from_user(user)
    return vendor_id, vendor_email


def _iter_dict_values(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, dict):
        out: List[Dict[str, Any]] = []
        for item in value.values():
            if isinstance(item, dict):
                out.append(item)
        return out
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _get_application_or_404(app_id: Any) -> Dict[str, Any]:
    key = _normalize_id(app_id)
    if not key:
        raise HTTPException(status_code=404, detail="Application not found")

    for stored_key, app in _applications_store().items():
        if _normalize_id(stored_key) == key:
            return app
        if isinstance(app, dict) and _normalize_id(app.get("id")) == key:
            return app

    raise HTTPException(status_code=404, detail="Application not found")


def _get_event_for_app(app: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    event_id = (
        app.get("event_id")
        or app.get("eventId")
        or app.get("event")
        or app.get("eventID")
    )
    event_key = _normalize_id(event_id)
    if not event_key:
        return None

    events = _events_store()
    event = events.get(event_key)
    if event is None and event_key.isdigit():
        event = events.get(int(event_key))
    return event if isinstance(event, dict) else None


def _booth_match_values(booth: Dict[str, Any]) -> set[str]:
    values: set[str] = set()
    keys = [
        "id",
        "booth_id",
        "boothId",
        "number",
        "label",
        "name",
        "code",
        "slug",
    ]
    for key in keys:
        raw = booth.get(key)
        text = _as_str(raw).lower()
        if text:
            values.add(text)
    return values


def _app_booth_candidates(app: Dict[str, Any]) -> set[str]:
    values: set[str] = set()
    keys = [
        "booth_id",
        "boothId",
        "assigned_booth_id",
        "assignedBoothId",
        "booth_number",
        "boothNumber",
        "booth_label",
        "boothLabel",
        "booth_name",
        "boothName",
        "selected_booth_id",
        "selectedBoothId",
    ]
    for key in keys:
        raw = app.get(key)
        text = _as_str(raw).lower()
        if text:
            values.add(text)
    booth = app.get("booth")
    if isinstance(booth, dict):
        values |= _booth_match_values(booth)
    return values


def _price_to_cents(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 1000 else value * 100 if value > 0 else None
    if isinstance(value, float):
        return int(round(value * 100)) if value > 0 else None
    if isinstance(value, str):
        text = value.strip().replace("$", "").replace(",", "")
        if not text:
            return None
        try:
            number = float(text)
        except Exception:
            return None
        return int(round(number * 100)) if number > 0 else None
    if isinstance(value, dict):
        for key in (
            "price_cents",
            "priceCents",
            "amount_cents",
            "amountCents",
            "price",
            "amount",
        ):
            cents = _price_to_cents(value.get(key))
            if cents:
                return cents
    return None


def _extract_booths_from_event(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    possible_roots = [
        event.get("booths"),
        event.get("booth_map"),
        event.get("boothMap"),
        event.get("layout"),
        event.get("diagram"),
        event.get("map"),
    ]
    for root in possible_roots:
        if isinstance(root, dict):
            for key in ("booths", "items", "nodes", "elements"):
                candidates.extend(_iter_dict_values(root.get(key)))
            candidates.extend(_iter_dict_values(root))
        elif isinstance(root, list):
            candidates.extend(_iter_dict_values(root))

    deduped: List[Dict[str, Any]] = []
    seen: set[int] = set()
    for booth in candidates:
        ident = id(booth)
        if ident not in seen:
            seen.add(ident)
            deduped.append(booth)
    return deduped




def _find_event_booth_category(app: Dict[str, Any]) -> Optional[str]:
    event = _get_event_for_app(app)
    if not event:
        return None

    booth_keys = _app_booth_candidates(app)
    if not booth_keys:
        return None

    booths = _extract_booths_from_event(event)
    for booth in booths:
        match_values = _booth_match_values(booth)
        if booth_keys and match_values and booth_keys.intersection(match_values):
            category = _as_str(
                booth.get("category")
                or booth.get("booth_category")
                or booth.get("category_name")
                or booth.get("categoryName")
            )
            if category:
                return category

    return None


def _persist_booth_category(app: Dict[str, Any]) -> Optional[str]:
    category = _find_event_booth_category(app)
    if category:
        app["booth_category"] = category
        app["requested_booth_category"] = category
    return category

def _find_event_booth_price_cents(app: Dict[str, Any]) -> Optional[int]:
    event = _get_event_for_app(app)
    if not event:
        return None

    booth_keys = _app_booth_candidates(app)
    booths = _extract_booths_from_event(event)

    for booth in booths:
        match_values = _booth_match_values(booth)
        if booth_keys and match_values and booth_keys.intersection(match_values):
            for key in (
                "price_cents",
                "priceCents",
                "amount_cents",
                "amountCents",
                "price",
                "amount",
            ):
                cents = _price_to_cents(booth.get(key))
                if cents:
                    return cents

    for root_key in ("payment_settings", "paymentSettings"):
        payment_settings = event.get(root_key)
        if isinstance(payment_settings, dict):
            for key in (
                "booth_price_cents",
                "boothPriceCents",
                "default_booth_price_cents",
                "defaultBoothPriceCents",
                "booth_price",
                "boothPrice",
            ):
                cents = _price_to_cents(payment_settings.get(key))
                if cents:
                    return cents

    return None


def _find_booth_price_cents_for_app(app: Dict[str, Any]) -> Optional[int]:
    for key in (
        "locked_price_cents",
        "lockedPriceCents",
        "price_cents",
        "priceCents",
        "amount_cents",
        "amountCents",
        "approved_price_cents",
        "approvedPriceCents",
        "booth_price_cents",
        "boothPriceCents",
        "reserved_booth_price_cents",
        "reservedBoothPriceCents",
    ):
        cents = _price_to_cents(app.get(key))
        if cents:
            return cents

    event_cents = _find_event_booth_price_cents(app)
    if event_cents:
        return event_cents

    return None


def _persist_resolved_booth_price(app: Dict[str, Any]) -> Optional[int]:
    cents = _find_booth_price_cents_for_app(app)
    if cents:
        app["resolved_price_cents"] = cents
        app["amount_cents"] = cents
        app.setdefault("price_cents", cents)
    return cents


def _slugify(value: Any) -> str:
    text = _as_str(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _pick_first_list(source: Any, keys: List[str]) -> List[Any]:
    if not isinstance(source, dict):
        return []
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            return value
    return []


def _normalize_docs_map(raw: Any) -> Dict[str, List[Any]]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, List[Any]] = {}
    for key, value in raw.items():
        key_text = _as_str(key)
        if not key_text or value is None:
            continue
        out[key_text] = value if isinstance(value, list) else [value]
    return out


def _normalize_bucket(raw: Any) -> Dict[str, List[Dict[str, Any]]]:
    if not isinstance(raw, dict):
        return {"compliance": [], "documents": []}
    compliance = _pick_first_list(raw, ["compliance", "compliance_items", "complianceItems"])
    documents = _pick_first_list(
        raw,
        ["documents", "document_requirements", "required_documents", "requiredDocuments"],
    )
    return {
        "compliance": [item for item in compliance if isinstance(item, dict)],
        "documents": [item for item in documents if isinstance(item, dict)],
    }


def _extract_requirement_root(event: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(event, dict):
        return {}
    raw = event.get("requirements")
    if isinstance(raw, dict) and isinstance(raw.get("requirements"), dict):
        return raw.get("requirements") or {}
    if isinstance(raw, dict):
        return raw
    return {}


def _extract_requirement_categories(req_root: Dict[str, Any]) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    source = req_root.get("categories") or req_root.get("categoryRequirements") or {}
    if not isinstance(source, dict):
        return {}
    out: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for key, value in source.items():
        out[_as_str(key)] = _normalize_bucket(value if isinstance(value, dict) else {})
    return out


def _dedupe_requirement_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for item in items:
        dedupe_key = _as_str(
            item.get("id")
            or item.get("key")
            or item.get("name")
            or item.get("title")
            or item.get("label")
            or item.get("text")
        ).lower()
        if dedupe_key and dedupe_key in seen:
            continue
        if dedupe_key:
            seen.add(dedupe_key)
        out.append(item)
    return out


def _item_key(item: Dict[str, Any], fallback: str) -> str:
    return _as_str(
        item.get("id")
        or item.get("key")
        or item.get("name")
        or item.get("title")
        or item.get("label")
        or item.get("text")
        or fallback
    )


def _resolve_selected_booth_category(
    app: Dict[str, Any],
    booth_categories: List[Any],
    categories_map: Dict[str, Dict[str, List[Dict[str, Any]]]],
) -> str:
    direct_candidates = [
        app.get("booth_category"),
        app.get("vendor_category"),
        app.get("category"),
        app.get("requested_booth_category"),
        app.get("selected_booth_category"),
    ]
    for candidate in direct_candidates:
        candidate_text = _as_str(candidate)
        if candidate_text:
            return candidate_text

    derived = _find_event_booth_category(app)
    if derived:
        return derived

    selected_booth_id = _normalize_id(app.get("booth_id") or app.get("requested_booth_id") or "")
    if selected_booth_id:
        for item in booth_categories:
            if not isinstance(item, dict):
                continue
            item_id = _as_str(item.get("id") or item.get("booth_id") or item.get("value") or item.get("code"))
            if item_id and item_id == selected_booth_id:
                return _as_str(item.get("name") or item.get("label") or item.get("title") or item.get("category"))

    category_keys = [key for key in categories_map.keys() if _as_str(key)]
    if len(category_keys) == 1:
        return category_keys[0]

    return ""


def _resolve_category_bucket(
    categories: Dict[str, Dict[str, List[Dict[str, Any]]]],
    selected_category: str,
) -> Dict[str, Any]:
    if not selected_category:
        return {"name": "", "bucket": {"compliance": [], "documents": []}}

    for key in categories.keys():
        if key.lower() == selected_category.lower():
            return {"name": key, "bucket": categories[key]}

    selected_slug = _slugify(selected_category)
    for key in categories.keys():
        if _slugify(key) == selected_slug:
            return {"name": key, "bucket": categories[key]}

    return {"name": selected_category, "bucket": {"compliance": [], "documents": []}}


def _compute_requirement_status(app: Dict[str, Any]) -> Dict[str, Any]:
    event = _get_event_for_app(app)
    req_root = _extract_requirement_root(event)

    booth_categories = _pick_first_list(req_root, ["booth_categories", "boothCategories"])
    global_bucket = _normalize_bucket(req_root.get("global") or req_root.get("globalRequirements") or req_root)
    categories_map = _extract_requirement_categories(req_root)

    selected_category = _resolve_selected_booth_category(app, booth_categories, categories_map)
    matched_category = _resolve_category_bucket(categories_map, selected_category)

    compliance_items = _dedupe_requirement_items(
        list(global_bucket.get("compliance") or []) + list(matched_category["bucket"].get("compliance") or [])
    )
    document_items = _dedupe_requirement_items(
        list(global_bucket.get("documents") or []) + list(matched_category["bucket"].get("documents") or [])
    )

    checked_map = app.get("checked") if isinstance(app.get("checked"), dict) else {}
    docs_map = _normalize_docs_map(app.get("documents") or app.get("docs"))

    completed_compliance_count = 0
    for idx, item in enumerate(compliance_items, start=1):
        key = _item_key(item, f"compliance_{idx}")
        if bool(checked_map.get(key)):
            completed_compliance_count += 1

    uploaded_document_count = 0
    for idx, item in enumerate(document_items, start=1):
        key = _item_key(item, f"document_{idx}")
        if len(docs_map.get(key) or []) > 0:
            uploaded_document_count += 1

    booth_selected = bool(_normalize_id(app.get("booth_id") or app.get("requested_booth_id")))

    total_items = len(compliance_items) + len(document_items) + 1
    completed_items = completed_compliance_count + uploaded_document_count + (1 if booth_selected else 0)

    compliance_complete = completed_compliance_count >= len(compliance_items)
    documents_complete = uploaded_document_count >= len(document_items)
    requirements_complete = booth_selected and compliance_complete and documents_complete
    progress_percent = int(round((completed_items / max(total_items, 1)) * 100))

    return {
        "booth_selected": booth_selected,
        "compliance_complete": compliance_complete,
        "documents_complete": documents_complete,
        "requirements_complete": requirements_complete,
        "progress_percent": max(0, min(100, progress_percent)),
        "requirements_total_items": total_items,
        "requirements_completed_items": completed_items,
        "requirements_category": matched_category.get("name") or selected_category or "",
    }



def _serialize_application(app: Dict[str, Any]) -> Dict[str, Any]:
    cents = _persist_resolved_booth_price(app)
    booth_price = round(cents / 100, 2) if cents else None

    enriched = dict(app)
    if cents:
        enriched["resolved_price_cents"] = cents
        enriched["amount_cents"] = cents
        enriched["total_cents"] = cents
        enriched["booth_price_cents"] = enriched.get("booth_price_cents") or cents
        enriched["booth_price"] = booth_price
        enriched["amount_due"] = booth_price
        enriched["total_price"] = booth_price

    return enriched


def _get_amount_cents_from_app(app: Dict[str, Any]) -> int:
    cents = _persist_resolved_booth_price(app)
    if not cents:
        raise HTTPException(
            status_code=400,
            detail="Could not determine booth price for this application.",
        )
    return int(cents)


def _payment_exists_for_application(app_id: str) -> bool:
    target = _normalize_id(app_id)
    if not target:
        return False

    for payment in _iter_dict_values(_payments_store()):
        pid = _normalize_id(payment.get("application_id") or payment.get("applicationId"))
        if pid == target and _as_str(payment.get("status")).lower() == "paid":
            return True

    return False


def _current_status(app: Dict[str, Any]) -> str:
    return _as_str(app.get("status")).lower()


def _is_locked_for_vendor_edits(app: Dict[str, Any]) -> bool:
    return _current_status(app) in {"submitted", "approved", "paid"}


def _create_payment_record(
    app: Dict[str, Any],
    amount: int,
    source: str,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    payment_id = str(int(time.time() * 1000))
    app_id = _normalize_id(app.get("id")) or payment_id

    event = _get_event_for_app(app) or {}
    event_id = _normalize_id(event.get("id") or app.get("event_id") or app.get("eventId"))
    event_title = event.get("title") or event.get("name") or "Untitled event"

    vendor_name = (
        app.get("vendor_name")
        or app.get("business_name")
        or app.get("company_name")
        or app.get("name")
        or app.get("vendor_email")
        or "Unknown vendor"
    )
    vendor_email = app.get("vendor_email") or "unknown@email.com"

    organizer_name = (
        event.get("organizer_name")
        or event.get("company_name")
        or event.get("host_name")
        or event.get("email")
        or "Unknown organizer"
    )
    organizer_email = event.get("organizer_email") or event.get("email") or "unknown@email.com"
    organizer_id = event.get("organizer_id") or event.get("owner_id") or event.get("created_by")

    booth_id = app.get("booth_id") or app.get("selected_booth_id") or app.get("requested_booth_id")
    booth_label = app.get("booth_label") or app.get("booth_number") or booth_id

    amount_cents = int(amount)
    amount_dollars = round(amount_cents / 100, 2)
    platform_fee_cents = int(amount_cents * 0.10)
    platform_fee = round(platform_fee_cents / 100, 2)
    organizer_payout = round((amount_cents - platform_fee_cents) / 100, 2)

    record = {
        "id": payment_id,
        "application_id": app_id,
        "event_id": event_id,
        "event_title": event_title,
        "vendor_name": vendor_name,
        "vendor_email": vendor_email,
        "organizer_name": organizer_name,
        "organizer_email": organizer_email,
        "organizer_id": organizer_id,
        "booth_id": booth_id,
        "booth_label": booth_label,
        "amount_cents": amount_cents,
        "amount": amount_dollars,
        "platform_fee": platform_fee,
        "organizer_payout": organizer_payout,
        "session_id": session_id,
        "source": source,
        "status": "paid",
        "created_at": _now_iso(),
        "paid_at": _now_iso(),
    }

    _payments_store()[payment_id] = record
    _save_store()
    return record


def _mark_application_paid(
    app: Dict[str, Any],
    amount: int,
    user: Any = None,
    source: str = "manual",
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    app["payment_status"] = "paid"
    app["status"] = app.get("status") or "approved"
    app["paid_at"] = _now_iso()
    app["amount_cents"] = int(amount)
    app["resolved_price_cents"] = int(amount)

    if user is not None:
        app["paid_by"] = user
    if source:
        app["payment_source"] = source
    if session_id:
        app["stripe_session_id"] = session_id

    normalized_app_id = _normalize_id(app.get("id")) or ""
    if not _payment_exists_for_application(normalized_app_id):
        _create_payment_record(app, amount, source=source, session_id=session_id)

    _save_store()
    return app


def _get_frontend_base_url() -> str:
    candidates = [
        os.getenv("FRONTEND_BASE_URL"),
        os.getenv("APP_BASE_URL"),
        os.getenv("PUBLIC_APP_URL"),
        os.getenv("VITE_PUBLIC_APP_URL"),
        os.getenv("VITE_FRONTEND_URL"),
    ]
    for value in candidates:
        text = _as_str(value)
        if text:
            return text.rstrip("/")
    return "http://localhost:5173"


def expire_reservations_if_needed() -> int:
    now_ts = time.time()
    expired_count = 0

    for app in _iter_dict_values(_applications_store()):
        expires_at = app.get("reservation_expires_at")
        if not expires_at:
            continue

        try:
            expires_ts = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).timestamp()
        except Exception:
            continue

        if expires_ts > now_ts:
            continue

        app.pop("reservation_expires_at", None)

        payment_status = _as_str(app.get("payment_status")).lower()
        if payment_status != "paid":
            app["payment_status"] = "expired"

        status = _as_str(app.get("status")).lower()
        if status in {"approved", "reserved", "pending_payment"}:
            app["status"] = "expired"

        expired_count += 1

    if expired_count:
        _save_store()

    return expired_count


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/vendor/applications")
def list_vendor_applications(authorization: Optional[str] = Header(default=None)) -> List[Dict[str, Any]]:
    expire_reservations_if_needed()

    user = _extract_user_from_token(authorization)
    vendor_id, vendor_email = _extract_vendor_identity(user)

    if not vendor_id and not vendor_email:
        return []

    filtered_apps: List[Dict[str, Any]] = []

    for app in _iter_dict_values(_applications_store()):
        try:
            if app.get("archived") is True:
                continue

            app_vendor_id = _normalize_id(
                app.get("vendor_id") or app.get("vendorId") or app.get("user_id") or app.get("userId")
            )
            app_vendor_email = _as_str(app.get("vendor_email")).lower()

            matches_vendor = False
            if vendor_id and app_vendor_id and app_vendor_id == vendor_id:
                matches_vendor = True
            elif vendor_email and app_vendor_email and app_vendor_email == vendor_email:
                matches_vendor = True

            if not matches_vendor:
                continue

            serialized = _serialize_application(app)

            if not serialized.get("event_id"):
                fallback_event_id = (
                    app.get("event_id")
                    or app.get("eventId")
                    or app.get("event")
                    or app.get("eventID")
                )
                if fallback_event_id is not None:
                    serialized["event_id"] = fallback_event_id

            filtered_apps.append(serialized)
        except Exception as e:
            print("Skipping bad application record:", e)
            continue

    return filtered_apps


@router.get("/vendor/applications/{app_id}")
def get_vendor_application(app_id: str) -> Dict[str, Any]:
    expire_reservations_if_needed()
    app = _get_application_or_404(app_id)
    return _serialize_application(app)


@router.patch("/vendor/applications/{app_id}")
def vendor_update_application(app_id: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    expire_reservations_if_needed()

    app = _get_application_or_404(app_id)

    if _is_locked_for_vendor_edits(app):
        raise HTTPException(status_code=400, detail="Application is locked and cannot be modified.")

    booth_id = _as_str(payload.get("booth_id"))
    booth_category = _as_str(
        payload.get("booth_category")
        or payload.get("requested_booth_category")
        or payload.get("category")
    )
    if booth_id:
        app["requested_booth_id"] = booth_id
        app["booth_id"] = booth_id

    if booth_category:
        app["booth_category"] = booth_category
        app["requested_booth_category"] = booth_category

    if booth_id and not booth_category:
        _persist_booth_category(app)

    if "checked" in payload and isinstance(payload.get("checked"), dict):
        app["checked"] = payload["checked"]

    if "notes" in payload:
        app["notes"] = payload.get("notes") or ""

    if "documents" in payload and isinstance(payload.get("documents"), dict):
        app["documents"] = payload["documents"]
        app["docs"] = payload["documents"]

    if "docs" in payload and isinstance(payload.get("docs"), dict):
        app["documents"] = payload["docs"]
        app["docs"] = payload["docs"]

    booth_price = payload.get("booth_price")
    if booth_price is not None:
        cents = _price_to_cents(booth_price)
        if cents:
            app["booth_price_cents"] = cents
            app["amount_cents"] = cents
            app["resolved_price_cents"] = cents

    vendor_name = _as_str(payload.get("vendor_name"))
    vendor_email = _as_str(payload.get("vendor_email"))
    if vendor_name:
        app["vendor_name"] = vendor_name
    if vendor_email:
        app["vendor_email"] = vendor_email

    if app.get("booth_id") and not app.get("booth_category"):
        _persist_booth_category(app)

    requirement_status = _compute_requirement_status(app)
    app["booth_selected"] = requirement_status["booth_selected"]
    app["compliance_complete"] = requirement_status["compliance_complete"]
    app["documents_complete"] = requirement_status["documents_complete"]
    app["requirements_complete"] = requirement_status["requirements_complete"]
    app["progress_percent"] = requirement_status["progress_percent"]

    app["updated_at"] = _now_iso()
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.put("/vendor/applications/{app_id}/progress")
def vendor_update_application_progress(app_id: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    return vendor_update_application(app_id, payload)


@router.post("/vendor/applications/{app_id}/submit")
def vendor_submit_application(app_id: str) -> Dict[str, Any]:
    expire_reservations_if_needed()

    app = _get_application_or_404(app_id)
    status = _current_status(app)

    if status not in {"", "draft"}:
        raise HTTPException(status_code=400, detail="Application already submitted.")

    booth_id = _normalize_id(app.get("booth_id") or app.get("requested_booth_id"))
    if not booth_id:
        raise HTTPException(status_code=400, detail="You must select a booth before submitting.")

    _persist_booth_category(app)

    requirement_status = _compute_requirement_status(app)
    if not requirement_status.get("requirements_complete"):
        raise HTTPException(
            status_code=400,
            detail="Application requirements incomplete. Select a booth, complete all compliance items, and upload all required documents before submitting.",
        )

    app["booth_selected"] = requirement_status["booth_selected"]
    app["compliance_complete"] = requirement_status["compliance_complete"]
    app["documents_complete"] = requirement_status["documents_complete"]
    app["requirements_complete"] = requirement_status["requirements_complete"]
    app["progress_percent"] = requirement_status["progress_percent"]
    app["status"] = "submitted"
    app["submitted_at"] = _now_iso()
    app["updated_at"] = _now_iso()

    cents = _persist_resolved_booth_price(app)
    if cents:
        app["booth_price"] = round(cents / 100, 2)

    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.post("/vendor/applications/{app_id}/pay-now")
def vendor_pay_now(app_id: str) -> Dict[str, Any]:
    expire_reservations_if_needed()

    app = _get_application_or_404(app_id)

    if _current_status(app) != "approved":
        raise HTTPException(status_code=400, detail="Payment is only available after organizer approval.")

    amount_cents = _get_amount_cents_from_app(app)

    secret_key = _as_str(os.getenv("STRIPE_SECRET_KEY"))
    if not secret_key:
        raise HTTPException(status_code=500, detail="Stripe not configured: missing STRIPE_SECRET_KEY")

    try:
        import stripe  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stripe not configured: {exc}")

    stripe.api_key = secret_key

    app_id_str = _normalize_id(app.get("id")) or _normalize_id(app_id) or ""
    frontend = _get_frontend_base_url()
    success_url = f"{frontend}/vendor/payment-success?appId={app_id_str}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{frontend}/vendor/payment-cancel?appId={app_id_str}"

    session = stripe.checkout.Session.create(
        mode="payment",
        client_reference_id=str(app_id_str),
        metadata={"application_id": str(app_id_str)},
        payment_intent_data={"metadata": {"application_id": str(app_id_str)}},
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(amount_cents),
                    "product_data": {"name": f"Booth fee for application {app_id_str}"},
                },
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
    )

    session_id = _as_str(getattr(session, "id", None) or session["id"])
    session_url = _as_str(getattr(session, "url", None) or session["url"])

    app["checkout_session_id"] = session_id
    app["checkout_created_at"] = _now_iso()
    app["checkout_amount_cents"] = int(amount_cents)
    _save_store()

    return {
        "ok": True,
        "checkout_url": session_url,
        "checkoutUrl": session_url,
        "url": session_url,
        "session_url": session_url,
        "session_id": session_id,
        "amount_cents": int(amount_cents),
    }


@router.post("/vendor/applications")
def create_vendor_application(
    payload: Dict[str, Any] = Body(default_factory=dict),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    event_id = _normalize_id(payload.get("event_id") or payload.get("eventId"))
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id is required")

    user = _extract_user_from_token(authorization)
    vendor_id, vendor_email = _extract_vendor_identity(user)

    for app in _iter_dict_values(_applications_store()):
        existing_event_id = _normalize_id(app.get("event_id") or app.get("eventId"))
        if existing_event_id != event_id:
            continue

        app_vendor_id = _normalize_id(app.get("vendor_id"))
        app_vendor_email = _as_str(app.get("vendor_email")).lower()

        same_vendor = False
        if vendor_id and app_vendor_id and app_vendor_id == vendor_id:
            same_vendor = True
        elif vendor_email and app_vendor_email and app_vendor_email == vendor_email:
            same_vendor = True

        if not same_vendor:
            continue

        if _current_status(app) in {"", "draft"}:
            _persist_resolved_booth_price(app)
            if app.get("resolved_price_cents"):
                app["booth_price"] = round(app["resolved_price_cents"] / 100, 2)
            return {"ok": True, "application": _serialize_application(app)}

    new_id = str(int(time.time() * 1000))
    app = {
        "id": new_id,
        "event_id": int(event_id) if str(event_id).isdigit() else event_id,
        "vendor_id": vendor_id,
        "vendor_email": vendor_email or None,
        "status": "draft",
        "payment_status": "unpaid",
        "checked": payload.get("checked") if isinstance(payload.get("checked"), dict) else {},
        "notes": payload.get("notes") or "",
        "documents": payload.get("documents") if isinstance(payload.get("documents"), dict) else {},
        "docs": payload.get("docs") if isinstance(payload.get("docs"), dict) else {},
        "requested_booth_id": payload.get("booth_id") or None,
        "booth_id": payload.get("booth_id") or None,
        "booth_category": payload.get("booth_category") or payload.get("requested_booth_category") or None,
        "requested_booth_category": payload.get("booth_category") or payload.get("requested_booth_category") or None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "archived": False,
    }

    booth_price = payload.get("booth_price")
    if booth_price is not None:
        cents = _price_to_cents(booth_price)
        if cents:
            app["booth_price_cents"] = cents
            app["amount_cents"] = cents
            app["resolved_price_cents"] = cents
            app["booth_price"] = round(cents / 100, 2)

    if app.get("booth_id") and not app.get("booth_category"):
        _persist_booth_category(app)

    _applications_store()[new_id] = app
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request) -> Dict[str, Any]:
    secret_key = _as_str(os.getenv("STRIPE_SECRET_KEY"))
    webhook_secret = _as_str(os.getenv("STRIPE_WEBHOOK_SECRET"))
    if not secret_key:
        raise HTTPException(status_code=500, detail="Missing STRIPE_SECRET_KEY")
    if not webhook_secret:
        raise HTTPException(status_code=500, detail="Missing STRIPE_WEBHOOK_SECRET")

    try:
        import stripe  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stripe not configured: {exc}")

    stripe.api_key = secret_key

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=webhook_secret,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid webhook: {exc}")

    etype = str(event["type"]).strip()
    data_obj = event["data"]["object"]

    if etype == "checkout.session.completed":
        session_id = _as_str(data_obj["id"])
        session = stripe.checkout.Session.retrieve(session_id)

        app_id: Optional[str] = None
        metadata = getattr(session, "metadata", None)
        if metadata and "application_id" in metadata:
            app_id = _normalize_id(metadata["application_id"])

        if not app_id:
            app_id = _normalize_id(getattr(session, "client_reference_id", None))

        if not app_id:
            payment_intent_id = getattr(session, "payment_intent", None)
            if payment_intent_id:
                payment_intent = stripe.PaymentIntent.retrieve(payment_intent_id)
                pi_metadata = getattr(payment_intent, "metadata", None)
                if pi_metadata and "application_id" in pi_metadata:
                    app_id = _normalize_id(pi_metadata["application_id"])

        if not app_id:
            return {"ok": True, "ignored": "missing application_id"}

        app = _applications_store().get(app_id)
        if app is None and app_id.isdigit():
            app = _applications_store().get(int(app_id))

        if app is None:
            return {"ok": True, "ignored": f"application {app_id} not found"}

        if _as_str(app.get("payment_status")).lower() == "paid" or _payment_exists_for_application(app_id):
            return {"ok": True, "already_paid": True}

        expected_amount = _get_amount_cents_from_app(app)
        amount_total = getattr(session, "amount_total", None)
        amount_paid = getattr(session, "amount_subtotal", None) or amount_total
        stripe_amount = int(amount_total or amount_paid or 0)

        if stripe_amount and expected_amount and stripe_amount != expected_amount:
            return {
                "ok": False,
                "detail": "Stripe amount mismatch",
                "expected_amount_cents": expected_amount,
                "stripe_amount_cents": stripe_amount,
            }

        _mark_application_paid(
            app,
            stripe_amount or expected_amount,
            user=None,
            source="stripe_webhook",
            session_id=session_id,
        )
        return {"ok": True}

    return {"ok": True, "ignored": etype}


@router.post("/organizer/applications/{app_id}/reserve-booth")
def organizer_reserve_booth(
    app_id: str,
    payload: BoothActionPayload = Body(default_factory=BoothActionPayload),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    if payload.booth_id:
        app["booth_id"] = payload.booth_id
        app["requested_booth_id"] = payload.booth_id
        _persist_booth_category(app)
    app["status"] = "approved"
    app["payment_status"] = app.get("payment_status") or "unpaid"
    minutes = payload.hold_minutes or 60 * 24
    app["reservation_expires_at"] = datetime.fromtimestamp(
        time.time() + minutes * 60,
        tz=timezone.utc,
    ).isoformat()
    _persist_resolved_booth_price(app)
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.post("/organizer/applications/{app_id}/change-booth")
def organizer_change_booth(
    app_id: str,
    payload: BoothActionPayload = Body(default_factory=BoothActionPayload),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    if not payload.booth_id:
        raise HTTPException(status_code=400, detail="booth_id is required")
    app["booth_id"] = payload.booth_id
    app["requested_booth_id"] = payload.booth_id
    _persist_booth_category(app)
    _persist_resolved_booth_price(app)
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.post("/organizer/applications/{app_id}/extend-reservation")
def organizer_extend_reservation(
    app_id: str,
    payload: BoothActionPayload = Body(default_factory=BoothActionPayload),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    minutes = payload.hold_minutes or 60 * 24
    current_expires = app.get("reservation_expires_at")
    base_ts = time.time()
    if current_expires:
        try:
            base_ts = max(
                base_ts,
                datetime.fromisoformat(str(current_expires).replace("Z", "+00:00")).timestamp(),
            )
        except Exception:
            pass
    app["reservation_expires_at"] = datetime.fromtimestamp(
        base_ts + minutes * 60,
        tz=timezone.utc,
    ).isoformat()
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.post("/organizer/applications/{app_id}/release-reservation")
def organizer_release_reservation(app_id: str) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    app.pop("reservation_expires_at", None)
    app.pop("booth_id", None)
    _save_store()
    return {"ok": True, "application": _serialize_application(app)}


@router.get("/admin/payments")
def list_admin_payments() -> List[Dict[str, Any]]:
    return _iter_dict_values(_payments_store())


@router.get("/organizer/activity")
def organizer_activity() -> Dict[str, Any]:
    return {
        "applications": len(_iter_dict_values(_applications_store())),
        "payments": len(_iter_dict_values(_payments_store())),
        "events": len(_iter_dict_values(_events_store())),
    }


@router.get("/health/applications-router")
def applications_router_health() -> Dict[str, Any]:
    return {"ok": True, "router": "applications"}


@router.get("/organizer/events/{event_id}/applications")
def organizer_list_applications(event_id: str) -> Dict[str, Any]:
    expire_reservations_if_needed()

    event_id_str = str(event_id)
    apps = []
    for app in _iter_dict_values(_applications_store()):
        aid = _normalize_id(app.get("event_id") or app.get("eventId"))
        if aid != event_id_str:
            continue

        serialized = _serialize_application(app)
        enriched = {
            **serialized,
            "id": app.get("id"),
            "event_id": event_id_str,
            "status": app.get("status"),
            "payment_status": app.get("payment_status"),
            "booth_id": app.get("booth_id"),
            "requested_booth_id": app.get("requested_booth_id"),
            "booth_category": app.get("booth_category") or app.get("requested_booth_category"),
            "vendor_id": app.get("vendor_id"),
            "vendor_email": app.get("vendor_email"),
            "vendor_name": app.get("vendor_name"),
            "updated_at": app.get("updated_at") or app.get("submitted_at"),
            "amount_due": serialized.get("amount_due"),
            "booth_price": serialized.get("booth_price"),
            "amount_cents": serialized.get("amount_cents"),
            "resolved_price_cents": serialized.get("resolved_price_cents"),
            "total_cents": serialized.get("total_cents"),
        }
        apps.append(enriched)

    return {"applications": apps}


@router.get("/organizer/events/{event_id}/applications/{app_id}")
def organizer_get_application(event_id: str, app_id: str) -> Dict[str, Any]:
    expire_reservations_if_needed()

    app = _get_application_or_404(app_id)
    app_event_id = _normalize_id(app.get("event_id") or app.get("eventId"))
    if app_event_id != str(event_id):
        raise HTTPException(status_code=404, detail="Application not found for this event")

    return _serialize_application(app)


@router.post("/organizer/applications/{app_id}/approve")
def organizer_approve_application(app_id: str) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    app["status"] = "approved"
    _save_store()
    return _serialize_application(app)


@router.post("/organizer/applications/{app_id}/reject")
def organizer_reject_application(app_id: str) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    app["status"] = "rejected"
    _save_store()
    return _serialize_application(app)


@router.post("/vendor/applications/{app_id}/confirm-payment")
def vendor_confirm_payment(
    app_id: str,
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)

    normalized_app_id = _normalize_id(app.get("id")) or _normalize_id(app_id) or ""

    if _as_str(app.get("payment_status")).lower() == "paid":
        if not _payment_exists_for_application(normalized_app_id):
            amount = _get_amount_cents_from_app(app)
            _create_payment_record(
                app,
                amount=amount,
                source="confirm_payment_repair",
                session_id=_as_str(app.get("stripe_session_id")) or _as_str(app.get("checkout_session_id")),
            )
            _save_store()
        return {"ok": True, "already_paid": True, "application": _serialize_application(app)}

    if _payment_exists_for_application(normalized_app_id):
        app["payment_status"] = "paid"
        _save_store()
        return {"ok": True, "already_paid": True, "application": _serialize_application(app)}

    session_id = (
        _as_str(payload.get("session_id"))
        or _as_str(request.query_params.get("session_id"))
        or _as_str(app.get("checkout_session_id"))
        or _as_str(app.get("stripe_session_id"))
    )
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    secret_key = _as_str(os.getenv("STRIPE_SECRET_KEY"))
    if not secret_key:
        raise HTTPException(status_code=500, detail="Missing STRIPE_SECRET_KEY")

    try:
        import stripe  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stripe not configured: {exc}")

    stripe.api_key = secret_key

    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as exc:
        if "rate limit" in str(exc).lower():
            return {"ok": False, "pending_retry": True, "detail": "Stripe rate limit hit. Retry in a moment."}
        raise HTTPException(status_code=400, detail=f"Unable to retrieve Stripe session: {exc}")

    payment_status = _as_str(getattr(session, "payment_status", None) or session.get("payment_status"))
    status_value = _as_str(getattr(session, "status", None) or session.get("status"))

    if payment_status != "paid" and status_value != "complete":
        raise HTTPException(status_code=400, detail="Stripe session is not paid")

    expected_amount = _get_amount_cents_from_app(app)
    amount_total = getattr(session, "amount_total", None) or session.get("amount_total") or 0
    stripe_amount = int(amount_total or expected_amount)

    _mark_application_paid(
        app,
        stripe_amount,
        user=None,
        source="confirm_payment",
        session_id=session_id,
    )
    _save_store()

    return {"ok": True, "application": _serialize_application(app)}
@router.delete("/vendor/applications/{app_id}")
def delete_vendor_application(
    app_id: str,
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    user = _extract_user_from_token(authorization)
    vendor_id, vendor_email = _extract_vendor_identity(user)

    app = _get_application_or_404(app_id)

    app_vendor_id = _normalize_id(
        app.get("vendor_id") or app.get("vendorId") or app.get("user_id") or app.get("userId")
    )
    app_vendor_email = _as_str(app.get("vendor_email")).lower()

    matches_vendor = False
    if vendor_id and app_vendor_id and app_vendor_id == vendor_id:
        matches_vendor = True
    elif vendor_email and app_vendor_email and app_vendor_email == vendor_email:
        matches_vendor = True

    if not matches_vendor:
        raise HTTPException(status_code=403, detail="Not authorized")

    status = _current_status(app)
    app_key = _normalize_id(app.get("id")) or _normalize_id(app_id)

    if status in {"approved", "paid"}:
        app["archived"] = True
    else:
        if app_key and app_key in _applications_store():
            _applications_store().pop(app_key, None)
        elif app_key and app_key.isdigit():
            _applications_store().pop(int(app_key), None)

    _save_store()
    return {"ok": True}
