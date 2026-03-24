from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.routers.auth import get_current_user
from app.store import get_store_snapshot, load_store, save_store

router = APIRouter(prefix="/admin", tags=["admin"])


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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/dashboard")
async def admin_dashboard(user: dict = Depends(require_admin)):
    load_store()
    store = get_store_snapshot()

    vendors = store.get("vendors", {})
    organizers = store.get("organizers", {})
    applications = store.get("applications", {})
    events = store.get("events", {})
    payments = store.get("payments", [])

    vendor_items = _as_list(vendors)
    organizer_items = _as_list(organizers)
    application_items = [a for a in _as_list(applications) if isinstance(a, dict)]
    event_items = [e for e in _as_list(events) if isinstance(e, dict)]
    payment_items = [p for p in _as_list(payments) if isinstance(p, dict)]

    paid_apps = [a for a in application_items if a.get("payment_status") == "paid"]

    approved_unpaid = [
        a
        for a in application_items
        if a.get("status") == "approved" and a.get("payment_status") != "paid"
    ]

    pending_items = [
        a for a in application_items if a.get("verification_status") == "pending"
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

    return {
        "stats": {
            "total_vendors": len(vendor_items),
            "total_organizers": len(organizer_items),
            "live_events": len(event_items),
            "applications_submitted": len(application_items),
            "approved_awaiting_payment": len(approved_unpaid),
            "paid_applications": len(paid_apps),
            "pending_verifications": len(pending_items),
            "gross_sales": round(gross_sales, 2),
            "platform_revenue": round(platform_revenue, 2),
            "organizer_payouts_owed": round(organizer_payouts, 2),
        },
        "recent_activity": [],
        "pending_verifications": [],
        "recent_payments": payment_items[-5:],
    }


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
            if str(p.get("id")) == str(payment_id) or str(p.get("payment_id")) == str(
                payment_id
            ):
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
