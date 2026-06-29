from __future__ import annotations

# VENDCORE_BOOTH_PRICE_MATCH_BY_LABEL_FIX_2026_06_05

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
 

from fastapi import APIRouter, Body, Header, HTTPException, Request, Depends
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

try:
    from app.routers.auth import _USERS, _USERS_BY_EMAIL  # type: ignore
except Exception:
    _USERS = {}  # type: ignore
    _USERS_BY_EMAIL = {}  # type: ignore


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


def _db_session_or_none():
    """Open a short-lived SQLAlchemy session when available.

    The application router still stores application records in the file/runtime
    store, but events and diagrams are now saved in Postgres. These helpers let
    the application serializer resolve booth/category/price from the same
    Postgres rows the map endpoint serves, instead of the empty _DIAGRAMS store.
    """
    try:
        from app.db import SessionLocal  # type: ignore
    except Exception:
        return None
    try:
        return SessionLocal()
    except Exception:
        return None


def _event_id_from_app(app: Dict[str, Any]) -> Optional[int]:
    raw = (
        app.get("event_id")
        or app.get("eventId")
        or app.get("event")
        or app.get("eventID")
    )
    text = _normalize_id(raw)
    if not text:
        return None
    try:
        return int(text)
    except Exception:
        return None


def _row_to_event_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    payload: Dict[str, Any] = {}
    for key in (
        "id", "title", "description", "venue_name", "street_address", "city",
        "state", "zip_code", "category", "organizer_email", "owner_email",
        "organizer_id", "owner_id", "created_by", "published", "archived",
        "requirements_published", "layout_published", "stripe_connect_account_id",
        "stripe_account_id", "organizer_stripe_account_id",
    ):
        if hasattr(row, key):
            value = getattr(row, key)
            if value is not None:
                payload[key] = value
    # Optional JSON-ish columns used by some deployments.
    for key in ("requirements", "data", "settings", "metadata", "extra", "payment_settings", "paymentSettings"):
        if hasattr(row, key):
            value = getattr(row, key)
            if isinstance(value, dict):
                payload[key] = value
    return payload


def _get_event_from_postgres(event_id: Any) -> Optional[Dict[str, Any]]:
    try:
        eid = int(event_id)
    except Exception:
        return None
    db = _db_session_or_none()
    if db is None:
        return None
    try:
        from app.models.event import Event  # type: ignore
        row = db.query(Event).filter(Event.id == int(eid)).first()
        payload = _row_to_event_dict(row)
        return payload or None
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass


def _get_diagram_from_postgres(event_id: Any) -> Optional[Dict[str, Any]]:
    try:
        eid = int(event_id)
    except Exception:
        return None
    db = _db_session_or_none()
    if db is None:
        return None
    try:
        from app.models.diagram import Diagram  # type: ignore
        row = (
            db.query(Diagram)
            .filter(Diagram.event_id == int(eid))
            .order_by(Diagram.id.desc())
            .first()
        )
        if not row:
            return None
        diagram = getattr(row, "diagram", None)
        if isinstance(diagram, dict):
            return {"diagram": diagram, "version": int(getattr(row, "version", 0) or 0)}
        return None
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass

try:
    from app.routers.verifications import get_vendor_doc_vault  # type: ignore
except Exception:
    def get_vendor_doc_vault(email: str, include_expired: bool = False):  # type: ignore
        return []


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


