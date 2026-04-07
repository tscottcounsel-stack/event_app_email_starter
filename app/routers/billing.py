from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from app.routers.auth import _USERS, _USERS_BY_EMAIL, _persist_users, get_current_user

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


def _set_customer_fields(user: Dict[str, Any], *, customer_id: Optional[str], subscription_id: Optional[str]) -> None:
    if customer_id:
        user["stripe_customer_id"] = customer_id
    if subscription_id:
        user["stripe_subscription_id"] = subscription_id


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

        user_id = metadata.get("user_id")
        if user_id:
            user = _lookup_user(user_id=user_id)
            if user:
                return user

        email = getattr(session, "customer_email", None)
        if not email and isinstance(session, dict):
            email = session.get("customer_email")

        if not email:
            email = metadata.get("email")

        if email:
            return _lookup_user(email=email)

        return None
    except Exception as exc:
        print("🔥 USER LOOKUP ERROR:", str(exc))
        return None


def _sync_from_subscription_object(subscription: Any) -> bool:
    metadata = _extract_metadata(subscription)

    customer_id = str(getattr(subscription, "customer", None) or metadata.get("customer") or "").strip() or None
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


@router.post("/create-checkout-session")
def create_checkout_session(payload: CheckoutSessionRequest, user: dict = Depends(get_current_user)):
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
        },
        "subscription_data": {
            "metadata": {
                "user_id": str(lookup.get("id")),
                "email": str(lookup.get("email") or ""),
                "plan": plan,
                "role": str(lookup.get("role") or ""),
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
def create_portal_session(payload: PortalSessionRequest, user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    customer_id = str(lookup.get("stripe_customer_id") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer found for this account")

    try:
        session = stripe_sdk.billing_portal.Session.create(customer=customer_id, return_url=payload.return_url)
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
            user = _find_user_from_checkout_session(data_object)

            customer_id = str(getattr(data_object, "customer", None) or "").strip() or None
            subscription_id = str(getattr(data_object, "subscription", None) or "").strip() or None

            if isinstance(data_object, dict):
                customer_id = str(data_object.get("customer") or "").strip() or customer_id
                subscription_id = str(data_object.get("subscription") or "").strip() or subscription_id

            if user:
                _set_customer_fields(user, customer_id=customer_id, subscription_id=subscription_id)
                _save_user_updates(user)

                if subscription_id:
                    try:
                        subscription = stripe_sdk.Subscription.retrieve(subscription_id)
                        price_id = _extract_subscription_price_id(subscription)
                        plan = _price_id_to_plan(price_id)

                        if plan and plan != "starter":
                            user["plan"] = plan
                            user["subscription_status"] = "active"
                            _save_user_updates(user)
                    except Exception as exc:
                        print("🔥 SUBSCRIPTION LOOKUP ERROR:", str(exc))
                else:
                    metadata = _extract_metadata(data_object)
                    plan = str(metadata.get("plan") or "").strip().lower()

                    if plan:
                        user["plan"] = plan
                        user["subscription_status"] = "active"
                        _save_user_updates(user)
            else:
                print("⚠️ No user found for checkout session")
        except Exception as exc:
            print("🔥 WEBHOOK ERROR (checkout.session.completed):", str(exc))

    elif event_type in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
        try:
            success = _sync_fr# app/routers/billing.py

import os
import stripe
from fastapi import APIRouter, Request, HTTPException

router = APIRouter()

# ... keep your existing Stripe setup, helpers, and router config ...

def _price_id_to_plan(price_id: str | None) -> str | None:
    if not price_id:
        return None

    price_map = {
        os.getenv("STRIPE_PRICE_STARTER", ""): "starter",
        os.getenv("STRIPE_PRICE_PRO_ORGANIZER", ""): "pro_organizer",
        os.getenv("STRIPE_PRICE_ENTERPRISE_ORGANIZER", ""): "enterprise_organizer",
        os.getenv("STRIPE_PRICE_PRO_VENDOR", ""): "pro_vendor",
        os.getenv("STRIPE_PRICE_ENTERPRISE_VENDOR", ""): "enterprise_vendor",
    }

    return price_map.get(price_id)


def _apply_subscription_plan_to_user(user: dict, subscription_obj) -> None:
    """
    Canonical subscription -> price_id -> plan sync.
    Accepts either a Stripe Subscription object or dict-like payload.
    """
    if not user or not subscription_obj:
        return

    items = subscription_obj.get("items", {}).get("data", [])
    if not items:
        print("🔥 SUB LOOKUP ERROR: subscription has no items.data")
        return

    first_item = items[0] or {}
    price = first_item.get("price") or {}
    price_id = price.get("id")

    if not price_id:
        print("🔥 SUB LOOKUP ERROR: missing subscription item price.id")
        return

    plan = _price_id_to_plan(price_id)

    if not plan:
        print(f"🔥 SUB LOOKUP ERROR: unmapped price_id={price_id}")
        return

    sub_status = subscription_obj.get("status") or "active"

    user["plan"] = plan
    user["stripe_subscription_id"] = subscription_obj.get("id") or user.get("stripe_subscription_id")
    user["subscription_status"] = "active" if sub_status in {"active", "trialing"} else sub_status

    _save_user_updates(user)

    print(
        f"✅ SUB PLAN SYNC: email={user.get('email')} "
        f"price_id={price_id} plan={plan} status={user['subscription_status']}"
    )


@router.post("/billing/webhook")
async def billing_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except Exception as e:
        print("🔥 WEBHOOK VERIFY ERROR:", str(e))
        raise HTTPException(status_code=400, detail="Invalid webhook")

    event_type = event["type"]
    data = event["data"]["object"]

    try:
        # ------------------------------------------------------------------
        # 1) checkout.session.completed
        # ------------------------------------------------------------------
        if event_type == "checkout.session.completed":
            customer_id = data.get("customer")
            subscription_id = data.get("subscription")

            # Keep your existing user lookup logic if it already works.
            # Prefer customer_id if that is what already matches correctly in your app.
            user = None

            if customer_id:
                user = _find_user_by_stripe_customer_id(customer_id)

            if not user:
                # Optional fallback if you already store email / metadata
                session_email = data.get("customer_details", {}).get("email") or data.get("customer_email")
                if session_email:
                    user = _find_user_by_email(session_email)

            if user and customer_id and not user.get("stripe_customer_id"):
                user["stripe_customer_id"] = customer_id
                _save_user_updates(user)

            if user and subscription_id:
                user["stripe_subscription_id"] = subscription_id
                _save_user_updates(user)

            # CORE FIX: retrieve subscription, resolve price_id, map plan, save active state
            if user and subscription_id:
                try:
                    subscription = stripe.Subscription.retrieve(subscription_id)
                    print("🔎 CHECKOUT SUBSCRIPTION:", subscription)
                    _apply_subscription_plan_to_user(user, subscription)
                except Exception as e:
                    print("🔥 SUB LOOKUP ERROR:", str(e))

        # ------------------------------------------------------------------
        # 2) customer.subscription.created / updated
        # Stripe recommends using customer.subscription events to track
        # subscription lifecycle changes.
        # ------------------------------------------------------------------
        elif event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
        }:
            subscription = data
            customer_id = subscription.get("customer")

            user = None
            if customer_id:
                user = _find_user_by_stripe_customer_id(customer_id)

            if user:
                _apply_subscription_plan_to_user(user, subscription)

        # ------------------------------------------------------------------
        # 3) customer.subscription.deleted
        # ------------------------------------------------------------------
        elif event_type == "customer.subscription.deleted":
            subscription = data
            customer_id = subscription.get("customer")

            user = None
            if customer_id:
                user = _find_user_by_stripe_customer_id(customer_id)

            if user:
                user["subscription_status"] = "canceled"
                # Keep existing plan or downgrade here if that is your intended logic
                _save_user_updates(user)
                print(f"✅ SUB CANCELED: email={user.get('email')}")

    except Exception as e:
        print("🔥 WEBHOOK HANDLER ERROR:", str(e))

    return {"received": True}om_subscription_object(data_object)
            if not success:
                print("⚠️ Subscription sync failed (no user match)")
        except Exception as exc:
            print("🔥 WEBHOOK ERROR (subscription):", str(exc))

    return {"received": True, "event_type": event_type}
