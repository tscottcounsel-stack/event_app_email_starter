from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.routers.auth import _USERS, _USERS_BY_EMAIL, _persist_users, get_current_user

from app.store import _VENDORS, save_store

try:
    import stripe
except Exception:
    stripe = None


router = APIRouter(prefix="/billing", tags=["Billing"])


class CheckoutSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    plan: str
    success_url: str
    cancel_url: str


class PortalSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    return_url: str


class ConnectAccountLinkRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    return_url: Optional[str] = None
    refresh_url: Optional[str] = None


def _public_app_url() -> str:
    for name in (
        "PUBLIC_APP_URL",
        "APP_BASE_URL",
        "FRONTEND_BASE_URL",
        "FRONTEND_URL",
        "VITE_PUBLIC_APP_URL",
        "VITE_FRONTEND_URL",
    ):
        value = (os.getenv(name) or "").strip().rstrip("/")
        if value:
            return value
    return "https://vendcore.co"


def _require_stripe() -> Any:
    if stripe is None:
        raise HTTPException(status_code=500, detail="Stripe SDK missing. Install stripe.")

    secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="STRIPE_SECRET_KEY is not set")

    stripe.api_key = secret
    return stripe


def _plan_to_price_id(plan: str) -> str:
    normalized = str(plan or "").strip().lower()
    mapping = {
        "pro_vendor": (os.getenv("STRIPE_PRICE_PRO_VENDOR") or "").strip(),
        "enterprise_organizer": (os.getenv("STRIPE_PRICE_ENTERPRISE_ORGANIZER") or "").strip(),
    }
    price_id = mapping.get(normalized, "")
    if not price_id:
        raise HTTPException(status_code=400, detail=f"No Stripe price configured for plan '{normalized}'")
    return price_id


def _price_id_to_plan(price_id: Optional[str]) -> str:
    price_id = str(price_id or "").strip()
    mapping = {
        (os.getenv("STRIPE_PRICE_PRO_VENDOR") or "").strip(): "pro_vendor",
        (os.getenv("STRIPE_PRICE_ENTERPRISE_ORGANIZER") or "").strip(): "enterprise_organizer",
    }
    return mapping.get(price_id, "starter")


def is_active_paid_subscription(user: Dict[str, Any]) -> bool:
    plan = str(user.get("plan") or "starter").strip().lower()
    status = str(user.get("subscription_status") or "inactive").strip().lower()

    return (
        plan in {"pro_vendor", "enterprise_organizer"}
        and status in {"active", "trialing", "paid"}
    )


def get_platform_fee_percent(user: Dict[str, Any]) -> float:
    """
    VendCore platform fee policy:
    - Starter/free users: 5%
    - Active paid subscribers: 3%

    Return value is a decimal percentage, e.g. 0.05 = 5%.
    """
    return 0.03 if is_active_paid_subscription(user) else 0.05


def get_platform_fee_basis_points(user: Dict[str, Any]) -> int:
    return int(round(get_platform_fee_percent(user) * 10_000))


def get_platform_fee_label(user: Dict[str, Any]) -> str:
    return "3%" if is_active_paid_subscription(user) else "5%"


