
from datetime import datetime, timezone
import os
from typing import Any, Dict, List

try:
    import stripe
except Exception:
    stripe = None

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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _require_stripe_or_none() -> Any:
    if stripe is None:
        return None
    secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not secret:
        return None
    stripe.api_key = secret
    return stripe


def _stripe_amount_to_dollars(value: Any) -> float:
    try:
        return round(float(value or 0) / 100.0, 2)
    except Exception:
        return 0.0


def _sum_stripe_amounts(rows: Any) -> float:
    total = 0
    for row in rows or []:
        try:
            currency = str(row.get("currency", "usd") if isinstance(row, dict) else getattr(row, "currency", "usd")).lower()
            if currency == "usd":
                total += int(row.get("amount", 0) if isinstance(row, dict) else getattr(row, "amount", 0))
        except Exception:
            continue
    return _stripe_amount_to_dollars(total)


def _stripe_get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _stripe_balance_snapshot() -> Dict[str, Any]:
    stripe_sdk = _require_stripe_or_none()
    if stripe_sdk is None:
        return {
            "ok": False,
            "error": "Stripe is not configured on the backend.",
            "available": 0.0,
            "pending": 0.0,
            "total": 0.0,
            "currency": "usd",
        }

    try:
        balance = stripe_sdk.Balance.retrieve()
        available_rows = list(_stripe_get(balance, "available", []) or [])
        pending_rows = list(_stripe_get(balance, "pending", []) or [])
        available = _sum_stripe_amounts(available_rows)
        pending = _sum_stripe_amounts(pending_rows)
        return {
            "ok": True,
            "error": "",
            "available": available,
            "pending": pending,
            "incoming": pending,
            "total": round(available + pending, 2),
            "currency": "usd",
            "raw_available": available_rows,
            "raw_pending": pending_rows,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "available": 0.0,
            "pending": 0.0,
            "incoming": 0.0,
            "total": 0.0,
            "currency": "usd",
        }


