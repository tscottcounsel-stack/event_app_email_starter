from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from app.routers.auth import (
    admin_create_user,
    admin_delete_user,
    get_current_user,
    list_all_users,
)
from app.store import get_store_snapshot, load_store, save_store

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminAccountCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    password: str
    role: str
    full_name: str | None = None
    username: str | None = None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")
    if str(user.get("role", "")).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _as_list(value: Any) -> list:
    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, list):
        return value
    return []


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None

    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "y", "on"}:
        return True
    if text in {"false", "0", "no", "n", "off"}:
        return False
    return None


def _event_status_label(event: Dict[str, Any]) -> str:
    raw = str(event.get("status") or "").strip().lower()
    published = _as_bool(event.get("published"))
    if published is None:
        published = _as_bool(event.get("is_published"))

    active = _as_bool(event.get("active"))
    if active is None:
        active = _as_bool(event.get("is_active"))

    if raw == "disabled" or active is False:
        return "disabled"
    if raw == "draft":
        return "draft"
    if raw in {"live", "published"}:
        return "live"
    if published is True and active is not False:
        return "live"
    if published is False:
        return "draft"
    return raw or "unknown"


def _normalize_id(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _event_exists_for_application(app: Dict[str, Any], events: Any) -> bool:
    event_id = (
        app.get("event_id")
        or app.get("eventId")
        or app.get("event")
        or app.get("eventID")
    )
    target = _normalize_id(event_id)
    if not target:
        return False

    for event in _as_list(events):
        if not isinstance(event, dict):
            continue
        event_key = _normalize_id(event.get("id"))
        if event_key == target:
            return True

    return False


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/dashboard")
async def admin_dashboard(user: dict = Depends(require_admin)):
    load_store()
    store = get_store_snapshot()

    accounts = list_all_users()
    vendor_items = [u for u in accounts if str(u.get("role") or "").lower() == "vendor"]
    organizer_items = [u for u in accounts if str(u.get("role") or "").lower() == "organizer"]

    applications = store.get("applications", {})
    events = store.get("events", {})
    payments = store.get("payments", [])
    verifications = store.get("verifications", {})

    event_items = [e for e in _as_list(events) if isinstance(e, dict)]
    application_items_all = [a for a in _as_list(applications) if isinstance(a, dict)]
    application_items = [
        a for a in application_items_all if _event_exists_for_application(a, event_items)
    ]
    payment_items = [p for p in _as_list(payments) if isinstance(p, dict)]
    verification_items = [v for v in _as_list(verifications) if isinstance(v, dict)]

    paid_apps = [a for a in application_items if str(a.get("payment_status") or "").lower() == "paid"]

    approved_unpaid = [
        a
        for a in application_items
        if str(a.get("status") or "").lower() == "approved"
        and str(a.get("payment_status") or "").lower() != "paid"
    ]

    pending_items = [
        a for a in verification_items if str(a.get("status") or "").lower() == "pending"
    ]

    gross_sales = 0.0
    platform_revenue = 0.0
    organizer_payouts = 0.0

    for p in payment_items:
        if str(p.get("status", "")).lower() != "paid":
            continue

        amount = float(p.get("amount", 0) or 0)
        fee = float(p.get("platform_fee", 0) or 0)
        payout = float(p.get("organizer_payout", 0) or 0)

        gross_sales += amount
        platform_revenue += fee
        organizer_payouts += payout

    recent_payments = sorted(
        payment_items,
        key=lambda row: str(row.get("paid_at") or row.get("created_at") or ""),
        reverse=True,
    )[:5]

    return {
        "stats": {
            "total_vendors": len(vendor_items),
            "total_organizers": len(organizer_items),
            "live_events": len([e for e in event_items if _event_status_label(e) == "live"]),
            "applications_submitted": len(application_items),
            "approved_awaiting_payment": len(approved_unpaid),
            "paid_applications": len(paid_apps),
            "pending_verifications": len(pending_items),
            "gross_sales": round(gross_sales, 2),
            "platform_revenue": round(platform_revenue, 2),
            "organizer_payouts_owed": round(organizer_payouts, 2),
        },
        "recent_activity": [],
        "pending_verifications": pending_items[:5],
        "recent_payments": recent_payments,
    }


@router.get("/accounts")
async def admin_accounts(user: dict = Depends(require_admin)):
    accounts = list_all_users()
    return {"accounts": accounts}


@router.post("/accounts")
async def admin_accounts_create(
    payload: AdminAccountCreateRequest,
    user: dict = Depends(require_admin),
):
    account = admin_create_user(
        email=payload.email,
        password=payload.password,
        role=payload.role,
        full_name=payload.full_name,
        username=payload.username,
    )
    return {"ok": True, "account": account}


@router.delete("/accounts/{user_id}")
async def admin_accounts_delete(user_id: int, user: dict = Depends(require_admin)):
    if int(user.get("id") or 0) == int(user_id):
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    deleted = admin_delete_user(user_id)
    return {"ok": True, "account": deleted}


@router.get("/payments")
async def admin_payments(user: dict = Depends(require_admin)):
    load_store()
    store = get_store_snapshot()

    payments = store.get("payments", {})
    items = [p for p in _as_list(payments) if isinstance(p, dict)]

    paid = []
    pending = []
    failed = []

    for p in items:
        status = str(p.get("status", "")).lower()

        if status in {"paid", "completed", "succeeded"}:
            paid.append(p)
        elif status in {"pending", "processing", "awaiting_payment"}:
            pending.append(p)
        elif status in {"failed", "canceled", "cancelled", "refunded"}:
            failed.append(p)

    revenue = sum(float(p.get("amount", 0) or 0) for p in paid)

    return {
        "summary": {
            "total": len(items),
            "paid": len(paid),
            "pending": len(pending),
            "failed": len(failed),
            "revenue": round(revenue, 2),
        },
        "payments": items,
    }


@router.put("/payments/{payment_id}/mark-payout-paid")
async def mark_payout_paid(payment_id: int, user: dict = Depends(require_admin)):
    load_store()
    store = get_store_snapshot()

    payments = store.get("payments", {})
    payment = None

    if isinstance(payments, dict):
        payment = payments.get(str(payment_id)) or payments.get(payment_id)
    elif isinstance(payments, list):
        for p in payments:
            if not isinstance(p, dict):
                continue
            if str(p.get("id")) == str(payment_id) or str(p.get("payment_id")) == str(payment_id):
                payment = p
                break

    if not isinstance(payment, dict):
        raise HTTPException(status_code=404, detail="Payment not found.")

    payment["payout_status"] = "paid"
    payment["payout_sent_at"] = utc_now_iso()

    save_store()

    return {
        "ok": True,
        "payment_id": payment_id,
        "payout_status": payment["payout_status"],
        "payout_sent_at": payment["payout_sent_at"],
    }

@router.post("/reset-demo-data")
async def reset_demo_data(user: dict = Depends(require_admin)):

    ALLOWED_RESET_EMAILS = {"admin@example.com"}

if user.get("email") not in ALLOWED_RESET_EMAILS:
    raise HTTPException(status_code=403, detail="Not authorized for reset")
    from app.store import (
        _EVENTS,
        _APPLICATIONS,
        _PAYMENTS,
        _VERIFICATIONS,
        _PAYOUTS,
        _AUDIT_LOGS,
        _BOOTHS,
        _LAYOUT_META,
        _TEMPLATES,
        save_store,
    )

    from app.routers.auth import _USERS, _USERS_BY_EMAIL, _USERS_BY_USERNAME, _persist_users

    # ----------------------------
    # 🔥 CLEAR STORE DATA
    # ----------------------------
    _EVENTS.clear()
    _APPLICATIONS.clear()
    _PAYMENTS.clear()
    _VERIFICATIONS.clear()
    _PAYOUTS.clear()
    _AUDIT_LOGS.clear()
    _BOOTHS.clear()
    _LAYOUT_META.clear()
    _TEMPLATES.clear()

    save_store()

    # ----------------------------
    # 🔥 REMOVE NON-ADMIN USERS
    # ----------------------------
    admin_users = {
        uid: u for uid, u in _USERS.items()
        if str(u.get("role", "")).lower() == "admin"
    }

    _USERS.clear()
    _USERS.update(admin_users)

    # rebuild indexes
    _USERS_BY_EMAIL.clear()
    _USERS_BY_USERNAME.clear()

    for u in _USERS.values():
        email = (u.get("email") or "").strip().lower()
        username = (u.get("username") or "").strip().lower()
        if email:
            _USERS_BY_EMAIL[email] = u["id"]
        if username:
            _USERS_BY_USERNAME[username] = u["id"]

    _persist_users()

    return {
        "ok": True,
        "message": "Demo data cleared. System ready for live use.",
        "remaining_admins": len(_USERS),
    }