def _to_iso(ts: Any) -> Optional[str]:
    try:
        if ts in (None, "", 0):
            return None
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _lookup_user(*, user_id: Any = None, email: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if user_id not in (None, ""):
        try:
            found = _USERS.get(int(user_id))
            if isinstance(found, dict):
                return found
        except Exception:
            pass

    normalized_email = str(email or "").strip().lower()
    if normalized_email:
        matched_user_id = _USERS_BY_EMAIL.get(normalized_email)
        if matched_user_id is not None:
            found = _USERS.get(int(matched_user_id))
            if isinstance(found, dict):
                return found

    return None


def _save_user_updates(user: Dict[str, Any]) -> None:
    user["updated_at"] = int(datetime.now(tz=timezone.utc).timestamp())
    _persist_users()


def _set_customer_fields(
    user: Dict[str, Any],
    *,
    customer_id: Optional[str],
    subscription_id: Optional[str],
) -> None:
    if customer_id:
        user["stripe_customer_id"] = customer_id
    if subscription_id:
        user["stripe_subscription_id"] = subscription_id

def _sync_vendor_premium_from_subscription(user: Dict[str, Any]) -> None:
    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()
    plan = str(user.get("plan") or "starter").strip().lower()
    status = str(user.get("subscription_status") or "inactive").strip().lower()

    if role != "vendor" or not email:
        return

    vendor = _VENDORS.get(email)
    if not isinstance(vendor, dict):
        return

    is_premium = plan == "pro_vendor" and status in {"active", "trialing", "paid"}

    vendor["plan"] = plan
    vendor["subscription_plan"] = plan
    vendor["subscription_status"] = status
    vendor["featured"] = is_premium
    vendor["promoted"] = is_premium
    vendor["updated_at"] = datetime.now(tz=timezone.utc).isoformat()

    save_store()

def _sync_organizer_premium_from_subscription(user: Dict[str, Any]) -> None:
    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()
    plan = str(user.get("plan") or "starter").strip().lower()
    status = str(user.get("subscription_status") or "inactive").strip().lower()

    if role != "organizer" or not email:
        return

    try:
        from app.routers.organizers import _load_profiles, _save_profiles
    except Exception as exc:
        print("⚠️ Organizer premium sync skipped:", str(exc))
        return

    profiles = _load_profiles()
    profile = profiles.get(email)

    if not isinstance(profile, dict):
        return

    is_premium = plan == "enterprise_organizer" and status in {"active", "trialing", "paid"}

    profile["plan"] = plan
    profile["subscription_plan"] = plan
    profile["subscription_status"] = status
    profile["featured"] = is_premium
    profile["promoted"] = is_premium
    profile["updatedAt"] = datetime.now(tz=timezone.utc).isoformat()

    profiles[email] = profile
    _save_profiles(profiles)

def _apply_subscription_state(
    user: Dict[str, Any],
    *,
    plan: str,
    subscription_status: str,
    customer_id: Optional[str],
    subscription_id: Optional[str],
    current_period_end: Optional[Any],
    cancel_at_period_end: bool,
) -> None:
    normalized_plan = str(plan or "starter").strip().lower()
    normalized_status = str(subscription_status or "inactive").strip().lower()

    user["plan"] = normalized_plan
    user["subscription_status"] = normalized_status
    user["stripe_customer_id"] = customer_id or user.get("stripe_customer_id")
    user["stripe_subscription_id"] = subscription_id
    user["current_period_end"] = _to_iso(current_period_end)
    user["cancel_at_period_end"] = bool(cancel_at_period_end)

    if normalized_status in {"canceled", "cancelled", "unpaid", "incomplete_expired", "inactive"}:
        user["plan"] = "starter"
        user["subscription_status"] = "inactive"
        user["stripe_subscription_id"] = None
        user["cancel_at_period_end"] = False

    _sync_vendor_premium_from_subscription(user)
    _sync_organizer_premium_from_subscription(user)
    _save_user_updates(user)

def _extract_subscription_price_id(subscription: Any) -> Optional[str]:
    try:
        items = getattr(subscription, "items", None)
        if items is None and isinstance(subscription, dict):
            items = subscription.get("items")

        data = getattr(items, "data", None)
        if data is None and isinstance(items, dict):
            data = items.get("data")

        if not data:
            return None

        first = data[0]
        price = getattr(first, "price", None)
        if price is None and isinstance(first, dict):
            price = first.get("price")

        price_id = getattr(price, "id", None)
        if price_id is None and isinstance(price, dict):
            price_id = price.get("id")

        return str(price_id or "").strip() or None
    except Exception:
        return None


def _extract_metadata(obj: Any) -> Dict[str, Any]:
    metadata = getattr(obj, "metadata", None)
    if metadata is None and isinstance(obj, dict):
        metadata = obj.get("metadata")

    if isinstance(metadata, dict):
        return metadata

    try:
        return dict(metadata or {})
    except Exception:
        return {}


def _find_user_from_checkout_session(session: Any) -> Optional[Dict[str, Any]]:
    try:
        metadata = _extract_metadata(session)

        client_reference_id = getattr(session, "client_reference_id", None)
        if client_reference_id is None and isinstance(session, dict):
            client_reference_id = session.get("client_reference_id")

        if client_reference_id:
            user = _lookup_user(user_id=client_reference_id)
            if user:
                return user

        user_id = metadata.get("user_id")
        if user_id:
            user = _lookup_user(user_id=user_id)
            if user:
                return user

        # Prefer our checkout metadata first because Stripe customer_email can be empty
        # when an existing customer is attached to the session.
        email = str(metadata.get("email") or "").strip().lower()

        if not email:
            raw_email = getattr(session, "customer_email", None)
            if raw_email is None and isinstance(session, dict):
                raw_email = session.get("customer_email")
            email = str(raw_email or "").strip().lower()

        if not email:
            customer_details = getattr(session, "customer_details", None)
            if customer_details is None and isinstance(session, dict):
                customer_details = session.get("customer_details") or {}

            if isinstance(customer_details, dict):
                email = str(customer_details.get("email") or "").strip().lower()
            else:
                email = str(getattr(customer_details, "email", "") or "").strip().lower()

        if email:
            user = _lookup_user(email=email)
            if user:
                return user

        print("⚠️ Checkout session lookup failed")
        print("   client_reference_id =", client_reference_id)
        print("   metadata =", metadata)
        print("   customer_email =", email)
        return None
    except Exception as exc:
        print("🔥 USER LOOKUP ERROR:", str(exc))
        return None

def _sync_from_subscription_object(subscription: Any) -> bool:
    metadata = _extract_metadata(subscription)

    customer_id = str(
        getattr(subscription, "customer", None) or metadata.get("customer") or ""
    ).strip() or None
    subscription_id = str(getattr(subscription, "id", None) or "").strip() or None
    status = str(getattr(subscription, "status", None) or "inactive").strip().lower()
    cancel_at_period_end = bool(getattr(subscription, "cancel_at_period_end", False))
    current_period_end = getattr(subscription, "current_period_end", None)

    user = _lookup_user(user_id=metadata.get("user_id"), email=metadata.get("email"))

    if user is None and customer_id:
        for candidate in _USERS.values():
            if isinstance(candidate, dict) and str(candidate.get("stripe_customer_id") or "").strip() == customer_id:
                user = candidate
                break

    if user is None:
        return False

    price_id = _extract_subscription_price_id(subscription)
    plan = metadata.get("plan") or _price_id_to_plan(price_id)

    _apply_subscription_state(
        user,
        plan=plan,
        subscription_status=status,
        customer_id=customer_id,
        subscription_id=subscription_id,
        current_period_end=current_period_end,
        cancel_at_period_end=cancel_at_period_end,
    )
    return True


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _next_verification_id(verifications: Dict[Any, Any]) -> int:
    ids = []
    for key in verifications.keys():
        try:
            ids.append(int(key))
        except Exception:
            continue
    return max(ids, default=0) + 1


def mark_verification_paid(
    *,
    email: str,
    role: str,
    verification_id: Any = None,
    stripe_session_id: Optional[str] = None,
    stripe_payment_intent_id: Optional[str] = None,
    amount_paid: Any = None,
) -> Optional[Dict[str, Any]]:
    from app.store import _VERIFICATIONS, save_store

    normalized_email = str(email or "").strip().lower()
    normalized_role = str(role or "").strip().lower()

    if not normalized_email or normalized_role not in {"vendor", "organizer"}:
        print("⚠️ Verification payment missing email/role:", normalized_email, normalized_role)
        return None

    record: Optional[Dict[str, Any]] = None
    record_key: Any = None

    if verification_id not in (None, ""):
        for key in (verification_id, str(verification_id), _safe_int(verification_id, -1)):
            candidate = _VERIFICATIONS.get(key)
            if isinstance(candidate, dict):
                record = candidate
                record_key = key
                break

    if record is None:
        for key, candidate in _VERIFICATIONS.items():
            if not isinstance(candidate, dict):
                continue
            candidate_email = str(candidate.get("email") or "").strip().lower()
            candidate_role = str(candidate.get("role") or "").strip().lower()
            if candidate_email == normalized_email and candidate_role == normalized_role:
                record = candidate
                record_key = key
                break

    if record is None:
        new_id = _next_verification_id(_VERIFICATIONS)
        record_key = new_id
        record = {
            "id": new_id,
            "email": normalized_email,
            "role": normalized_role,
            "status": "not_submitted",
            "submitted_at": None,
            "reviewed_at": None,
            "reviewed_by": None,
            "notes": "",
            "documents": [],
            "fee_amount": 49 if normalized_role == "organizer" else 25,
            "expiration_date": None,
        }
        _VERIFICATIONS[record_key] = record

    record["id"] = _safe_int(record.get("id") or record_key, _next_verification_id(_VERIFICATIONS))
    record["email"] = normalized_email
    record["role"] = normalized_role
    record["payment_status"] = "paid"
    record["fee_paid"] = True
    record["paid_at"] = datetime.now(tz=timezone.utc).isoformat()

    if stripe_session_id:
        record["stripe_session_id"] = stripe_session_id
    if stripe_payment_intent_id:
        record["stripe_payment_intent_id"] = stripe_payment_intent_id
    if amount_paid not in (None, ""):
        try:
            record["amount_paid"] = round(float(amount_paid) / 100, 2)
        except Exception:
            record["amount_paid"] = amount_paid

    save_store()
    return record


@router.get("/platform-fee")
def get_current_platform_fee(user: dict = Depends(get_current_user)):
    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email")) or user
    fee_percent = get_platform_fee_percent(lookup)

    return {
        "ok": True,
        "plan": str(lookup.get("plan") or "starter"),
        "subscription_status": str(lookup.get("subscription_status") or "inactive"),
        "is_paid_subscriber": is_active_paid_subscription(lookup),
        "platform_fee_percent": fee_percent,
        "platform_fee_basis_points": get_platform_fee_basis_points(lookup),
        "platform_fee_label": get_platform_fee_label(lookup),
        "policy": {
            "starter": "5% platform fee on paid booth transactions",
            "paid_subscription": "3% platform fee on paid booth transactions",
        },
    }


@router.post("/connect/account")
def create_connect_account(user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if str(lookup.get("role") or "").strip().lower() != "organizer":
        raise HTTPException(status_code=403, detail="Stripe Connect is only available for organizer accounts")

    existing_account_id = str(
        lookup.get("stripe_connect_account_id")
        or lookup.get("stripe_account_id")
        or ""
    ).strip()

    if existing_account_id:
        try:
            account = stripe_sdk.Account.retrieve(existing_account_id)
            return {
                "ok": True,
                "account_id": existing_account_id,
                "charges_enabled": bool(getattr(account, "charges_enabled", False)),
                "payouts_enabled": bool(getattr(account, "payouts_enabled", False)),
                "details_submitted": bool(getattr(account, "details_submitted", False)),
            }
        except Exception:
            # If the account was deleted in Stripe, create a fresh one below.
            pass

    try:
        account = stripe_sdk.Account.create(
            type="express",
            email=str(lookup.get("email") or "") or None,
            country=(os.getenv("STRIPE_CONNECT_COUNTRY") or "US").strip() or "US",
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
            metadata={
                "user_id": str(lookup.get("id") or ""),
                "email": str(lookup.get("email") or ""),
                "role": str(lookup.get("role") or "organizer"),
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe Connect account failed: {exc}")

    account_id = str(getattr(account, "id", "") or "").strip()
    lookup["stripe_connect_account_id"] = account_id
    lookup["stripe_account_id"] = account_id
    lookup["stripe_connect_charges_enabled"] = bool(getattr(account, "charges_enabled", False))
    lookup["stripe_connect_payouts_enabled"] = bool(getattr(account, "payouts_enabled", False))
    lookup["stripe_connect_details_submitted"] = bool(getattr(account, "details_submitted", False))
    _save_user_updates(lookup)

    return {
        "ok": True,
        "account_id": account_id,
        "charges_enabled": lookup["stripe_connect_charges_enabled"],
        "payouts_enabled": lookup["stripe_connect_payouts_enabled"],
        "details_submitted": lookup["stripe_connect_details_submitted"],
    }


@router.post("/connect/onboarding-link")
def create_connect_onboarding_link(
    payload: ConnectAccountLinkRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if str(lookup.get("role") or "").strip().lower() != "organizer":
        raise HTTPException(status_code=403, detail="Stripe Connect is only available for organizer accounts")

    account_id = str(
        lookup.get("stripe_connect_account_id")
        or lookup.get("stripe_account_id")
        or ""
    ).strip()

    if not account_id:
        created = create_connect_account(user)
        account_id = str(created.get("account_id") or "").strip()

    base_url = _public_app_url()
    return_url = str(payload.return_url or f"{base_url}/organizer/settings?stripe=connected").strip()
    refresh_url = str(payload.refresh_url or f"{base_url}/organizer/settings?stripe=refresh").strip()

    try:
        link = stripe_sdk.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe Connect onboarding failed: {exc}")

    return {"ok": True, "url": link.url, "account_id": account_id}


@router.get("/connect/status")
def get_connect_status(user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    account_id = str(
        lookup.get("stripe_connect_account_id")
        or lookup.get("stripe_account_id")
        or ""
    ).strip()

    if not account_id:
        return {
            "ok": True,
            "connected": False,
            "account_id": None,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
        }

    try:
        account = stripe_sdk.Account.retrieve(account_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe Connect status failed: {exc}")

    lookup["stripe_connect_charges_enabled"] = bool(getattr(account, "charges_enabled", False))
    lookup["stripe_connect_payouts_enabled"] = bool(getattr(account, "payouts_enabled", False))
    lookup["stripe_connect_details_submitted"] = bool(getattr(account, "details_submitted", False))
    _save_user_updates(lookup)

    return {
        "ok": True,
        "connected": True,
        "account_id": account_id,
        "charges_enabled": lookup["stripe_connect_charges_enabled"],
        "payouts_enabled": lookup["stripe_connect_payouts_enabled"],
        "details_submitted": lookup["stripe_connect_details_submitted"],
    }


@router.post("/create-checkout-session")
def create_checkout_session(
    payload: CheckoutSessionRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()

    plan = str(payload.plan or "").strip().lower()
    if plan not in {"pro_vendor", "enterprise_organizer"}:
        raise HTTPException(status_code=400, detail="Unsupported plan")

    price_id = _plan_to_price_id(plan)

    if plan == "pro_vendor" and str(user.get("role") or "").strip().lower() != "vendor":
        raise HTTPException(status_code=403, detail="Pro Vendor checkout is only for vendor accounts")

    if plan == "enterprise_organizer" and str(user.get("role") or "").strip().lower() != "organizer":
        raise HTTPException(status_code=403, detail="Enterprise Organizer checkout is only for organizer accounts")

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    session_kwargs = {
        "mode": "subscription",
        "success_url": payload.success_url,
        "cancel_url": payload.cancel_url,
        "line_items": [{"price": price_id, "quantity": 1}],
        "client_reference_id": str(lookup.get("id")),
        "metadata": {
            "user_id": str(lookup.get("id")),
            "email": str(lookup.get("email") or ""),
            "plan": plan,
            "role": str(lookup.get("role") or ""),
            "platform_fee_policy": "paid_subscribers_3_percent_otherwise_5_percent",
        },
        "subscription_data": {
            "metadata": {
                "user_id": str(lookup.get("id")),
                "email": str(lookup.get("email") or ""),
                "plan": plan,
                "role": str(lookup.get("role") or ""),
                "platform_fee_policy": "paid_subscribers_3_percent_otherwise_5_percent",
            }
        },
        "allow_promotion_codes": True,
    }

    existing_customer_id = str(lookup.get("stripe_customer_id") or "").strip()
    if existing_customer_id:
        session_kwargs["customer"] = existing_customer_id
    else:
        session_kwargs["customer_email"] = str(lookup.get("email") or "")

    try:
        session = stripe_sdk.checkout.Session.create(**session_kwargs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe checkout session failed: {exc}")

    return {"ok": True, "url": session.url, "session_id": session.id}


@router.post("/create-portal-session")
def create_portal_session(
    payload: PortalSessionRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    customer_id = str(lookup.get("stripe_customer_id") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer found for this account")

    try:
        session = stripe_sdk.billing_portal.Session.create(
            customer=customer_id,
            return_url=payload.return_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe billing portal failed: {exc}")

    return {"ok": True, "url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    stripe_sdk = _require_stripe()

    webhook_secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not webhook_secret:
        raise HTTPException(status_code=500, detail="STRIPE_WEBHOOK_SECRET is not set")

    payload = await request.body()
    signature = request.headers.get("stripe-signature")

    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature header")

    try:
        event = stripe_sdk.Webhook.construct_event(payload, signature, webhook_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Stripe webhook: {exc}")

    event_type = str(getattr(event, "type", "") or "")

    event_data = getattr(event, "data", None)
    if event_data is None and isinstance(event, dict):
        event_data = event.get("data")

    data_object = getattr(event_data, "object", None)
    if data_object is None and isinstance(event_data, dict):
        data_object = event_data.get("object")

    if data_object is None:
        data_object = {}

    if event_type == "checkout.session.completed":
        try:
            metadata = _extract_metadata(data_object)
            payment_type = str(metadata.get("payment_type") or "").strip().lower()

            session_id = str(getattr(data_object, "id", None) or "").strip() or None
            customer_id = str(getattr(data_object, "customer", None) or "").strip() or None
            subscription_id = str(getattr(data_object, "subscription", None) or "").strip() or None
            payment_intent_id = str(getattr(data_object, "payment_intent", None) or "").strip() or None
            amount_total = getattr(data_object, "amount_total", None)

            if isinstance(data_object, dict):
                session_id = str(data_object.get("id") or "").strip() or session_id
                customer_id = str(data_object.get("customer") or "").strip() or customer_id
                subscription_id = str(data_object.get("subscription") or "").strip() or subscription_id
                payment_intent_id = str(data_object.get("payment_intent") or "").strip() or payment_intent_id
                amount_total = data_object.get("amount_total", amount_total)

            is_verification_payment = (
    payment_type == "verification_fee"
    or str(metadata.get("verification") or "").strip().lower() == "true"
)

if is_verification_payment:
                email = str(metadata.get("email") or "").strip().lower()
                role = str(metadata.get("role") or "").strip().lower()
                verification_id = metadata.get("verification_id")

                from app.store import _VERIFICATIONS, save_store

                matched = None

                for vid, existing_record in _VERIFICATIONS.items():
                    if not isinstance(existing_record, dict):
                        continue

                    if (
                        str(existing_record.get("email") or "").strip().lower() == email
                        and str(existing_record.get("role") or "").strip().lower() == role
                    ):
                        matched = existing_record
                        break

                if not matched:
                    valid_ids = []
                    for key in _VERIFICATIONS.keys():
                        try:
                            valid_ids.append(int(key))
                        except Exception:
                            continue

                    new_id = max(valid_ids or [0]) + 1

                    matched = {
                        "id": new_id,
                        "email": email,
                        "role": role,
                        "status": "not_submitted",
                        "payment_status": "paid",
                        "fee_paid": True,
                        "paid_at": datetime.now(timezone.utc).isoformat(),
                        "submitted_at": None,
                        "reviewed_at": None,
                        "reviewed_by": None,
                        "notes": "",
                        "documents": [],
                        "fee_amount": 49 if role == "organizer" else 25,
                        "expiration_date": None,
                    }

                    _VERIFICATIONS[new_id] = matched
                    print("🆕 CREATED verification record:", email, role)

                else:
                    matched["payment_status"] = "paid"
                    matched["fee_paid"] = True
                    matched["paid_at"] = datetime.now(timezone.utc).isoformat()
                    print("✅ UPDATED verification record:", email, role)

                if session_id:
                    matched["stripe_session_id"] = session_id
                if payment_intent_id:
                    matched["stripe_payment_intent_id"] = payment_intent_id
                if amount_total not in (None, ""):
                    try:
                        matched["amount_paid"] = round(float(amount_total) / 100, 2)
                    except Exception:
                        matched["amount_paid"] = amount_total

                save_store()

                return {"received": True, "event_type": event_type}

            user = _find_user_from_checkout_session(data_object)

            if user:
                _set_customer_fields(user, customer_id=customer_id, subscription_id=subscription_id)
                _save_user_updates(user)

                if subscription_id:
                    try:
                        subscription = stripe_sdk.Subscription.retrieve(subscription_id)
                        price_id = _extract_subscription_price_id(subscription)
                        plan = _price_id_to_plan(price_id)

                        if plan and plan != "starter":
                            _apply_subscription_state(
                                user,
                                plan=plan,
                                subscription_status=str(getattr(subscription, "status", None) or "active"),
                                customer_id=customer_id,
                                subscription_id=subscription_id,
                                current_period_end=getattr(subscription, "current_period_end", None),
                                cancel_at_period_end=bool(getattr(subscription, "cancel_at_period_end", False)),
                            )
                    except Exception as exc:
                        print("🔥 SUBSCRIPTION LOOKUP ERROR:", str(exc))
                else:
                    plan = str(metadata.get("plan") or "").strip().lower()

                    if plan:
                        _apply_subscription_state(
                            user,
                            plan=plan,
                            subscription_status="active",
                            customer_id=customer_id,
                            subscription_id=subscription_id,
                            current_period_end=None,
                            cancel_at_period_end=False,
                        )
            else:
                print("⚠️ No user found for checkout session")
        except Exception as exc:
            print("🔥 WEBHOOK ERROR (checkout.session.completed):", str(exc))

    elif event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        try:
            success = _sync_from_subscription_object(data_object)
            if not success:
                print("⚠️ Subscription sync failed (no user match)")
        except Exception as exc:
            print("🔥 WEBHOOK ERROR (subscription):", str(exc))

    return {"received": True, "event_type": event_type}
