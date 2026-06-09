
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

# Live-mode cleanup:
# These accounts completed test checkout/payment during pre-launch.
# They should still be visible for review, but the admin queue must show them
# as unpaid until they complete a real live verification checkout.
TEST_VERIFICATION_PAYMENT_RESET_EMAILS = {
    "beanallicoffee@gmail.com",
}


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

def _profile_to_admin_payload(row: Any, role_value: str, email_value: str) -> Dict[str, Any]:
    """Normalize a SQLAlchemy Profile row for admin UI consumers."""
    data = dict(getattr(row, "data", None) or {})
    data.setdefault("email", str(getattr(row, "email", "") or email_value).strip().lower())
    data.setdefault("role", str(getattr(row, "role", "") or role_value).strip().lower())

    return {
        **data,
        "id": getattr(row, "id", None),
        "profile_id": getattr(row, "id", None),
        "email": str(getattr(row, "email", "") or data.get("email") or email_value).strip().lower(),
        "role": str(getattr(row, "role", "") or data.get("role") or role_value).strip().lower(),
        "business_name": getattr(row, "business_name", None) or data.get("business_name") or data.get("businessName") or data.get("organizationName"),
        "display_name": getattr(row, "display_name", None) or data.get("display_name") or data.get("contact_name") or data.get("contactName"),
        "city": getattr(row, "city", None) or data.get("city"),
        "state": getattr(row, "state", None) or data.get("state"),
        "categories": getattr(row, "categories", None) or data.get("categories") or [],
        "verified": bool(getattr(row, "verified", False) or data.get("verified") is True or data.get("is_verified") is True),
        "is_verified": bool(getattr(row, "verified", False) or data.get("verified") is True or data.get("is_verified") is True),
        "verification_status": getattr(row, "verification_status", None) or data.get("verification_status") or data.get("status"),
        "public_verification_status": getattr(row, "public_verification_status", None) or data.get("public_verification_status"),
        "public_verification_label": getattr(row, "public_verification_label", None) or data.get("public_verification_label"),
        "review_status": getattr(row, "review_status", None) or data.get("review_status"),
        "visibility_tier": getattr(row, "visibility_tier", None) or data.get("visibility_tier"),
        "subscription_plan": getattr(row, "subscription_plan", None) or data.get("subscription_plan") or data.get("plan"),
        "subscription_status": getattr(row, "subscription_status", None) or data.get("subscription_status"),
        "featured": bool(getattr(row, "featured", False) or data.get("featured") is True),
        "promoted": bool(getattr(row, "promoted", False) or data.get("promoted") is True),
    }


def _find_store_profile(email_value: str, role_value: str) -> Dict[str, Any] | None:
    load_store()
    store = get_store_snapshot()

    profile_keys = [
        "organizer_profiles" if role_value == "organizer" else "vendor_profiles",
        "profiles",
    ]

    for key in profile_keys:
        profile_items = _as_list(store.get(key, {}))
        for profile in profile_items:
            if not isinstance(profile, dict):
                continue

            profile_email = str(
                profile.get("email")
                or profile.get("user_email")
                or profile.get("owner_email")
                or ""
            ).strip().lower()

            profile_role = str(profile.get("role") or role_value).strip().lower()

            if profile_email == email_value and (not profile_role or profile_role == role_value):
                return profile

    return None


def _find_db_profile(email_value: str, role_value: str) -> Any | None:
    try:
        from sqlalchemy import func
        from app.db import SessionLocal
        from app.models.profile import Profile
    except Exception:
        return None

    if SessionLocal is None:
        return None

    db = SessionLocal()
    try:
        return (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email_value, Profile.role == role_value)
            .order_by(Profile.updated_at.desc())
            .first()
        )
    finally:
        db.close()