def _lookup_billing_user(*, user_id: Any = None, email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if user_id not in (None, ""):
        try:
            found = _USERS.get(int(user_id))
            if isinstance(found, dict):
                return found
        except Exception:
            pass

    normalized_email = str(email or "").strip().lower()
    if normalized_email:
        try:
            matched_user_id = _USERS_BY_EMAIL.get(normalized_email)
            if matched_user_id is not None:
                found = _USERS.get(int(matched_user_id))
                if isinstance(found, dict):
                    return found
        except Exception:
            pass

        for candidate in getattr(_USERS, "values", lambda: [])():
            if isinstance(candidate, dict) and str(candidate.get("email") or "").strip().lower() == normalized_email:
                return candidate

    return None


def _is_active_paid_subscription(user: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(user, dict):
        return False
    plan = str(user.get("plan") or "starter").strip().lower()
    status = str(user.get("subscription_status") or "inactive").strip().lower()
    return plan in {"pro_vendor", "enterprise_organizer"} and status in {"active", "trialing", "paid"}


def _get_organizer_user_for_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    organizer_id = (
        event.get("organizer_id")
        or event.get("owner_id")
        or event.get("created_by")
    )
    organizer_email = (
        event.get("organizer_email")
        or event.get("owner_email")
        or event.get("email")
    )
    return _lookup_billing_user(user_id=organizer_id, email=str(organizer_email or ""))


def _get_organizer_platform_fee_percent(event: Dict[str, Any]) -> float:
    organizer_user = _get_organizer_user_for_event(event)
    if _is_active_paid_subscription(organizer_user):
        return 0.03

    plan = str(
        event.get("subscription_plan")
        or event.get("plan")
        or event.get("organizer_plan")
        or ""
    ).strip().lower()
    status = str(
        event.get("subscription_status")
        or event.get("organizer_subscription_status")
        or ""
    ).strip().lower()

    if plan in {"pro_vendor", "enterprise_organizer", "pro", "paid", "premium", "plus"} and status in {"active", "trialing", "paid", ""}:
        return 0.03

    return 0.05


def _get_organizer_stripe_connect_account_id(event: Dict[str, Any]) -> str:
    direct = str(
        event.get("stripe_connect_account_id")
        or event.get("stripe_account_id")
        or event.get("organizer_stripe_account_id")
        or ""
    ).strip()
    if direct:
        return direct

    organizer_user = _get_organizer_user_for_event(event)
    if not isinstance(organizer_user, dict):
        return ""

    return str(
        organizer_user.get("stripe_connect_account_id")
        or organizer_user.get("stripe_account_id")
        or ""
    ).strip()


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_id(value: Any) -> Optional[str]:
    text = _as_str(value)
    return text or None


def _looks_like_generated_booth_id(value: Any) -> bool:
    text = _as_str(value)
    return bool(re.match(r"^booth_[a-f0-9]+_", text, flags=re.IGNORECASE))


def _human_booth_value_from_object(value: Any) -> str:
    """Return a vendor-facing booth label from a booth object.

    The map can send both old/stale app fields and the newly selected booth
    object in the same request. Object label/number/name values represent the
    actual click the vendor just made, so they must beat stale requested_booth_id.
    """
    if not isinstance(value, dict):
        return ""

    meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}
    for source in (value, meta):
        for key in (
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
        ):
            text = _as_str(source.get(key))
            if text and not _looks_like_generated_booth_id(text):
                return text

    # Use the object id only when it is already human-readable. Generated canvas
    # ids are saved separately as selected_booth_id / booth_canvas_id.
    for key in ("id", "booth_id", "boothId", "value"):
        text = _as_str(value.get(key))
        if text and not _looks_like_generated_booth_id(text):
            return text

    return ""


def _first_booth_value(payload: Dict[str, Any]) -> str:
    """Pick the safest human-facing booth value from a request payload.

    Important: when a vendor clicks a new booth, the request can still carry old
    application fields like requested_booth_id=A2. Prefer the newly selected
    booth object/label first so Booth 6 cannot snap back to A2.
    """
    if not isinstance(payload, dict):
        return ""

    for key in (
        "selected_booth",
        "selectedBooth",
        "primary_booth",
        "primaryBooth",
        "requested_booth",
        "requestedBooth",
        "booth",
    ):
        text = _human_booth_value_from_object(payload.get(key))
        if text:
            return text

    # New/current selection labels win over old saved requested_booth_id.
    for key in (
        "selected_booth_label",
        "selectedBoothLabel",
        "selected_booth_number",
        "selectedBoothNumber",
        "selected_booth_name",
        "selectedBoothName",
        "primary_booth_label",
        "primaryBoothLabel",
        "primary_booth_number",
        "primaryBoothNumber",
        "booth_label",
        "boothLabel",
        "booth_number",
        "boothNumber",
        "booth_name",
        "boothName",
        "requested_booth_label",
        "requestedBoothLabel",
        "requested_booth_number",
        "requestedBoothNumber",
        "requested_booth_name",
        "requestedBoothName",
        "requested_booth_id",
        "requestedBoothId",
        "booth_id",
        "boothId",
        "selected_booth_id",
        "selectedBoothId",
    ):
        value = _as_str(payload.get(key))
        if not value:
            continue
        if _looks_like_generated_booth_id(value):
            continue
        return value

    return ""

def _first_raw_booth_selection_value(payload: Dict[str, Any]) -> str:
    """Return any saved booth-selection signal, including internal canvas ids.

    This is used only for validation/completion. Display-facing booth fields
    should continue using _first_booth_value so generated canvas ids are not
    shown to vendors as the booth name.
    """
    if not isinstance(payload, dict):
        return ""

    for key in (
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
        "selected_booth_id",
        "selectedBoothId",
        "booth_canvas_id",
        "boothCanvasId",
        "booth_label",
        "boothLabel",
        "booth_number",
        "boothNumber",
        "booth_name",
        "boothName",
    ):
        value = _as_str(payload.get(key))
        if value:
            return value

    booth = payload.get("booth")
    if isinstance(booth, dict):
        value = _as_str(
            booth.get("id")
            or booth.get("booth_id")
            or booth.get("boothId")
            or booth.get("label")
            or booth.get("name")
        )
        if value:
            return value

    selected_booth = payload.get("selected_booth") or payload.get("selectedBooth")
    if isinstance(selected_booth, dict):
        value = _as_str(
            selected_booth.get("id")
            or selected_booth.get("booth_id")
            or selected_booth.get("boothId")
            or selected_booth.get("label")
            or selected_booth.get("name")
        )
        if value:
            return value

    return ""


def _has_booth_selection(app: Dict[str, Any]) -> bool:
    """True when the application has any real booth/map/category selection.

    The UI can currently save the selected booth as:
    - human booth_id / requested_booth_id
    - internal selected_booth_id / booth_canvas_id
    - selected booth category when a booth is category-driven

    Older submit/completion checks only accepted booth_id/requested_booth_id,
    which caused the app to show a booth and price but still block submission.
    """
    if not isinstance(app, dict):
        return False

    if _first_raw_booth_selection_value(app):
        return True

    category = _as_str(
        app.get("booth_category")
        or app.get("requested_booth_category")
        or app.get("selected_booth_category")
        or app.get("selectedBoothCategory")
        or app.get("category")
    )
    if _is_useful_category(category):
        return True

    return False


def _selected_booth_object(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    for key in ("selected_booth", "selectedBooth", "primary_booth", "primaryBooth", "requested_booth", "requestedBooth", "booth"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return {}


def _price_from_selected_booth_payload(payload: Dict[str, Any]) -> Optional[int]:
    """Read the price from the newly selected booth object/payload first."""
    booth_obj = _selected_booth_object(payload)
    meta = booth_obj.get("meta") if isinstance(booth_obj.get("meta"), dict) else {}
    for source in (booth_obj, meta, payload):
        if not isinstance(source, dict):
            continue
        for key in (
            "price_cents",
            "priceCents",
            "amount_cents",
            "amountCents",
            "booth_price_cents",
            "boothPriceCents",
            "selected_booth_price_cents",
            "selectedBoothPriceCents",
            "price",
            "amount",
            "booth_price",
            "boothPrice",
            "selected_booth_price",
            "selectedBoothPrice",
            "total_due",
            "totalDue",
            "amount_due",
            "amountDue",
        ):
            cents = _price_to_cents(source.get(key))
            if cents:
                return cents
    return None


def _category_from_selected_booth_payload(payload: Dict[str, Any]) -> str:
    booth_obj = _selected_booth_object(payload)
    meta = booth_obj.get("meta") if isinstance(booth_obj.get("meta"), dict) else {}
    for source in (booth_obj, meta, payload):
        if not isinstance(source, dict):
            continue
        for key in (
            "category",
            "booth_category",
            "boothCategory",
            "requested_booth_category",
            "requestedBoothCategory",
            "category_name",
            "categoryName",
            "category_label",
            "categoryLabel",
            "vendor_category",
            "vendorCategory",
        ):
            text = _as_str(source.get(key))
            if _is_useful_category(text):
                return text
    return ""


def _clear_stale_price_fields(app: Dict[str, Any]) -> None:
    for key in (
        "checkout_amount_cents",
        "locked_price_cents",
        "approved_price_cents",
        "booth_price_cents",
        "amount_cents",
        "resolved_price_cents",
        "price_cents",
        "total_cents",
        "booth_price",
        "amount_due",
        "total_price",
        "checkout_url",
        "checkoutUrl",
        "payment_url",
        "session_url",
        "sessionUrl",
        "checkout_session_id",
    ):
        app.pop(key, None)


def _lookup_booth_record_for_payload(app: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    """Find the selected booth in the live event diagram using any safe signal.

    The vendor map sends both a human label (for display) and a generated canvas
    id (for exact map lookup). Earlier code discarded generated ids too early,
    so category survived but booth_id/price were lost and the app fell back to
    $100. Generated ids are valid for lookup; they are only invalid for display.
    """
    if not isinstance(app, dict):
        return {}

    candidates: set[str] = set()

    def add(value: Any) -> None:
        text = _as_str(value).lower()
        if text:
            candidates.add(text)

    for source in (payload, app):
        if not isinstance(source, dict):
            continue
        for key in (
            "selected_booth_id", "selectedBoothId", "booth_canvas_id", "boothCanvasId",
            "booth_id", "boothId", "requested_booth_id", "requestedBoothId",
            "booth_label", "boothLabel", "booth_number", "boothNumber",
            "booth_name", "boothName", "selected_booth_label", "selectedBoothLabel",
            "selected_booth_number", "selectedBoothNumber", "selected_booth_name",
            "selectedBoothName",
        ):
            add(source.get(key))

    for key in ("selected_booth", "selectedBooth", "primary_booth", "primaryBooth", "requested_booth", "requestedBooth", "booth"):
        booth_obj = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(booth_obj, dict):
            meta = booth_obj.get("meta") if isinstance(booth_obj.get("meta"), dict) else {}
            for source in (booth_obj, meta):
                for field in ("id", "booth_id", "boothId", "label", "number", "name", "code", "booth_label", "booth_number", "booth_name"):
                    add(source.get(field))

    if not candidates:
        return {}

    diagram_booths = _extract_booths_from_diagram(_get_diagram_for_event(app))
    event = _get_event_for_app(app)
    event_booths = _extract_booths_from_event(event) if isinstance(event, dict) else []

    for booth in [*diagram_booths, *event_booths]:
        if not isinstance(booth, dict):
            continue
        booth_values = _booth_match_values(booth)
        if candidates.intersection(booth_values):
            return booth

    return {}


def _booth_human_label_from_record(booth: Dict[str, Any]) -> str:
    if not isinstance(booth, dict):
        return ""
    return _human_booth_value_from_object(booth)


def _booth_category_from_record_for_save(booth: Dict[str, Any]) -> str:
    if not isinstance(booth, dict):
        return ""
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    for source in (booth, meta):
        for key in (
            "category", "booth_category", "boothCategory", "category_name",
            "categoryName", "category_label", "categoryLabel",
            "vendor_category", "vendorCategory",
        ):
            text = _as_str(source.get(key))
            if _is_useful_category(text):
                return text
    return ""


def _booth_price_cents_from_record_for_save(booth: Dict[str, Any]) -> Optional[int]:
    if not isinstance(booth, dict):
        return None
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    for source in (booth, meta):
        for key in (
            "price_cents", "priceCents", "amount_cents", "amountCents",
            "booth_price_cents", "boothPriceCents", "price", "amount",
            "booth_price", "boothPrice",
        ):
            cents = _price_to_cents(source.get(key))
            if cents:
                return cents
    return None


def _persist_price_cents(app: Dict[str, Any], cents: int) -> None:
    cents = int(cents)
    app["booth_price_cents"] = cents
    app["amount_cents"] = cents
    app["resolved_price_cents"] = cents
    app["price_cents"] = cents
    app["total_cents"] = cents
    app["booth_price"] = round(cents / 100, 2)
    app["amount_due"] = round(cents / 100, 2)
    app["total_price"] = round(cents / 100, 2)


def _apply_booth_payload(app: Dict[str, Any], payload: Dict[str, Any]) -> str:
    """Persist the current vendor booth request exactly once and completely.

    Generated canvas ids are kept for lookup only. Human-facing booth fields are
    resolved from the selected booth record so Booth 6 remains Booth 6 instead
    of disappearing or falling back to $100.
    """
    if not isinstance(app, dict):
        return ""

    selected_booth_record = _lookup_booth_record_for_payload(app, payload)

    booth_value = _first_booth_value(payload)
    if not booth_value and selected_booth_record:
        booth_value = _booth_human_label_from_record(selected_booth_record)

    internal_booth_id = _as_str(
        payload.get("selected_booth_id")
        or payload.get("selectedBoothId")
        or payload.get("booth_canvas_id")
        or payload.get("boothCanvasId")
    )
    if not internal_booth_id:
        booth_obj = _selected_booth_object(payload)
        internal_booth_id = _as_str(booth_obj.get("id") or booth_obj.get("booth_id") or booth_obj.get("boothId"))
    if not internal_booth_id and selected_booth_record:
        internal_booth_id = _as_str(selected_booth_record.get("id") or selected_booth_record.get("booth_id") or selected_booth_record.get("boothId"))

    # Last resort: never let a real booth request become "No booth selected".
    # If we cannot resolve the label, store the raw id as requested_booth_id so
    # the app remains linkable and price/category resolution can still work.
    if not booth_value and internal_booth_id:
        booth_value = internal_booth_id

    booth_changed = False
    current_human_booth = _as_str(
        app.get("booth_id")
        or app.get("requested_booth_id")
        or app.get("booth_label")
        or app.get("booth_number")
    )

    if booth_value:
        if booth_value != current_human_booth:
            booth_changed = True
        app["booth_id"] = booth_value
        app["requested_booth_id"] = booth_value
        app["booth_label"] = booth_value
        app["booth_number"] = booth_value
        app["booth_name"] = booth_value

    if internal_booth_id:
        if internal_booth_id != _as_str(app.get("selected_booth_id") or app.get("booth_canvas_id")):
            booth_changed = True
        app["selected_booth_id"] = internal_booth_id
        app["booth_canvas_id"] = internal_booth_id

    if booth_changed:
        _clear_stale_price_fields(app)

    booth_category = _category_from_selected_booth_payload(payload)
    if not booth_category and selected_booth_record:
        booth_category = _booth_category_from_record_for_save(selected_booth_record)
    if booth_category:
        app["booth_category"] = booth_category
        app["requested_booth_category"] = booth_category
        app["selected_booth_category"] = booth_category
        app["category"] = booth_category

    explicit_cents = _price_from_selected_booth_payload(payload)
    if not explicit_cents and selected_booth_record:
        explicit_cents = _booth_price_cents_from_record_for_save(selected_booth_record)

    if explicit_cents:
        _persist_price_cents(app, int(explicit_cents))
    elif booth_changed:
        _persist_booth_category(app)
        _persist_resolved_booth_price(app)

    if (booth_value or internal_booth_id) and not booth_category:
        _persist_booth_category(app)

    return booth_value


def _normalize_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [_as_str(item) for item in value if _as_str(item)]
    if isinstance(value, str):
        text = _as_str(value)
        return [text] if text else []
    return []


def _is_useful_category(value: Any) -> bool:
    text = _as_str(value)
    normalized = text.lower()
    return bool(text and normalized not in {"uncategorized", "booth", "general", "default"})


def _vendor_profile_category_fallback(app: Dict[str, Any]) -> str:
    """Return the vendor's saved profile category when the application is missing it.

    Draft applications can be created by a generic get-or-create call before the
    booth/map payload arrives. In that case app.vendor_category is often blank,
    and older code fell back to General. That made Food vendors lose their two
    category requirements and pushed the app back to the stale $100 default.
    """
    candidates = [
        _as_str(app.get("vendor_email")).lower(),
        _as_str(app.get("email")).lower(),
        _as_str(app.get("vendor_id")).lower(),
        _as_str(app.get("vendorId")).lower(),
    ]

    vendors = getattr(store, "_VENDORS", {})
    if not isinstance(vendors, dict):
        return ""

    for key in candidates:
        if not key:
            continue
        profile = vendors.get(key)
        if not isinstance(profile, dict):
            continue

        direct = _as_str(
            profile.get("vendor_category")
            or profile.get("category")
            or profile.get("business_category")
            or profile.get("business_type")
        )
        if _is_useful_category(direct):
            return direct

        for field in ("vendor_categories", "categories", "business_categories"):
            for category in _normalize_string_list(profile.get(field)):
                if _is_useful_category(category):
                    return category

    return ""


def _app_vendor_category_fallback(app: Dict[str, Any]) -> str:
    direct = _as_str(app.get("vendor_category") or app.get("category"))
    if _is_useful_category(direct):
        return direct

    categories = _normalize_string_list(app.get("vendor_categories"))
    for category in categories:
        if _is_useful_category(category):
            return category

    profile_category = _vendor_profile_category_fallback(app)
    if _is_useful_category(profile_category):
        app["vendor_category"] = profile_category
        if not isinstance(app.get("vendor_categories"), list) or not app.get("vendor_categories"):
            app["vendor_categories"] = [profile_category]
        return profile_category

    return ""


def _first_vendor_category(payload: Dict[str, Any]) -> str:
    direct = _as_str(payload.get("vendor_category"))
    if direct:
        return direct
    categories = _normalize_string_list(payload.get("vendor_categories"))
    return categories[0] if categories else ""


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

    # Postgres is the source of truth for events. Fall back to the legacy store
    # only for old deployments that have not migrated yet.
    postgres_event = _get_event_from_postgres(event_key)
    if isinstance(postgres_event, dict) and postgres_event:
        return postgres_event

    events = _events_store()
    event = events.get(event_key)
    if event is None and event_key.isdigit():
        event = events.get(int(event_key))
    return event if isinstance(event, dict) else None


def _get_diagram_for_event(app: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    event_id = (
        app.get("event_id")
        or app.get("eventId")
        or app.get("event")
        or app.get("eventID")
    )
    event_key = _normalize_id(event_id)
    if not event_key:
        return None

    # Postgres is the source of truth for diagrams. The old _DIAGRAMS store can
    # be empty on Railway restarts and must not be the first lookup.
    postgres_diagram = _get_diagram_from_postgres(event_key)
    if isinstance(postgres_diagram, dict) and postgres_diagram:
        return postgres_diagram

    diagrams = getattr(store, "_DIAGRAMS", {})
    diagram = diagrams.get(event_key)
    if diagram is None and event_key.isdigit():
        diagram = diagrams.get(int(event_key))
    return diagram if isinstance(diagram, dict) else None


def _normalize_booth_lookup_value(value: Any) -> str:
    text = _as_str(value).lower()
    if not text:
        return ""
    text = text.replace("#", " ")
    text = re.sub(r"\bbooth\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


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
    meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
    for source in (booth, meta):
        for key in keys:
            raw = source.get(key)
            text = _as_str(raw).lower()
            if text:
                values.add(text)
            normalized = _normalize_booth_lookup_value(raw)
            if normalized:
                values.add(normalized)
    return values


def _human_booth_candidates_from_app(app: Dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in (
        "booth_label",
        "boothLabel",
        "booth_number",
        "boothNumber",
        "booth_name",
        "boothName",
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
    ):
        raw = app.get(key)
        text = _as_str(raw)
        if not text or _looks_like_generated_booth_id(text):
            continue
        values.add(text.lower())
        normalized = _normalize_booth_lookup_value(text)
        if normalized:
            values.add(normalized)
    booth = app.get("selected_booth") or app.get("selectedBooth") or app.get("booth")
    if isinstance(booth, dict):
        text = _human_booth_value_from_object(booth)
        if text:
            values.add(text.lower())
            normalized = _normalize_booth_lookup_value(text)
            if normalized:
                values.add(normalized)
    return values


def _internal_booth_candidates_from_app(app: Dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for key in (
        "selected_booth_id",
        "selectedBoothId",
        "booth_canvas_id",
        "boothCanvasId",
        "assigned_booth_id",
        "assignedBoothId",
    ):
        text = _as_str(app.get(key)).lower()
        if text:
            values.add(text)
    return values


def _app_booth_candidates(app: Dict[str, Any]) -> set[str]:
    values: set[str] = set()
    keys = [
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
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
        "booth_canvas_id",
        "boothCanvasId",
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
            for key in ("booths", "items", "nodes", "elements", "levels"):
                value = root.get(key)
                if key == "levels" and isinstance(value, list):
                    for level in value:
                        if isinstance(level, dict):
                            candidates.extend(_iter_dict_values(level.get("booths")))
                else:
                    candidates.extend(_iter_dict_values(value))
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


def _extract_booths_from_diagram(diagram: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(diagram, dict):
        return []

    root = diagram.get("diagram") if isinstance(diagram.get("diagram"), dict) else diagram
    candidates: List[Dict[str, Any]] = []

    for key in ("booths", "items", "nodes", "elements"):
        candidates.extend(_iter_dict_values(root.get(key)))

    levels = root.get("levels")
    if isinstance(levels, list):
        for level in levels:
            if not isinstance(level, dict):
                continue
            candidates.extend(_iter_dict_values(level.get("booths")))
            candidates.extend(_iter_dict_values(level.get("items")))
            candidates.extend(_iter_dict_values(level.get("nodes")))

    deduped: List[Dict[str, Any]] = []
    seen: set[int] = set()
    for booth in candidates:
        ident = id(booth)
        if ident not in seen:
            seen.add(ident)
            deduped.append(booth)
    return deduped




def _find_event_booth_category(app: Dict[str, Any]) -> Optional[str]:
    """Resolve booth category from the exact booth selection.

    Important regression guard:
    human booth labels ("Booth 6", "A2") and generated canvas ids
    ("booth_46d7...") are both valid lookup signals, but they must not be
    collapsed into one value. Older logic compared the human label only against
    booth.id, so category resolution failed and downstream requirement/price
    logic fell back to General/$100.
    """
    if not isinstance(app, dict):
        return None

    human_candidates = _human_booth_candidates_from_app(app)
    internal_candidates = _internal_booth_candidates_from_app(app)

    if not human_candidates and not internal_candidates:
        return None

    diagram = _get_diagram_for_event(app)
    event = _get_event_for_app(app)
    booths = _extract_booths_from_diagram(diagram)
    if isinstance(event, dict):
        booths.extend(_extract_booths_from_event(event))

    def category_from_booth(booth: Dict[str, Any]) -> str:
        category = _booth_category_from_record_for_save(booth)
        return category if _is_useful_category(category) else ""

    # Human-facing labels/numbers win first. This keeps Booth 6 from matching
    # the wrong booth solely because another booth shares a category/default.
    if human_candidates:
        for booth in booths:
            if not isinstance(booth, dict):
                continue
            booth_values = _booth_match_values(booth)
            if human_candidates.intersection(booth_values):
                category = category_from_booth(booth)
                if category:
                    return category

        # A human booth was selected, but the map did not contain a matching
        # label. Do not fall through to loose/category-only matching here; that
        # is how the app drifted back to General or another booth category.
        return None

    # Generated canvas ids are valid only as an internal lookup fallback when no
    # human label is available. They should never replace booth_id for display.
    if internal_candidates:
        for booth in booths:
            if not isinstance(booth, dict):
                continue
            booth_values = _booth_match_values(booth)
            if internal_candidates.intersection(booth_values):
                category = category_from_booth(booth)
                if category:
                    return category

    return None


def _persist_booth_category(app: Dict[str, Any]) -> Optional[str]:
    """Persist a real category without inventing General.

    General was the source of the regression: it counted as a selected booth,
    skipped real category requirements, and let the default $100 price win.
    """
    category = _find_event_booth_category(app)

    if not _is_useful_category(category):
        existing = _as_str(app.get("booth_category") or app.get("requested_booth_category"))
        if _is_useful_category(existing):
            category = existing

    if not _is_useful_category(category):
        category = _app_vendor_category_fallback(app)

    if not _is_useful_category(category):
        return None

    app["booth_category"] = category
    app["requested_booth_category"] = category
    return category

def _find_event_booth_price_cents(app: Dict[str, Any]) -> Optional[int]:
    """Resolve price from the exact selected booth, not the booth category.

    Regression guard: Booth 6 and A2 can both be category=Other. A category
    fallback caused Booth 6 to inherit A2's $150 price. Human-facing booth
    label/number must win first; stale generated canvas ids are only used when
    no human label exists. Category defaults are only safe when no booth was
    selected at all.
    """
    selected_category = _as_str(
        app.get("booth_category")
        or app.get("requested_booth_category")
        or app.get("selected_booth_category")
        or app.get("vendor_category")
        or app.get("category")
    ).lower()

    event = _get_event_for_app(app)
    diagram = _get_diagram_for_event(app)

    def booth_price(booth: Dict[str, Any]) -> Optional[int]:
        meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
        for source in (booth, meta):
            for key in (
                "price_cents",
                "priceCents",
                "amount_cents",
                "amountCents",
                "booth_price_cents",
                "boothPriceCents",
                "price",
                "amount",
                "booth_price",
                "boothPrice",
            ):
                cents = _price_to_cents(source.get(key))
                if cents:
                    return cents
        return None

    def booth_category(booth: Dict[str, Any]) -> str:
        meta = booth.get("meta") if isinstance(booth.get("meta"), dict) else {}
        return _as_str(
            booth.get("category")
            or booth.get("booth_category")
            or booth.get("category_name")
            or booth.get("categoryName")
            or booth.get("category_label")
            or booth.get("categoryLabel")
            or booth.get("vendor_category")
            or booth.get("vendorCategory")
            or meta.get("category")
            or meta.get("booth_category")
            or meta.get("categoryName")
        ).lower()

    diagram_booths = _extract_booths_from_diagram(diagram)
    event_booths = _extract_booths_from_event(event) if isinstance(event, dict) else []
    all_booths = diagram_booths + event_booths

    human_candidates = _human_booth_candidates_from_app(app)
    internal_candidates = _internal_booth_candidates_from_app(app)

    # 1) Exact human label/number match. "Booth 6" also matches "6".
    if human_candidates:
        for booth in all_booths:
            if human_candidates & _booth_match_values(booth):
                cents = booth_price(booth)
                if cents:
                    return cents

        # A human booth was selected but no exact map match was found. Do NOT
        # fall through to category matching, because that is how Booth 6 became
        # A2/$150. Let explicit saved payload cents win instead.
        return None

    # 2) Internal generated canvas id only when no human label is available.
    if internal_candidates:
        for booth in all_booths:
            if internal_candidates & _booth_match_values(booth):
                cents = booth_price(booth)
                if cents:
                    return cents
        return None

    # 3) Category fallback only for category-only flows with no booth selected.
    if selected_category:
        for booth in all_booths:
            category = booth_category(booth)
            if category and category == selected_category:
                cents = booth_price(booth)
                if cents:
                    return cents

    if isinstance(event, dict):
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


def _app_has_precise_booth_reference(app: Dict[str, Any]) -> bool:
    for key in (
        "booth_id",
        "boothId",
        "requested_booth_id",
        "requestedBoothId",
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
        "booth_canvas_id",
        "boothCanvasId",
    ):
        if _as_str(app.get(key)):
            return True
    return False


def _find_booth_price_cents_for_app(app: Dict[str, Any]) -> Optional[int]:
    """Resolve booth price without letting stale $100 defaults beat the map.

    Rules:
    - Paid/locked apps preserve the paid amount.
    - If a real booth id/label/canvas id exists, the current event diagram/map
      price wins over old saved serializer values.
    - If only a vendor/category is known, category map price may be used.
    - Saved $100 amount_due/total_price is a last resort only, not a source of
      truth for draft/submitted/approved apps.
    """
    status = _as_str(app.get("status")).lower()
    payment_status = _as_str(app.get("payment_status")).lower()

    if status in {"paid"} or payment_status in {"paid"}:
        for key in (
            "checkout_amount_cents",
            "checkoutAmountCents",
            "locked_price_cents",
            "lockedPriceCents",
            "approved_price_cents",
            "approvedPriceCents",
            "paid_amount_cents",
            "paidAmountCents",
            "amount_cents",
            "amountCents",
        ):
            cents = _price_to_cents(app.get(key))
            if cents:
                return cents

    has_precise_booth = _app_has_precise_booth_reference(app)
    useful_category = _is_useful_category(
        app.get("booth_category")
        or app.get("requested_booth_category")
        or app.get("vendor_category")
        or app.get("category")
    )

    if has_precise_booth or useful_category:
        event_cents = _find_event_booth_price_cents(app)
        if event_cents:
            return event_cents

    # Use explicit booth-specific saved cents only after the live map/category
    # lookup fails. Do not use generic amount_cents first; that field is where
    # the stale $100 value was repeatedly reintroduced.
    for key in (
        "booth_price_cents",
        "boothPriceCents",
        "reserved_booth_price_cents",
        "reservedBoothPriceCents",
        "selected_booth_price_cents",
        "selectedBoothPriceCents",
    ):
        cents = _price_to_cents(app.get(key))
        if cents:
            return cents

    for key in (
        "booth_price",
        "boothPrice",
        "selected_booth_price",
        "selectedBoothPrice",
        "reserved_booth_price",
        "reservedBoothPrice",
    ):
        cents = _price_to_cents(app.get(key))
        if cents:
            return cents

    # Generic amount fields are valid only if there is a real booth/category.
    if has_precise_booth or useful_category:
        for key in (
            "resolved_price_cents",
            "resolvedPriceCents",
            "price_cents",
            "priceCents",
            "amount_cents",
            "amountCents",
            "amount_due",
            "amountDue",
            "total_due",
            "totalDue",
            "total_price",
            "totalPrice",
            "price",
            "amount",
        ):
            cents = _price_to_cents(app.get(key))
            if cents:
                return cents

    return None


def _persist_resolved_booth_price(app: Dict[str, Any]) -> Optional[int]:
    cents = _find_booth_price_cents_for_app(app)
    if cents:
        app["resolved_price_cents"] = int(cents)
        app["amount_cents"] = int(cents)
        app["price_cents"] = int(cents)
        app["booth_price_cents"] = int(cents)
        app["booth_price"] = round(int(cents) / 100, 2)
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


def _merge_requirement_roots(*roots: Dict[str, Any]) -> Dict[str, Any]:
    """Merge requirement payloads saved in old and new shapes."""
    merged: Dict[str, Any] = {"global": {"compliance": [], "documents": []}, "categories": {}}

    def add_bucket(target: Dict[str, Any], raw: Any) -> None:
        bucket = _normalize_bucket(raw if isinstance(raw, dict) else {})
        target.setdefault("compliance", [])
        target.setdefault("documents", [])
        target["compliance"].extend(bucket.get("compliance") or [])
        target["documents"].extend(bucket.get("documents") or [])

    for raw_root in roots:
        if not isinstance(raw_root, dict):
            continue
        root = raw_root.get("requirements") if isinstance(raw_root.get("requirements"), dict) else raw_root
        if not isinstance(root, dict):
            continue

        global_target = merged["global"]
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
            add_bucket(global_target, root.get(key))

        # Root-level compliance/documents are also event-wide requirements, but
        # category maps are not.
        add_bucket(global_target, root)

        category_source = (
            root.get("categories")
            or root.get("categoryRequirements")
            or root.get("category_requirements")
            or {}
        )
        if isinstance(category_source, dict):
            for category_name, bucket_raw in category_source.items():
                category_key = _as_str(category_name)
                if not category_key:
                    continue
                target = merged["categories"].setdefault(category_key, {"compliance": [], "documents": []})
                add_bucket(target, bucket_raw)

    merged["global"]["compliance"] = _dedupe_requirement_items(merged["global"].get("compliance") or [])
    merged["global"]["documents"] = _dedupe_requirement_items(merged["global"].get("documents") or [])
    for bucket in merged["categories"].values():
        bucket["compliance"] = _dedupe_requirement_items(bucket.get("compliance") or [])
        bucket["documents"] = _dedupe_requirement_items(bucket.get("documents") or [])
    return merged


def _store_requirement_payload_for_event(event_id: Any) -> Dict[str, Any]:
    requirements_store = getattr(store, "_REQUIREMENTS", {})
    event_key = _normalize_id(event_id)
    if not event_key:
        return {}

    if isinstance(requirements_store, dict):
        candidates = [event_key]
        if event_key.isdigit():
            candidates.append(int(event_key))
        for key in candidates:
            value = requirements_store.get(key)
            if isinstance(value, dict):
                return value

    # Fallback for deployments that have requirements embedded in a SQL event
    # JSON/data/settings column. Event model in the current app does not require
    # those columns, so this is intentionally best-effort.
    pg_event = _get_event_from_postgres(event_key)
    if isinstance(pg_event, dict):
        for key in (
            "requirements",
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
            value = pg_event.get(key)
            if isinstance(value, dict):
                return {key: value} if key != "requirements" else value
    return {}


def _extract_requirement_root(event: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(event, dict):
        return {}

    event_id = event.get("id") or event.get("event_id") or event.get("eventId")
    roots: List[Dict[str, Any]] = []

    store_req = _store_requirement_payload_for_event(event_id)
    if isinstance(store_req, dict) and store_req:
        roots.append(store_req)

    raw = event.get("requirements")
    if isinstance(raw, dict):
        roots.append(raw)

    for key in (
        "global",
        "globalRequirements",
        "global_requirements",
        "eventWideRequirements",
        "event_wide_requirements",
        "allVendorRequirements",
        "all_vendor_requirements",
        "appliesToAllVendors",
        "applies_to_all_vendors",
        "categories",
        "categoryRequirements",
        "category_requirements",
    ):
        if isinstance(event.get(key), (dict, list)):
            roots.append({key: event.get(key)})

    return _merge_requirement_roots(*roots)

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
        app.get("requested_booth_category"),
        app.get("selected_booth_category"),
        app.get("selectedBoothCategory"),
        app.get("category"),
    ]
    for candidate in direct_candidates:
        candidate_text = _as_str(candidate)
        if _is_useful_category(candidate_text):
            return candidate_text

    derived = _find_event_booth_category(app)
    if _is_useful_category(derived):
        return str(derived)

    selected_booth_id = _normalize_id(
        app.get("booth_id")
        or app.get("requested_booth_id")
        or app.get("selected_booth_id")
        or app.get("selectedBoothId")
        or app.get("booth_canvas_id")
        or ""
    )
    if selected_booth_id:
        for item in booth_categories:
            if not isinstance(item, dict):
                continue
            item_id = _as_str(item.get("id") or item.get("booth_id") or item.get("value") or item.get("code"))
            if item_id and item_id == selected_booth_id:
                category = _as_str(item.get("category") or item.get("name") or item.get("label") or item.get("title"))
                if _is_useful_category(category):
                    return category

    category_keys = [key for key in categories_map.keys() if _as_str(key)]
    if len(category_keys) == 1:
        return category_keys[0]

    fallback = _app_vendor_category_fallback(app)
    return fallback if _is_useful_category(fallback) else ""


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



def _normalize_document_entry(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_document_entry(item) for item in value if item is not None]
    if not isinstance(value, dict):
        return value

    normalized = dict(value)

    secure_url = _as_str(
        normalized.get("secure_url")
        or normalized.get("url")
        or normalized.get("href")
        or normalized.get("path")
        or normalized.get("dataUrl")
    )
    if secure_url:
        normalized["url"] = secure_url
        normalized["href"] = secure_url

    public_id = _as_str(normalized.get("public_id") or normalized.get("provider_public_id"))
    if public_id:
        normalized["public_id"] = public_id

    provider = _as_str(normalized.get("provider"))
    if provider:
        normalized["provider"] = provider

    return normalized


def _normalize_documents_payload(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        key_text = _as_str(key)
        if not key_text:
            continue

        normalized = _normalize_document_entry(value)

        if isinstance(normalized, list):
            out[key_text] = normalized[0] if normalized else {}
        else:
            out[key_text] = normalized

    return out



def _normalize_document_requests(raw: Any) -> List[Dict[str, Any]]:
    """Normalize organizer-requested document records stored on an application.

    These are manual, application-specific requests that sit on top of the
    automatic event requirements engine. They let an organizer request an
    updated/special document without breaking reusable vault documents.
    """
    if not isinstance(raw, list):
        return []

    normalized: List[Dict[str, Any]] = []

    for item in raw:
        if not isinstance(item, dict):
            continue

        uploaded_document = item.get("uploaded_document")
        uploaded_payload = (
            _normalize_document_entry(uploaded_document)
            if isinstance(uploaded_document, dict)
            else None
        )

        status = _as_str(item.get("status") or "requested").lower()
        if status not in {"requested", "fulfilled", "dismissed", "rejected"}:
            status = "requested"

        normalized.append(
            {
                "id": _as_str(item.get("id") or str(int(time.time() * 1000))),
                "document_key": _as_str(item.get("document_key") or item.get("key")),
                "document_label": _as_str(item.get("document_label") or item.get("label") or item.get("name")),
                "status": status,
                "requested_by": _as_str(item.get("requested_by") or "organizer"),
                "request_note": _as_str(item.get("request_note") or item.get("note") or item.get("message")),
                "due_date": _as_str(item.get("due_date") or item.get("dueBy") or item.get("due_by")),
                "created_at": _as_str(item.get("created_at") or _now_iso()),
                "fulfilled_at": _as_str(item.get("fulfilled_at")),
                "uploaded_document": uploaded_payload,
            }
        )

    return normalized


def _build_document_request_key(label: Any, fallback: str = "requested_document") -> str:
    key = _slugify(label)
    return key or fallback


def _append_application_notification(app: Dict[str, Any], notification: Dict[str, Any]) -> None:
    existing = app.get("notifications")
    if not isinstance(existing, list):
        existing = []
        app["notifications"] = existing

    existing.append(
        {
            "id": _as_str(notification.get("id") or str(int(time.time() * 1000))),
            "type": _as_str(notification.get("type") or "info"),
            "message": _as_str(notification.get("message")),
            "created_at": _as_str(notification.get("created_at") or _now_iso()),
            "read": bool(notification.get("read") is True),
        }
    )


def _document_aliases_for_matching(key: Any, value: Any = None) -> set[str]:
    aliases: set[str] = set()

    def add(raw: Any) -> None:
        text = _as_str(raw)
        if not text:
            return
        aliases.add(text)
        aliases.add(_slugify(text))

    add(key)
    if isinstance(value, dict):
        add(value.get("type"))
        add(value.get("document_type"))
        add(value.get("category"))
        add(value.get("id"))
        add(value.get("key"))
        add(value.get("name"))
        add(value.get("label"))

    return {item for item in aliases if item}


def _documents_has_matching_key(documents: Dict[str, Any], target_key: str, target_doc: Dict[str, Any]) -> bool:
    target_aliases = _document_aliases_for_matching(target_key, target_doc)
    for existing_key, existing_doc in (documents or {}).items():
        existing_aliases = _document_aliases_for_matching(existing_key, existing_doc)
        if target_aliases.intersection(existing_aliases):
            return True
    return False


def _merge_vendor_doc_vault(app: Dict[str, Any]) -> int:
    """Attach approved reusable vendor verification docs to an application.

    Existing application uploads always win. Vault docs only fill missing document
    slots and are marked with source='vault' so the UI can explain reuse.
    """
    vendor_email = _as_str(app.get("vendor_email") or app.get("email")).lower()
    if not vendor_email:
        return 0

    vault_docs = get_vendor_doc_vault(vendor_email)
    if not isinstance(vault_docs, list) or not vault_docs:
        app["vault_documents_reused_count"] = 0
        app.setdefault("vault_documents_reused", [])
        return 0

    existing = app.get("documents") if isinstance(app.get("documents"), dict) else app.get("docs")
    documents = _normalize_documents_payload(existing if isinstance(existing, dict) else {})

    reused_keys: list[str] = []
    for raw_doc in vault_docs:
        if not isinstance(raw_doc, dict):
            continue
        key = _as_str(raw_doc.get("type") or raw_doc.get("document_type") or raw_doc.get("category") or raw_doc.get("key") or raw_doc.get("id"))
        if not key:
            continue
        normalized_doc = _normalize_document_entry({
            **raw_doc,
            "source": "vault",
            "vault_source": raw_doc.get("vault_source") or "verification",
            "verified": True,
            "reused_from_vault": True,
        })
        if _documents_has_matching_key(documents, key, normalized_doc):
            continue
        documents[key] = normalized_doc
        reused_keys.append(key)

    app["documents"] = documents
    app["docs"] = documents
    app["vault_documents_reused"] = reused_keys
    app["vault_documents_reused_count"] = len(reused_keys)
    return len(reused_keys)


def _compute_requirement_status(app: Dict[str, Any]) -> Dict[str, Any]:
    event = _get_event_for_app(app)
    req_root = _extract_requirement_root(event)

    booth_categories = _pick_first_list(req_root, ["booth_categories", "boothCategories"])
    global_bucket = _normalize_bucket(req_root.get("global") or req_root.get("globalRequirements") or {})
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

    booth_selected = _has_booth_selection(app)

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
    category = _persist_booth_category(app)
    cents = _persist_resolved_booth_price(app)
    booth_price = round(cents / 100, 2) if cents else None

    enriched = dict(app)
    if category:
        enriched["booth_category"] = category
        enriched["requested_booth_category"] = category
    else:
        # Never present fabricated General as the selected category.
        if not _is_useful_category(enriched.get("booth_category")):
            enriched["booth_category"] = None
        if not _is_useful_category(enriched.get("requested_booth_category")):
            enriched["requested_booth_category"] = None

    if cents:
        enriched["resolved_price_cents"] = cents
        enriched["amount_cents"] = cents
        enriched["total_cents"] = cents
        enriched["price_cents"] = cents
        enriched["booth_price_cents"] = cents
        enriched["booth_price"] = booth_price
        enriched["amount_due"] = booth_price
        enriched["total_price"] = booth_price
    else:
        # Avoid showing the old $100 fallback when no live booth/category price
        # can be resolved. Payment will stay locked until the booth is selected.
        for key in (
            "resolved_price_cents",
            "amount_cents",
            "total_cents",
            "price_cents",
            "booth_price_cents",
            "booth_price",
            "amount_due",
            "total_price",
        ):
            if key in enriched:
                enriched[key] = None

    if isinstance(enriched.get("documents"), dict):
        enriched["documents"] = _normalize_documents_payload(enriched.get("documents"))
        enriched["docs"] = enriched["documents"]
    elif isinstance(enriched.get("docs"), dict):
        enriched["docs"] = _normalize_documents_payload(enriched.get("docs"))
        enriched["documents"] = enriched["docs"]

    _merge_vendor_doc_vault(enriched)
    enriched["document_requests"] = _normalize_document_requests(enriched.get("document_requests"))

    requirement_status = _compute_requirement_status(enriched)
    enriched["booth_selected"] = requirement_status["booth_selected"]
    enriched["compliance_complete"] = requirement_status["compliance_complete"]
    enriched["documents_complete"] = requirement_status["documents_complete"]
    enriched["requirements_complete"] = requirement_status["requirements_complete"]
    enriched["progress_percent"] = requirement_status["progress_percent"]
    enriched["requirements_total_items"] = requirement_status["requirements_total_items"]
    enriched["requirements_completed_items"] = requirement_status["requirements_completed_items"]
    enriched["requirements_category"] = requirement_status["requirements_category"]

    return enriched


def _get_amount_cents_from_app(app: Dict[str, Any]) -> int:
    # Stripe checkout must not use stale event fallback values.
    # Read saved app price fields directly first, then persist the result.
    cents = _find_booth_price_cents_for_app(app)
    if not cents:
        raise HTTPException(
            status_code=400,
            detail="Could not determine booth price for this application.",
        )

    cents = int(cents)
    app["resolved_price_cents"] = cents
    app["amount_cents"] = cents
    app["price_cents"] = cents
    app["booth_price_cents"] = cents
    app["booth_price"] = round(cents / 100, 2)
    return cents


def _payment_exists_for_application(app_id: str) -> bool:
    target = _normalize_id(app_id)
    if not target:
        return False

    for payment in _iter_dict_values(_payments_store()):
        pid = _normalize_id(payment.get("application_id") or payment.get("applicationId"))
        if pid == target and _as_str(payment.get("status")).lower() == "paid":
            return True

    return False


def _delete_application_record(app_id: Any) -> bool:
    key = _normalize_id(app_id)
    if not key:
        return False

    store_map = _applications_store()
    removed = False

    direct_candidates = [key]
    if key.isdigit():
        direct_candidates.append(int(key))

    for candidate in direct_candidates:
        if candidate in store_map:
            store_map.pop(candidate, None)
            removed = True

    if removed:
        return True

    for stored_key, app in list(store_map.items()):
        if not isinstance(app, dict):
            continue
        if _normalize_id(stored_key) == key or _normalize_id(app.get("id")) == key:
            store_map.pop(stored_key, None)
            removed = True

    return removed


def _current_status(app: Dict[str, Any]) -> str:
    return _as_str(app.get("status")).lower()


def _is_locked_for_vendor_edits(
    app: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
) -> bool:
    status = _current_status(app)
    if status in {"paid", "rejected"}:
        return True

    if status in {"submitted", "approved"}:
        incoming = payload if isinstance(payload, dict) else {}
        allowed_keys = {
            "checked",
            "documents",
            "docs",
            "notes",
            "vendor_category",
            "vendor_categories",
        }
        changed_keys = {str(key).strip() for key in incoming.keys() if str(key).strip()}
        return not changed_keys.issubset(allowed_keys)

    return False


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
        or event.get("organizer_email")
        or event.get("email")
        or "Organizer"
    )
    organizer_email = event.get("organizer_email") or event.get("email") or "unknown@email.com"
    organizer_id = event.get("organizer_id") or event.get("owner_id") or event.get("created_by")

    booth_id = app.get("booth_id") or app.get("selected_booth_id") or app.get("requested_booth_id")
    booth_label = app.get("booth_label") or app.get("booth_number") or booth_id

    amount_cents = int(amount)
    amount_dollars = round(amount_cents / 100, 2)
    platform_fee_percent = _get_organizer_platform_fee_percent(event)
    platform_fee_cents = int(round(amount_cents * platform_fee_percent))
    platform_fee = round(platform_fee_cents / 100, 2)
    organizer_payout_cents = max(amount_cents - platform_fee_cents, 0)
    organizer_payout = round(organizer_payout_cents / 100, 2)
    organizer_stripe_account_id = _get_organizer_stripe_connect_account_id(event)

    record = {
        "id": payment_id,
        "application_id": app_id,
        "event_id": event_id,
        "event_title": event_title,
        "vendor_name": vendor_name,
        "vendor_email": vendor_email,
        "vendor_category": app.get("vendor_category"),
        "vendor_categories": app.get("vendor_categories") or [],
        "organizer_name": organizer_name,
        "organizer_email": organizer_email,
        "organizer_id": organizer_id,
        "booth_id": booth_id,
        "booth_label": booth_label,
        "booth_category": app.get("booth_category") or app.get("requested_booth_category"),
        "requested_booth_category": app.get("requested_booth_category") or app.get("booth_category"),
        "amount_cents": amount_cents,
        "amount": amount_dollars,
        "platform_fee": platform_fee,
        "platform_fee_cents": platform_fee_cents,
        "platform_fee_percent": platform_fee_percent,
        "organizer_payout": organizer_payout,
        "organizer_payout_cents": organizer_payout_cents,
        "organizer_stripe_account_id": organizer_stripe_account_id,
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
    return "https://vendcore.co"


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


def _message_user_role(user: Dict[str, Any]) -> str:
    return _as_str(user.get("role") or user.get("user_role") or user.get("account_type")).lower()


def _message_user_email(user: Dict[str, Any]) -> str:
    return _as_str(user.get("email") or user.get("sub") or user.get("username")).lower()


def _message_user_id(user: Dict[str, Any]) -> str:
    return _as_str(
        user.get("organizer_id")
        or user.get("vendor_id")
        or user.get("user_id")
        or user.get("id")
        or user.get("sub")
    )


def _message_identity_matches_app_vendor(app: Dict[str, Any], user: Dict[str, Any]) -> bool:
    vendor_id, vendor_email = _extract_vendor_identity(user)
    app_vendor_id = _normalize_id(
        app.get("vendor_id") or app.get("vendorId") or app.get("user_id") or app.get("userId")
    )
    app_vendor_email = _as_str(app.get("vendor_email") or app.get("email")).lower()

    if vendor_id and app_vendor_id and vendor_id == app_vendor_id:
        return True
    if vendor_email and app_vendor_email and vendor_email == app_vendor_email:
        return True

    return False


def _message_identity_matches_event_organizer(app: Dict[str, Any], user: Dict[str, Any]) -> bool:
    """Return True only when the logged-in organizer owns the app's event.

    This must never be a blanket organizer=True check. The messages inbox is
    global across application records, so each row must be filtered by the event
    owner. Otherwise a newly-created organizer can see another organizer's
    conversations.
    """
    event = _get_event_for_app(app) or {}

    user_email = _message_user_email(user)
    user_id = _message_user_id(user)

    organizer_emails = {
        _as_str(app.get("organizer_email")).lower(),
        _as_str(app.get("owner_email")).lower(),
        _as_str(event.get("organizer_email")).lower(),
        _as_str(event.get("owner_email")).lower(),
        _as_str(event.get("email")).lower(),
    }
    organizer_ids = {
        _as_str(app.get("organizer_id")),
        _as_str(app.get("owner_id")),
        _as_str(app.get("created_by")),
        _as_str(event.get("organizer_id")),
        _as_str(event.get("owner_id")),
        _as_str(event.get("created_by")),
    }

    organizer_emails.discard("")
    organizer_ids.discard("")

    if user_email and user_email in organizer_emails:
        return True
    if user_id and user_id in organizer_ids:
        return True

    return False


def _can_access_messages(app: Dict[str, Any], user: Dict[str, Any]) -> bool:
    role = _message_user_role(user)

    if role == "admin":
        return True

    if role == "organizer":
        return _message_identity_matches_event_organizer(app, user)

    if role == "vendor":
        return _message_identity_matches_app_vendor(app, user)

    # Unknown/missing roles should not receive conversation data. This is safer
    # than falling through to broad email matching.
    return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/applications/{app_id}/messages")
def get_application_messages(
    app_id: str,
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    user = _extract_user_from_token(authorization)

    if not _can_access_messages(app, user):
        raise HTTPException(status_code=403, detail="Not authorized")

    messages = app.get("messages")
    if not isinstance(messages, list):
        messages = []

    cleaned: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        cleaned.append(
            {
                "id": _as_str(msg.get("id")) or str(int(time.time() * 1000)),
                "sender": _as_str(msg.get("sender")) or "unknown",
                "text": _as_str(msg.get("text")),
                "created_at": _as_str(msg.get("created_at")) or _now_iso(),
            }
        )

    return {"messages": cleaned}


@router.post("/applications/{app_id}/messages")
def post_application_message(
    app_id: str,
    payload: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    user = _extract_user_from_token(authorization)

    if not _can_access_messages(app, user):
        raise HTTPException(status_code=403, detail="Not authorized")

    text = _as_str(payload.get("text"))
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    role = _as_str(user.get("role")).lower()
    if role not in {"organizer", "vendor", "admin"}:
        role = "vendor" if _can_access_messages(app, user) else "unknown"

    message = {
        "id": str(int(time.time() * 1000)),
        "sender": role,
        "text": text,
        "created_at": _now_iso(),
    }

    existing = app.get("messages")
    if not isinstance(existing, list):
        existing = []
        app["messages"] = existing

    existing.append(message)
    app["updated_at"] = _now_iso()
    _save_store()
    return {"ok": True, "message": message, "messages": existing}


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

    if _is_locked_for_vendor_edits(app, payload):
        raise HTTPException(
            status_code=400,
            detail="This application is locked for booth/category edits. You can still update requirement checkboxes and document uploads while it is submitted or approved.",
        )

    # Booth selection can arrive as booth_id, requested_booth_id, booth_label,
    # booth_number, or camelCase variants. Keep the human-facing label only.
    booth_id = _apply_booth_payload(app, payload)

    if "checked" in payload and isinstance(payload.get("checked"), dict):
        app["checked"] = payload["checked"]

    if "notes" in payload:
        app["notes"] = payload.get("notes") or ""

    if "documents" in payload and isinstance(payload.get("documents"), dict):
        normalized_docs = _normalize_documents_payload(payload["documents"])
        app["documents"] = normalized_docs
        app["docs"] = normalized_docs

    if "docs" in payload and isinstance(payload.get("docs"), dict):
        normalized_docs = _normalize_documents_payload(payload["docs"])
        app["documents"] = normalized_docs
        app["docs"] = normalized_docs

    booth_price = payload.get("booth_price")
    if booth_price is not None:
        cents = _price_to_cents(booth_price)
        if cents:
            app["booth_price_cents"] = cents
            app["amount_cents"] = cents
            app["resolved_price_cents"] = cents

    vendor_name = _as_str(payload.get("vendor_name"))
    vendor_email = _as_str(payload.get("vendor_email"))
    vendor_category = _first_vendor_category(payload)
    vendor_categories = _normalize_string_list(payload.get("vendor_categories"))

    if vendor_name:
        app["vendor_name"] = vendor_name
    if vendor_email:
        app["vendor_email"] = vendor_email
    if vendor_category:
        app["vendor_category"] = vendor_category
    if vendor_categories:
        app["vendor_categories"] = vendor_categories
    elif vendor_category and not isinstance(app.get("vendor_categories"), list):
        app["vendor_categories"] = [vendor_category]

    _persist_booth_category(app)

    _merge_vendor_doc_vault(app)

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

    if not _has_booth_selection(app):
        raise HTTPException(status_code=400, detail="You must select a booth before submitting.")

    # If only an internal map id/category was saved, make sure the application
    # still has a human-safe requested_booth_id for downstream organizer views.
    if not _normalize_id(app.get("booth_id") or app.get("requested_booth_id")):
        fallback_booth = _first_booth_value(app)
        if not fallback_booth:
            fallback_booth = _as_str(
                app.get("booth_category")
                or app.get("requested_booth_category")
                or app.get("category")
                or app.get("selected_booth_id")
                or app.get("booth_canvas_id")
            )
        if fallback_booth:
            app["booth_id"] = fallback_booth
            app["requested_booth_id"] = fallback_booth
            app.setdefault("booth_label", fallback_booth)
            app.setdefault("booth_number", fallback_booth)

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

    # Clear any unpaid/stale Stripe checkout state before calculating amount.
    # This forces a new Checkout Session and prevents an old $100 session from
    # being reused after the selected booth was corrected to $1.
    if _as_str(app.get("payment_status")).lower() != "paid":
        for key in (
            "checkout_session_id",
            "checkout_created_at",
            "checkout_amount_cents",
            "checkoutAmountCents",
            "checkout_platform_fee_cents",
            "checkout_platform_fee_percent",
            "checkout_organizer_payout_cents",
            "checkout_organizer_stripe_account_id",
        ):
            app.pop(key, None)

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

    event = _get_event_for_app(app) or {}
    platform_fee_percent = _get_organizer_platform_fee_percent(event)
    platform_fee_cents = int(round(int(amount_cents) * platform_fee_percent))
    organizer_payout_cents = max(int(amount_cents) - platform_fee_cents, 0)
    organizer_stripe_account_id = _get_organizer_stripe_connect_account_id(event)

    payment_metadata = {
        "application_id": str(app_id_str),
        "event_id": str(app.get("event_id") or app.get("eventId") or ""),
        "organizer_id": str(event.get("organizer_id") or event.get("owner_id") or event.get("created_by") or ""),
        "organizer_email": str(event.get("organizer_email") or event.get("owner_email") or event.get("email") or ""),
        "platform_fee_percent": str(platform_fee_percent),
        "platform_fee_cents": str(platform_fee_cents),
        "organizer_payout_cents": str(organizer_payout_cents),
        "organizer_stripe_account_id": organizer_stripe_account_id,
        "selected_booth_price_cents": str(amount_cents),
        "booth_id": str(app.get("booth_id") or app.get("requested_booth_id") or app.get("selected_booth_id") or ""),
        "booth_category": str(app.get("booth_category") or app.get("requested_booth_category") or ""),
    }

    payment_intent_data: Dict[str, Any] = {"metadata": payment_metadata}
    if organizer_stripe_account_id:
        payment_intent_data["application_fee_amount"] = platform_fee_cents
        payment_intent_data["transfer_data"] = {"destination": organizer_stripe_account_id}

    # Recalculate immediately before creating Stripe Checkout so the live
    # session uses the latest saved booth amount.
    amount_cents = _get_amount_cents_from_app(app)

    session = stripe.checkout.Session.create(
        mode="payment",
        client_reference_id=str(app_id_str),
        metadata=payment_metadata,
        payment_intent_data=payment_intent_data,
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
    app["checkout_platform_fee_cents"] = int(platform_fee_cents)
    app["checkout_platform_fee_percent"] = platform_fee_percent
    app["checkout_organizer_payout_cents"] = int(organizer_payout_cents)
    if organizer_stripe_account_id:
        app["checkout_organizer_stripe_account_id"] = organizer_stripe_account_id
    _save_store()

    return {
        "ok": True,
        "checkout_url": session_url,
        "checkoutUrl": session_url,
        "url": session_url,
        "session_url": session_url,
        "session_id": session_id,
        "amount_cents": int(amount_cents),
        "platform_fee_cents": int(platform_fee_cents),
        "platform_fee_percent": platform_fee_percent,
        "organizer_payout_cents": int(organizer_payout_cents),
        "stripe_connect_enabled": bool(organizer_stripe_account_id),
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
            vendor_category = _first_vendor_category(payload)
            vendor_categories = _normalize_string_list(payload.get("vendor_categories"))
            if vendor_category:
                app["vendor_category"] = vendor_category
            if vendor_categories:
                app["vendor_categories"] = vendor_categories
            elif vendor_category and not isinstance(app.get("vendor_categories"), list):
                app["vendor_categories"] = [vendor_category]

            # IMPORTANT: get-or-create may be called after the booth click.
            # If a draft already exists, do not return it before applying the
            # incoming booth selection payload.
            _apply_booth_payload(app, payload)

            _persist_resolved_booth_price(app)
            if app.get("resolved_price_cents"):
                app["booth_price"] = round(app["resolved_price_cents"] / 100, 2)
            _merge_vendor_doc_vault(app)
            app["updated_at"] = _now_iso()
            _save_store()
            return {"ok": True, "application": _serialize_application(app)}

    new_id = str(int(time.time() * 1000))
    booth_value = _first_booth_value(payload)
    booth_category_value = _as_str(
        payload.get("booth_category")
        or payload.get("requested_booth_category")
        or payload.get("boothCategory")
        or payload.get("requestedBoothCategory")
        or payload.get("category")
    )

    app = {
        "id": new_id,
        "event_id": int(event_id) if str(event_id).isdigit() else event_id,
        "vendor_id": vendor_id,
        "vendor_email": vendor_email or None,
        "vendor_category": _first_vendor_category(payload) or None,
        "vendor_categories": _normalize_string_list(payload.get("vendor_categories")) or ([_first_vendor_category(payload)] if _first_vendor_category(payload) else []),
        "status": "draft",
        "payment_status": "unpaid",
        "checked": payload.get("checked") if isinstance(payload.get("checked"), dict) else {},
        "notes": payload.get("notes") or "",
        "documents": _normalize_documents_payload(payload.get("documents")) if isinstance(payload.get("documents"), dict) else (_normalize_documents_payload(payload.get("docs")) if isinstance(payload.get("docs"), dict) else {}),
        "docs": _normalize_documents_payload(payload.get("docs")) if isinstance(payload.get("docs"), dict) else (_normalize_documents_payload(payload.get("documents")) if isinstance(payload.get("documents"), dict) else {}),
        "requested_booth_id": booth_value or None,
        "booth_id": booth_value or None,
        "booth_label": booth_value or None,
        "booth_number": booth_value or None,
        "booth_category": booth_category_value or None,
        "requested_booth_category": booth_category_value or None,
        "selected_booth_id": _as_str(payload.get("selected_booth_id") or payload.get("selectedBoothId") or payload.get("booth_canvas_id") or payload.get("boothCanvasId")) or None,
        "booth_canvas_id": _as_str(payload.get("booth_canvas_id") or payload.get("boothCanvasId") or payload.get("selected_booth_id") or payload.get("selectedBoothId")) or None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "archived": False,
        "document_requests": [],
    }

    booth_price = payload.get("booth_price")
    if booth_price is not None:
        cents = _price_to_cents(booth_price)
        if cents:
            app["booth_price_cents"] = cents
            app["amount_cents"] = cents
            app["resolved_price_cents"] = cents
            app["booth_price"] = round(cents / 100, 2)

    _persist_booth_category(app)

    _merge_vendor_doc_vault(app)

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
        category = _persist_booth_category(app)
        if not category:
            raise HTTPException(status_code=400, detail="Booth category could not be determined")
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
    category = _persist_booth_category(app)
    if not category:
        raise HTTPException(status_code=400, detail="Booth category could not be determined")
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


@router.post("/organizer/applications/{app_id}/request-document")
def organizer_request_document(
    app_id: str,
    payload: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    user = _extract_user_from_token(authorization)

    role = _as_str(user.get("role")).lower()
    # Keep this permissive for existing dev/admin flows, but still reject obvious vendor-only requests.
    if role and role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Only organizers can request documents")

    label = _as_str(
        payload.get("document_label")
        or payload.get("label")
        or payload.get("name")
        or payload.get("document_key")
    )
    if not label:
        raise HTTPException(status_code=400, detail="document_label is required")

    document_key = _as_str(payload.get("document_key")) or _build_document_request_key(label)

    requests_existing = _normalize_document_requests(app.get("document_requests"))

    request_item = {
        "id": str(int(time.time() * 1000)),
        "document_key": document_key,
        "document_label": label,
        "status": "requested",
        "requested_by": _as_str(user.get("email") or user.get("sub") or "organizer") or "organizer",
        "request_note": _as_str(payload.get("request_note") or payload.get("note") or payload.get("message")),
        "due_date": _as_str(payload.get("due_date") or payload.get("dueBy") or payload.get("due_by")),
        "created_at": _now_iso(),
        "fulfilled_at": "",
        "uploaded_document": None,
    }

    requests_existing.append(request_item)
    app["document_requests"] = requests_existing
    app["updated_at"] = _now_iso()

    _append_application_notification(
        app,
        {
            "type": "document_requested",
            "message": f"Organizer requested: {label}",
            "created_at": _now_iso(),
            "read": False,
        },
    )

    _save_store()

    return {
        "ok": True,
        "request": request_item,
        "application": _serialize_application(app),
    }


@router.post("/vendor/applications/{app_id}/upload-requested-document")
def vendor_upload_requested_document(
    app_id: str,
    payload: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    user = _extract_user_from_token(authorization)

    if user and not _can_access_messages(app, user):
        raise HTTPException(status_code=403, detail="Not authorized")

    request_id = _as_str(payload.get("request_id"))
    uploaded_document = payload.get("uploaded_document")

    if not request_id:
        raise HTTPException(status_code=400, detail="request_id is required")
    if not isinstance(uploaded_document, dict):
        raise HTTPException(status_code=400, detail="uploaded_document is required")

    normalized_upload = _normalize_document_entry(uploaded_document)
    if not isinstance(normalized_upload, dict):
        raise HTTPException(status_code=400, detail="Invalid uploaded_document")

    requests_existing = _normalize_document_requests(app.get("document_requests"))
    updated = False
    document_key = ""

    for item in requests_existing:
        if _as_str(item.get("id")) != request_id:
            continue

        item["status"] = "fulfilled"
        item["fulfilled_at"] = _now_iso()
        item["uploaded_document"] = normalized_upload
        document_key = _as_str(item.get("document_key")) or _build_document_request_key(item.get("document_label"), request_id)
        updated = True
        break

    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")

    documents = _normalize_documents_payload(app.get("documents") if isinstance(app.get("documents"), dict) else app.get("docs"))
    documents[document_key or request_id] = normalized_upload
    app["documents"] = documents
    app["docs"] = documents
    app["document_requests"] = requests_existing

    requirement_status = _compute_requirement_status(app)
    app["booth_selected"] = requirement_status["booth_selected"]
    app["compliance_complete"] = requirement_status["compliance_complete"]
    app["documents_complete"] = requirement_status["documents_complete"]
    app["requirements_complete"] = requirement_status["requirements_complete"]
    app["progress_percent"] = requirement_status["progress_percent"]
    app["updated_at"] = _now_iso()

    _append_application_notification(
        app,
        {
            "type": "document_uploaded",
            "message": f"Requested document uploaded: {normalized_upload.get('name') or document_key or 'Document'}",
            "created_at": _now_iso(),
            "read": False,
        },
    )

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
        if app.get("archived") is True:
            continue

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
            "requested_booth_category": app.get("requested_booth_category"),
            "vendor_category": app.get("vendor_category"),
            "vendor_categories": app.get("vendor_categories") or [],
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
    if app.get("archived") is True:
        raise HTTPException(status_code=404, detail="Application not found")

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


@router.delete("/organizer/events/{event_id}/applications/{app_id}")
def organizer_delete_application_for_event(event_id: str, app_id: str) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)

    app_event_id = _normalize_id(app.get("event_id") or app.get("eventId"))
    if app_event_id != str(event_id):
        raise HTTPException(status_code=404, detail="Application not found for this event")

    deleted = _delete_application_record(app_id)
    if not deleted:
        return {"ok": True, "already_deleted": True}

    _save_store()
    return {"ok": True}


@router.delete("/organizer/applications/{app_id}")
def organizer_delete_application(app_id: str) -> Dict[str, Any]:
    deleted = _delete_application_record(app_id)
    if not deleted:
        return {"ok": True, "already_deleted": True}

    _save_store()
    return {"ok": True}


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

    deleted = _delete_application_record(app_id)
    if not deleted:
        return {"ok": True, "already_deleted": True}

    _save_store()
    return {"ok": True}



@router.get("/messages/inbox")
def get_messages_inbox(authorization: Optional[str] = Header(default=None)):
    user = _extract_user_from_token(authorization)
    user_email = _message_user_email(user)
    user_role = _message_user_role(user)

    if user_role not in {"organizer", "vendor", "admin"}:
        return {"conversations": []}

    conversations = []

    for app in _iter_dict_values(_applications_store()):
        messages = app.get("messages")
        if not isinstance(messages, list) or not messages:
            continue

        event = _get_event_for_app(app) or {}

        vendor_email = _as_str(app.get("vendor_email")).lower()
        vendor_key = vendor_email or _as_str(app.get("vendor_id")).lower()
        vendor_profile = store._VENDORS.get(vendor_key, {}) if vendor_key else {}

        vendor_name = _as_str(
            vendor_profile.get("business_name")
            or vendor_profile.get("contact_name")
            or app.get("vendor_name")
            or app.get("business_name")
            or app.get("company_name")
            or app.get("name")
            or app.get("vendor_display_name")
            or vendor_email
        )

        organizer_name = _as_str(
            event.get("organizer_name")
            or event.get("company_name")
            or event.get("host_name")
            or event.get("organizer_email")
            or event.get("email")
            or "Organizer"
        )
        organizer_email = _as_str(
            event.get("organizer_email")
            or event.get("email")
        ).lower()
        event_title = _as_str(
            event.get("title")
            or event.get("name")
            or event.get("event_title")
            or f"Event #{app.get('event_id')}"
        )

        if not _can_access_messages(app, user):
            continue

        last_message = messages[-1]

        unread_count = 0
        for msg in messages:
            read_by = [str(v).strip().lower() for v in (msg.get("read_by", []) or [])]
            sender = _as_str(msg.get("sender")).lower()

            if user_role == "organizer":
                if sender in {"organizer", "admin"}:
                    continue
                organizer_has_read = (
                    "organizer" in read_by
                    or "admin" in read_by
                    or (user_email and user_email in read_by)
                )
                if not organizer_has_read:
                    unread_count += 1
            else:
                if sender == "vendor" or (user_email and sender == user_email):
                    continue
                vendor_has_read = (
                    "vendor" in read_by
                    or (user_email and user_email in read_by)
                )
                if not vendor_has_read:
                    unread_count += 1

        conversations.append({
            "application_id": _normalize_id(app.get("id")),
            "event_id": _normalize_id(app.get("event_id")),
            "event_title": event_title,
            "vendor_name": vendor_name,
            "vendor_email": vendor_email,
            "organizer_name": organizer_name,
            "organizer_email": organizer_email,
            "booth_id": app.get("booth_id"),
            "status": app.get("status"),
            "payment_status": app.get("payment_status"),
            "message_count": len(messages),
            "unread_count": unread_count,
            "updated_at": last_message.get("created_at"),
            "last_message": last_message,
        })

    conversations.sort(
        key=lambda x: x["updated_at"] or "",
        reverse=True
    )

    return {"conversations": conversations}

@router.post("/applications/{app_id}/messages/read")
def mark_messages_read(
    app_id: str,
    authorization: Optional[str] = Header(default=None),
):
    user = _extract_user_from_token(authorization)
    user_email = _message_user_email(user)
    user_role = _message_user_role(user)

    app = _get_application_or_404(app_id)

    if not _can_access_messages(app, user):
        raise HTTPException(status_code=403, detail="Not authorized")

    messages = app.get("messages")
    if not isinstance(messages, list):
        return {"success": True}

    read_markers = [marker for marker in (user_email, user_role) if marker]
    for msg in messages:
        read_by = msg.get("read_by", [])
        if not isinstance(read_by, list):
            read_by = []
        normalized_existing = {str(v).strip().lower() for v in read_by}
        for marker in read_markers:
            if marker not in normalized_existing:
                read_by.append(marker)
                normalized_existing.add(marker)
        msg["read_by"] = read_by

    _save_store()
    return {"success": True}

@router.get("/debug/applications")
def debug_applications():
    return {
        "count": len(_APPLICATIONS),
        "applications": _APPLICATIONS,
    }

@router.delete("/admin/debug/applications/{app_id}")
def admin_debug_delete_application(app_id: str):
    """Temporary cleanup route for removing a corrupted in-memory application record.

    Remove this route after the bad record is deleted.
    """
    removed = _delete_application_record(app_id)
    if removed:
        _save_store()
    return {
        "ok": True,
        "deleted": bool(removed),
        "app_id": str(app_id),
        "remaining_count": len(_applications_store()),
    }


@router.post("/admin/debug/applications/{app_id}/delete")
def admin_debug_delete_application_post(app_id: str):
    """POST twin for hosts/tools that make DELETE inconvenient."""
    return admin_debug_delete_application(app_id)


@router.post("/admin/debug/applications/{app_id}/repair")
def admin_debug_repair_application(app_id: str, payload: Dict[str, Any] = Body(default_factory=dict)) -> Dict[str, Any]:
    """Repair a corrupted draft application without deleting it.

    Accepts optional booth/category/price fields and then recomputes category,
    price, and requirements from the same serializer used by the vendor pages.
    """
    app = _get_application_or_404(app_id)

    if isinstance(payload, dict) and payload:
        _apply_booth_payload(app, payload)

        vendor_category = _first_vendor_category(payload)
        vendor_categories = _normalize_string_list(payload.get("vendor_categories"))
        if vendor_category:
            app["vendor_category"] = vendor_category
        if vendor_categories:
            app["vendor_categories"] = vendor_categories
        elif vendor_category:
            app["vendor_categories"] = [vendor_category]

    _persist_booth_category(app)
    cents = _persist_resolved_booth_price(app)
    if cents:
        app["booth_price"] = round(int(cents) / 100, 2)

    status = _compute_requirement_status(app)
    app["booth_selected"] = status["booth_selected"]
    app["compliance_complete"] = status["compliance_complete"]
    app["documents_complete"] = status["documents_complete"]
    app["requirements_complete"] = status["requirements_complete"]
    app["progress_percent"] = status["progress_percent"]
    app["requirements_total_items"] = status["requirements_total_items"]
    app["requirements_completed_items"] = status["requirements_completed_items"]
    app["requirements_category"] = status["requirements_category"]
    app["updated_at"] = _now_iso()

    _save_store()
    return {"ok": True, "application": _serialize_application(app)}

@router.get("/admin/debug/applications/{app_id}/raw")
def admin_debug_raw_application(app_id: str) -> Dict[str, Any]:
    app = _get_application_or_404(app_id)
    return {
        "ok": True,
        "application": app,
    }