def _stripe_balance_transactions(limit: int = 100) -> List[Dict[str, Any]]:
    stripe_sdk = _require_stripe_or_none()
    if stripe_sdk is None:
        return []

    try:
        rows = stripe_sdk.BalanceTransaction.list(limit=limit)
        data = list(_stripe_get(rows, "data", []) or [])
    except Exception:
        return []

    out: List[Dict[str, Any]] = []
    for row in data:
        amount = _stripe_amount_to_dollars(_stripe_get(row, "amount", 0))
        fee = _stripe_amount_to_dollars(_stripe_get(row, "fee", 0))
        net = _stripe_amount_to_dollars(_stripe_get(row, "net", 0))
        created = _stripe_get(row, "created", None)
        available_on = _stripe_get(row, "available_on", None)
        source = str(_stripe_get(row, "source", "") or "")
        row_type = str(_stripe_get(row, "type", "") or "")
        reporting_category = str(_stripe_get(row, "reporting_category", "") or "")
        currency = str(_stripe_get(row, "currency", "usd") or "usd").lower()

        out.append({
            "id": str(_stripe_get(row, "id", "") or ""),
            "stripe_balance_transaction_id": str(_stripe_get(row, "id", "") or ""),
            "payment_intent_id": source if source.startswith("pi_") else "",
            "stripe_charge_id": source if source.startswith("ch_") else "",
            "checkout_session_id": source if source.startswith("cs_") else "",
            "stripe_session_id": source if source.startswith("cs_") else "",
            "status": "paid" if amount > 0 else row_type or "stripe",
            "vendor_name": "Stripe balance transaction",
            "vendor_email": "",
            "organizer_name": "VendCore Stripe account",
            "organizer_email": "",
            "event_title": reporting_category or row_type or "Stripe transaction",
            "booth_id": "",
            "booth_label": "",
            "amount": amount,
            "gross_amount": amount,
            "platform_fee": net,
            "platform_revenue": net,
            "stripe_fee": fee,
            "net_platform_fee": net,
            "paid_at": datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat() if created else None,
            "available_on": datetime.fromtimestamp(int(available_on), tz=timezone.utc).isoformat() if available_on else None,
            "created_at": datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat() if created else None,
            "stripe_reference": source,
            "stripe_type": row_type,
            "reporting_category": reporting_category,
            "currency": currency,
            "description": str(_stripe_get(row, "description", "") or ""),
        })
    return out


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

    application_items = [a for a in _as_list(applications) if isinstance(a, dict)]
    event_items = [e for e in _as_list(events) if isinstance(e, dict)]
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

    stripe_balance = _stripe_balance_snapshot()
    stripe_transactions = _stripe_balance_transactions(limit=10)
    stripe_total_balance = round(_safe_float(stripe_balance.get("total")), 2)

    return {
        "stats": {
            "total_vendors": len(vendor_items),
            "total_organizers": len(organizer_items),
            "live_events": len(event_items),
            "applications_submitted": len(application_items),
            "approved_awaiting_payment": len(approved_unpaid),
            "paid_applications": len(paid_apps),
            "pending_verifications": len(pending_items),
            "gross_sales": stripe_total_balance if stripe_balance.get("ok") else round(gross_sales, 2),
            "platform_revenue": stripe_total_balance if stripe_balance.get("ok") else round(platform_revenue, 2),
            "organizer_payouts_owed": round(organizer_payouts, 2),
            "stripe_balance_available": round(_safe_float(stripe_balance.get("available")), 2),
            "stripe_balance_pending": round(_safe_float(stripe_balance.get("pending")), 2),
            "stripe_balance_total": stripe_total_balance,
        },
        "stripe": {
            "balance": stripe_balance,
            "recent_balance_transactions": stripe_transactions,
        },
        "recent_activity": [],
        "pending_verifications": pending_items[:5],
        "recent_payments": stripe_transactions[:5] if stripe_transactions else recent_payments,
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
    local_items = [p for p in _as_list(payments) if isinstance(p, dict)]

    paid = []
    pending = []
    failed = []

    for p in local_items:
        status = str(p.get("status", "")).lower()

        if status in {"paid", "completed", "succeeded"}:
            paid.append(p)
        elif status in {"pending", "processing", "awaiting_payment"}:
            pending.append(p)
        elif status in {"failed", "canceled", "cancelled", "refunded"}:
            failed.append(p)

    local_revenue = sum(float(p.get("amount", 0) or 0) for p in paid)

    stripe_balance = _stripe_balance_snapshot()
    stripe_transactions = _stripe_balance_transactions(limit=100)

    # IMPORTANT:
    # Keep older local/test payment rows available for auditing, but expose the
    # Stripe-derived data separately as the source of truth for real money.
    return {
        "summary": {
            "total": len(local_items),
            "paid": len(paid),
            "pending": len(pending),
            "failed": len(failed),
            "revenue": round(local_revenue, 2),
            "stripe_balance_available": round(_safe_float(stripe_balance.get("available")), 2),
            "stripe_balance_pending": round(_safe_float(stripe_balance.get("pending")), 2),
            "stripe_balance_total": round(_safe_float(stripe_balance.get("total")), 2),
            "stripe_transaction_count": len(stripe_transactions),
        },
        "stripe": {
            "balance": stripe_balance,
            "balance_transactions": stripe_transactions,
            "source_of_truth": "stripe_balance_api",
        },
        "payments": local_items,
        "stripe_payments": stripe_transactions,
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

@router.get("/profile")
async def admin_profile(
email: str,
role: str = "vendor",
user: dict = Depends(require_admin),
):
load_store()
store = get_store_snapshot()

```
role_value = str(role or "").strip().lower()
email_value = str(email or "").strip().lower()

if role_value == "organizer":
    profiles = store.get("organizer_profiles", {})
else:
    profiles = store.get("vendor_profiles", {})

profile_items = _as_list(profiles)

for profile in profile_items:
    if not isinstance(profile, dict):
        continue

    profile_email = str(
        profile.get("email")
        or profile.get("user_email")
        or ""
    ).strip().lower()

    if profile_email == email_value:
        return {
            "ok": True,
            "profile": profile,
        }

raise HTTPException(status_code=404, detail="Profile not found.")
```