@router.get("/profile")
async def admin_profile(
    email: str,
    role: str = "vendor",
    user: dict = Depends(require_admin),
):
    role_value = str(role or "vendor").strip().lower()
    email_value = str(email or "").strip().lower()

    if not email_value:
        raise HTTPException(status_code=400, detail="Email is required.")
    if role_value not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer.")

    db_profile = _find_db_profile(email_value, role_value)
    if db_profile is not None:
        profile = _profile_to_admin_payload(db_profile, role_value, email_value)
        return {
            "ok": True,
            "exists": True,
            "email": email_value,
            "role": role_value,
            "profile": profile,
            **profile,
        }

    store_profile = _find_store_profile(email_value, role_value)
    if store_profile is not None:
        return {
            "ok": True,
            "exists": True,
            "email": email_value,
            "role": role_value,
            "profile": store_profile,
            **store_profile,
        }

    # Do not return 404 here. The admin verification page uses this route as
    # enrichment, and older verification records may exist without a public
    # profile row. Returning a safe empty payload prevents a noisy browser alert.
    return {
        "ok": True,
        "exists": False,
        "email": email_value,
        "role": role_value,
        "profile": None,
        "message": "Profile not found.",
    }


@router.post("/profile/premium")
async def admin_profile_premium(
    payload: Dict[str, Any],
    user: dict = Depends(require_admin),
):
    email_value = str(payload.get("email") or "").strip().lower()
    role_value = str(payload.get("role") or "vendor").strip().lower()
    premium = bool(
        payload.get("featured") is True
        or payload.get("promoted") is True
        or str(payload.get("visibility_tier") or "").strip().lower() == "premium"
    )

    if not email_value:
        raise HTTPException(status_code=400, detail="Email is required.")
    if role_value not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer.")

    updated_profile: Dict[str, Any] | None = None

    try:
        from sqlalchemy import func
        from app.db import SessionLocal
        from app.models.profile import Profile

        if SessionLocal is not None:
            db = SessionLocal()
            try:
                row = (
                    db.query(Profile)
                    .filter(func.lower(Profile.email) == email_value, Profile.role == role_value)
                    .first()
                )
                if row is not None:
                    data = dict(row.data or {})
                    data.update({
                        "featured": premium,
                        "promoted": premium,
                        "visibility_tier": "premium" if premium else "standard",
                        "subscription_plan": payload.get("subscription_plan") or ("premium" if premium else "free"),
                        "subscription_status": payload.get("subscription_status") or ("active" if premium else "inactive"),
                    })
                    row.data = data
                    row.featured = premium
                    row.promoted = premium
                    row.visibility_tier = "premium" if premium else "standard"
                    row.subscription_plan = data["subscription_plan"]
                    row.subscription_status = data["subscription_status"]
                    db.commit()
                    db.refresh(row)
                    updated_profile = _profile_to_admin_payload(row, role_value, email_value)
            finally:
                db.close()
    except Exception:
        updated_profile = None

    load_store()
    store = get_store_snapshot()
    store_key = "organizer_profiles" if role_value == "organizer" else "vendor_profiles"
    profiles = store.get(store_key, {})
    found_store = False

    if isinstance(profiles, dict):
        for key, profile in profiles.items():
            if isinstance(profile, dict) and str(profile.get("email") or profile.get("user_email") or "").strip().lower() == email_value:
                profile.update({
                    "featured": premium,
                    "promoted": premium,
                    "visibility_tier": "premium" if premium else "standard",
                    "subscription_plan": payload.get("subscription_plan") or ("premium" if premium else "free"),
                    "subscription_status": payload.get("subscription_status") or ("active" if premium else "inactive"),
                })
                profiles[key] = profile
                updated_profile = updated_profile or profile
                found_store = True
                break
    elif isinstance(profiles, list):
        for profile in profiles:
            if isinstance(profile, dict) and str(profile.get("email") or profile.get("user_email") or "").strip().lower() == email_value:
                profile.update({
                    "featured": premium,
                    "promoted": premium,
                    "visibility_tier": "premium" if premium else "standard",
                    "subscription_plan": payload.get("subscription_plan") or ("premium" if premium else "free"),
                    "subscription_status": payload.get("subscription_status") or ("active" if premium else "inactive"),
                })
                updated_profile = updated_profile or profile
                found_store = True
                break

    if found_store:
        save_store()

    return {
        "ok": True,
        "email": email_value,
        "role": role_value,
        "profile": updated_profile or {
            "email": email_value,
            "role": role_value,
            "featured": premium,
            "promoted": premium,
            "visibility_tier": "premium" if premium else "standard",
        },
    }


@router.delete("/profile")
async def admin_profile_delete(
    email: str,
    role: str = "vendor",
    user: dict = Depends(require_admin),
):
    role_value = str(role or "vendor").strip().lower()
    email_value = str(email or "").strip().lower()

    if not email_value:
        raise HTTPException(status_code=400, detail="Email is required.")
    if role_value not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer.")

    deleted = False

    try:
        from sqlalchemy import func
        from app.db import SessionLocal
        from app.models.profile import Profile

        if SessionLocal is not None:
            db = SessionLocal()
            try:
                row = (
                    db.query(Profile)
                    .filter(func.lower(Profile.email) == email_value, Profile.role == role_value)
                    .first()
                )
                if row is not None:
                    db.delete(row)
                    db.commit()
                    deleted = True
            finally:
                db.close()
    except Exception:
        pass

    load_store()
    store = get_store_snapshot()
    store_key = "organizer_profiles" if role_value == "organizer" else "vendor_profiles"
    profiles = store.get(store_key, {})

    if isinstance(profiles, dict):
        keys_to_delete = [
            key for key, profile in profiles.items()
            if isinstance(profile, dict)
            and str(profile.get("email") or profile.get("user_email") or "").strip().lower() == email_value
        ]
        for key in keys_to_delete:
            del profiles[key]
            deleted = True
    elif isinstance(profiles, list):
        remaining = [
            profile for profile in profiles
            if not (
                isinstance(profile, dict)
                and str(profile.get("email") or profile.get("user_email") or "").strip().lower() == email_value
            )
        ]
        if len(remaining) != len(profiles):
            store[store_key] = remaining
            deleted = True

    if deleted:
        save_store()

    return {
        "ok": True,
        "deleted": deleted,
        "email": email_value,
        "role": role_value,
    }


def _parse_admin_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    try:
        if raw.isdigit():
            numeric = int(raw)
            if numeric <= 0:
                return None
            if numeric < 10_000_000_000:
                numeric *= 1000
            return datetime.fromtimestamp(numeric / 1000, tz=timezone.utc)

        normalized = raw.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _admin_iso_or_none(value: Any) -> str | None:
    parsed = _parse_admin_datetime(value)
    if parsed:
        return parsed.isoformat()
    raw = str(value or "").strip()
    return raw or None


def _verification_due_date_from_payload(payload: Dict[str, Any]) -> datetime | None:
    """Return the earliest date that should put a verified profile in document review."""
    candidates = [
        payload.get("compliance_review_due_at"),
        payload.get("complianceReviewDueAt"),
        payload.get("document_review_due_at"),
        payload.get("documentReviewDueAt"),
        payload.get("renewal_due_at"),
        payload.get("renewalDueAt"),
        payload.get("expires_at"),
        payload.get("expiresAt"),
        payload.get("expiration_date"),
        payload.get("expirationDate"),
        payload.get("verification_expires_at"),
        payload.get("verificationExpiresAt"),
    ]

    parsed = [dt for dt in (_parse_admin_datetime(value) for value in candidates) if dt is not None]
    return min(parsed) if parsed else None


def _status_is_deleted(*values: Any) -> bool:
    deleted_statuses = {"deleted", "inactive", "disabled", "archived", "hidden", "removed", "suspended"}
    return any(str(value or "").strip().lower() in deleted_statuses for value in values)


def _normalize_admin_verification_record(raw: Dict[str, Any], fallback_role: str = "") -> Dict[str, Any]:
    """Normalize store/profile records so the admin verification page and public trust page agree."""
    now = datetime.now(timezone.utc)

    email = str(
        raw.get("email")
        or raw.get("user_email")
        or raw.get("vendor_email")
        or raw.get("organizer_email")
        or ""
    ).strip().lower()

    role = str(raw.get("role") or fallback_role or "vendor").strip().lower()
    if role not in {"vendor", "organizer"}:
        role = "vendor"

    raw_status = str(
        raw.get("status")
        or raw.get("verification_status")
        or raw.get("public_verification_status")
        or raw.get("review_status")
        or ""
    ).strip().lower()

    verification_status = str(
        raw.get("verification_status")
        or raw.get("verificationStatus")
        or raw_status
        or "not_started"
    ).strip().lower()

    public_status = str(
        raw.get("public_verification_status")
        or raw.get("publicVerificationStatus")
        or verification_status
        or raw_status
        or "not_verified"
    ).strip().lower()

    review_status = str(
        raw.get("review_status")
        or raw.get("reviewStatus")
        or ""
    ).strip().lower()

    deleted = bool(
        raw.get("deleted") is True
        or raw.get("is_deleted") is True
        or raw.get("deleted_at")
        or raw.get("deletedAt")
        or _status_is_deleted(
            raw.get("status"),
            raw.get("account_status"),
            raw.get("accountStatus"),
            raw.get("profile_status"),
            raw.get("profileStatus"),
            raw.get("public_status"),
            raw.get("publicStatus"),
            review_status,
        )
    )

    explicit_unverified = public_status in {"not_verified", "unverified"} or verification_status in {"not_verified", "unverified"}
    explicitly_verified = (
        raw.get("verified") is True
        or raw.get("is_verified") is True
        or public_status in {"verified", "approved", "complete"}
        or verification_status in {"verified", "approved", "complete"}
        or review_status in {"approved", "verified"}
    )

    due_date = _verification_due_date_from_payload(raw)
    due_soon_or_overdue = bool(due_date and due_date <= now)

    lifecycle_status = verification_status or public_status or raw_status or "not_started"

    if deleted:
        lifecycle_status = "deleted"
        explicitly_verified = False
    elif explicitly_verified and due_soon_or_overdue:
        # The credential is still verified, but it must appear in the
        # admin "Document Review Due" queue so staff can review renewal docs.
        lifecycle_status = "needs_review"
        verification_status = "needs_review"
        review_status = "needs_review"
        public_status = "verified"
    elif raw_status in {"needs_review", "document_review_due", "compliance_review_due", "renewal_due", "expiring_soon", "needs_renewal"}:
        lifecycle_status = "needs_review"
        verification_status = "needs_review"
        review_status = "needs_review"
        public_status = "verified" if explicitly_verified else public_status
    elif explicit_unverified:
        lifecycle_status = "unverified"
        explicitly_verified = False
    elif explicitly_verified:
        lifecycle_status = "verified"
        verification_status = "verified"
        public_status = "verified"
        review_status = review_status or "approved"

    fee_paid = bool(
        raw.get("fee_paid") is True
        or str(raw.get("payment_status") or "").strip().lower() == "paid"
        or str(raw.get("verification_payment_status") or "").strip().lower() == "paid"
    )

    # Beanalli's earlier verification payment was a tester/live-transition row,
    # not a real post-launch payment. Keep the record visible, but require
    # real payment before approval.
    if email in TEST_VERIFICATION_PAYMENT_RESET_EMAILS:
        fee_paid = False

    fee_amount = raw.get("fee_amount")
    if fee_amount is None:
        fee_amount = raw.get("annual_fee")
    if fee_amount is None:
        fee_amount = raw.get("verification_fee")
    if fee_amount is None:
        fee_amount = 49 if role == "organizer" else 25

    record_id = raw.get("id") or raw.get("verification_id") or raw.get("profile_id") or email or f"{role}-profile"

    return {
        **raw,
        "id": record_id,
        "verification_id": raw.get("verification_id") or record_id,
        "email": email,
        "role": role,
        "status": lifecycle_status,
        "lifecycle_status": lifecycle_status,
        "verification_status": verification_status,
        "public_verification_status": public_status,
        "public_verification_label": raw.get("public_verification_label") or ("Verified" if explicitly_verified else "Not verified"),
        "review_status": review_status,
        "verified": bool(explicitly_verified),
        "is_verified": bool(explicitly_verified),
        "document_review_due": lifecycle_status == "needs_review",
        "compliance_review_due": lifecycle_status == "needs_review",
        "needs_review": lifecycle_status == "needs_review",
        "payment_status": "paid" if fee_paid else str(raw.get("payment_status") or "unpaid").lower(),
        "verification_payment_status": "paid" if fee_paid else str(raw.get("verification_payment_status") or raw.get("payment_status") or "unpaid").lower(),
        "fee_paid": fee_paid,
        "fee_amount": fee_amount,
        "submitted_at": raw.get("submitted_at") or raw.get("created_at") or raw.get("updated_at"),
        "reviewed_at": raw.get("reviewed_at") or raw.get("last_verified_at") or raw.get("lastVerifiedAt"),
        "expires_at": _admin_iso_or_none(raw.get("expires_at") or raw.get("expiresAt")),
        "expiration_date": _admin_iso_or_none(raw.get("expiration_date") or raw.get("expirationDate") or raw.get("verification_expires_at") or raw.get("verificationExpiresAt")),
        "compliance_review_due_at": _admin_iso_or_none(
            raw.get("compliance_review_due_at")
            or raw.get("complianceReviewDueAt")
            or raw.get("document_review_due_at")
            or raw.get("documentReviewDueAt")
            or raw.get("renewal_due_at")
            or raw.get("renewalDueAt")
            or due_date
        ),
        "documents": raw.get("documents") if isinstance(raw.get("documents"), list) else [],
    }


def _all_db_profiles_for_admin_queue() -> List[Dict[str, Any]]:
    try:
        from app.db import SessionLocal
        from app.models.profile import Profile
    except Exception:
        return []

    if SessionLocal is None:
        return []

    db = SessionLocal()
    try:
        rows = (
            db.query(Profile)
            .filter(Profile.role.in_(["vendor", "organizer"]))
            .all()
        )

        payloads: List[Dict[str, Any]] = []
        for row in rows:
            role_value = str(getattr(row, "role", "") or "").strip().lower()
            email_value = str(getattr(row, "email", "") or "").strip().lower()
            if not email_value or role_value not in {"vendor", "organizer"}:
                continue
            payloads.append(_profile_to_admin_payload(row, role_value, email_value))
        return payloads
    except Exception:
        return []
    finally:
        db.close()


def _store_profiles_for_admin_queue() -> List[Dict[str, Any]]:
    load_store()
    store = get_store_snapshot()

    rows: List[Dict[str, Any]] = []
    for store_key, role_value in (("vendor_profiles", "vendor"), ("organizer_profiles", "organizer"), ("profiles", "")):
        for profile in _as_list(store.get(store_key, {})):
            if not isinstance(profile, dict):
                continue
            profile_role = str(profile.get("role") or role_value or "").strip().lower()
            if profile_role not in {"vendor", "organizer"}:
                profile_role = role_value or "vendor"
            rows.append({**profile, "role": profile_role})
    return rows


def _store_verifications_for_admin_queue() -> List[Dict[str, Any]]:
    load_store()
    store = get_store_snapshot()

    rows: List[Dict[str, Any]] = []
    for record in _as_list(store.get("verifications", {})):
        if isinstance(record, dict):
            rows.append(record)
    return rows


@router.get("/verifications")
async def admin_verifications(
    role: str = "all",
    status: str = "all",
    user: dict = Depends(require_admin),
):
    """Canonical admin verification queue.

    Includes normal verification submissions plus verified profiles whose
    compliance/document review date is due. This keeps the admin queue in sync
    with public /verified pages that show renewal or document-review warnings.
    """
    requested_role = str(role or "all").strip().lower()
    requested_status = str(status or "all").strip().lower()

    records_by_identity: Dict[str, Dict[str, Any]] = {}

    for raw in _store_verifications_for_admin_queue():
        record = _normalize_admin_verification_record(raw)
        key = f"{record.get('role')}:{record.get('email') or record.get('id')}"
        records_by_identity[key] = record

    for raw in _store_profiles_for_admin_queue() + _all_db_profiles_for_admin_queue():
        record = _normalize_admin_verification_record(raw, str(raw.get("role") or "vendor"))
        key = f"{record.get('role')}:{record.get('email') or record.get('id')}"
        existing = records_by_identity.get(key)

        if existing:
            # Profile truth should be able to promote a verified record into
            # document-review due, while preserving submitted documents from the
            # verification record when present.
            merged = {**record, **existing}

            if record.get("lifecycle_status") == "deleted":
                # Deleted/archived/hidden profile truth must win over stale
                # verification rows so old deleted accounts do not reappear.
                merged.update({
                    "status": "deleted",
                    "lifecycle_status": "deleted",
                    "verification_status": "deleted",
                    "review_status": "deleted",
                    "public_verification_status": "deleted",
                    "document_review_due": False,
                    "compliance_review_due": False,
                    "needs_review": False,
                    "verified": False,
                    "is_verified": False,
                })
            elif record.get("lifecycle_status") == "needs_review":
                merged.update({
                    "status": "needs_review",
                    "lifecycle_status": "needs_review",
                    "verification_status": "needs_review",
                    "review_status": "needs_review",
                    "public_verification_status": "verified",
                    "document_review_due": True,
                    "compliance_review_due": True,
                    "needs_review": True,
                    "verified": True,
                    "is_verified": True,
                    "compliance_review_due_at": record.get("compliance_review_due_at") or existing.get("compliance_review_due_at"),
                    "expiration_date": record.get("expiration_date") or existing.get("expiration_date"),
                    "expires_at": record.get("expires_at") or existing.get("expires_at"),
                })
            records_by_identity[key] = merged
        else:
            # Do not add every normal Profile row to the verification queue.
            # The queue should contain actual verification submissions plus
            # active profiles whose documents/compliance are due for review.
            # Deleted rows are only useful when the Deleted filter is selected.
            if record.get("lifecycle_status") in {"needs_review", "deleted"}:
                records_by_identity[key] = record

    records = list(records_by_identity.values())

    # Hide deleted/archived/hidden/inactive accounts from the normal admin queue.
    # They should not inflate All/Vendor/Organizer/Document Review Due counts.
    # Keep them visible only when the Deleted filter is intentionally selected.
    if requested_status != "deleted":
        records = [
            row for row in records
            if str(row.get("lifecycle_status") or row.get("status") or "").strip().lower() != "deleted"
        ]

    if requested_role in {"vendor", "organizer"}:
        records = [row for row in records if str(row.get("role") or "").lower() == requested_role]

    if requested_status not in {"", "all"}:
        aliases = {
            "document_review_due": {"needs_review", "document_review_due", "compliance_review_due", "expiring_soon", "needs_renewal"},
            "expiring_soon": {"needs_review", "document_review_due", "compliance_review_due", "expiring_soon", "needs_renewal"},
            "needs_review": {"needs_review", "document_review_due", "compliance_review_due", "expiring_soon", "needs_renewal"},
            "verified": {"verified"},
            "pending": {"pending", "submitted", "under_review", "renewal_pending"},
            "rejected": {"rejected", "denied"},
            "deleted": {"deleted", "removed", "archived"},
            "expired": {"expired"},
        }
        wanted = aliases.get(requested_status, {requested_status})
        records = [
            row for row in records
            if str(row.get("lifecycle_status") or row.get("status") or "").lower() in wanted
            or str(row.get("verification_status") or "").lower() in wanted
            or str(row.get("review_status") or "").lower() in wanted
        ]

    records.sort(
        key=lambda row: str(
            row.get("compliance_review_due_at")
            or row.get("submitted_at")
            or row.get("reviewed_at")
            or row.get("created_at")
            or ""
        ),
        reverse=True,
    )

    return {
        "ok": True,
        "verifications": records,
        "records": records,
        "items": records,
        "count": len(records),
    }
