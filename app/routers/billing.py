from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func

from app.db import SessionLocal
from app.models.profile import Profile
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


class ConfirmCheckoutSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_id: str


class ConnectOnboardingLinkRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    account_id: Optional[str] = None
    refresh_url: str
    return_url: str


def _get_profile_for_user(user: Dict[str, Any]) -> Optional[Profile]:
    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()
    if not email or role not in {"vendor", "organizer"} or SessionLocal is None:
        return None

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email, Profile.role == role)
            .order_by(Profile.updated_at.desc())
            .first()
        )
        if profile is None:
            profile = Profile(email=email, role=role)
            db.add(profile)
            db.commit()
            db.refresh(profile)
        db.expunge(profile)
        return profile
    except Exception as exc:
        db.rollback()
        print("⚠️ Stripe Connect profile lookup skipped:", str(exc))
        return None
    finally:
        db.close()


def _get_connect_account_id(user: Dict[str, Any]) -> str:
    direct = str(
        user.get("stripe_connect_account_id")
        or user.get("stripe_account_id")
        or user.get("stripeAccountId")
        or ""
    ).strip()
    if direct:
        return direct

    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()
    if not email or SessionLocal is None:
        return ""

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email, Profile.role == role)
            .order_by(Profile.updated_at.desc())
            .first()
        )
        if not profile:
            return ""
        data = profile.data if isinstance(profile.data, dict) else {}
        return str(
            data.get("stripe_connect_account_id")
            or data.get("stripe_account_id")
            or data.get("stripeAccountId")
            or ""
        ).strip()
    except Exception as exc:
        print("⚠️ Stripe Connect account lookup skipped:", str(exc))
        return ""
    finally:
        db.close()


def _save_connect_account_id(user: Dict[str, Any], account_id: str) -> None:
    clean = str(account_id or "").strip()
    if not clean:
        return

    user["stripe_connect_account_id"] = clean
    user["stripe_account_id"] = clean

    try:
        _save_user_updates(user)
    except Exception as exc:
        print("⚠️ Auth user Stripe Connect sync skipped:", str(exc))

    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()
    if not email or role not in {"vendor", "organizer"} or SessionLocal is None:
        return

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email, Profile.role == role)
            .one_or_none()
        )
        if profile is None:
            profile = Profile(email=email, role=role)
            db.add(profile)

        data = profile.data if isinstance(profile.data, dict) else {}
        profile.data = {
            **data,
            "stripe_connect_account_id": clean,
            "stripe_account_id": clean,
            "stripe_connect_status": data.get("stripe_connect_status") or "created",
            "stripe_connect_updated_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        db.commit()
    except Exception as exc:
        db.rollback()
        print("⚠️ Profile Stripe Connect sync skipped:", str(exc))
    finally:
        db.close()


def _stripe_connect_account_status(account: Any) -> Dict[str, Any]:
    return {
        "charges_enabled": bool(_stripe_get(account, "charges_enabled", False)),
        "payouts_enabled": bool(_stripe_get(account, "payouts_enabled", False)),
        "details_submitted": bool(_stripe_get(account, "details_submitted", False)),
        "requirements_due": list((_stripe_get(_stripe_get(account, "requirements", {}) or {}, "currently_due", []) or [])),
    }


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


def _profile_user_from_postgres(*, email: Optional[str] = None, role: Optional[str] = None) -> Optional[Dict[str, Any]]:
    normalized_email = str(email or "").strip().lower()
    normalized_role = str(role or "").strip().lower()
    if not normalized_email or SessionLocal is None:
        return None

    db = SessionLocal()
    try:
        query = db.query(Profile).filter(func.lower(Profile.email) == normalized_email)
        if normalized_role in {"vendor", "organizer"}:
            query = query.filter(Profile.role == normalized_role)
        profile = query.order_by(Profile.updated_at.desc()).first()
        if profile is None:
            return None

        data = profile.data if isinstance(profile.data, dict) else {}
        plan = str(profile.subscription_plan or data.get("subscription_plan") or data.get("plan") or "starter").strip().lower()
        status_value = str(profile.subscription_status or data.get("subscription_status") or data.get("subscriptionStatus") or "inactive").strip().lower()
        user: Dict[str, Any] = {
            "id": data.get("user_id") or data.get("id"),
            "email": normalized_email,
            "role": profile.role,
            "full_name": data.get("full_name") or data.get("contactName") or data.get("contact_name"),
            "plan": plan,
            "subscription_plan": plan,
            "subscription_status": status_value,
            "subscriptionStatus": status_value,
            "visibility_tier": profile.visibility_tier or data.get("visibility_tier") or data.get("visibilityTier"),
            "featured": bool(profile.featured or data.get("featured")),
            "promoted": bool(profile.promoted or data.get("promoted")),
        }
        for key in ("stripe_customer_id", "stripe_subscription_id", "current_period_end", "cancel_at_period_end"):
            if data.get(key) not in (None, ""):
                user[key] = data.get(key)
        return user
    except Exception as exc:
        print("⚠️ Billing profile lookup skipped:", str(exc))
        return None
    finally:
        db.close()


def _lookup_user(*, user_id: Any = None, email: Optional[str] = None, role: Optional[str] = None) -> Optional[Dict[str, Any]]:
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

    return _profile_user_from_postgres(email=email, role=role)


def _sync_profile_subscription_from_user(user: Dict[str, Any]) -> None:
    """Mirror billing subscription state into the persistent Profile row.

    The auth user JSON is still used for login/session data, but marketplace
    status badges and admin tools read Profile from Postgres. This function keeps
    those two layers aligned without touching verification fields.
    """
    email = str(user.get("email") or "").strip().lower()
    role = str(user.get("role") or "").strip().lower()

    if not email or role not in {"vendor", "organizer"} or SessionLocal is None:
        return

    plan = str(user.get("plan") or "starter").strip().lower()
    status = str(user.get("subscription_status") or "inactive").strip().lower()
    is_active_paid = status in {"active", "trialing", "paid"}
    is_premium_plan = (
        (role == "vendor" and plan == "pro_vendor")
        or (role == "organizer" and plan == "enterprise_organizer")
        or any(token in plan for token in ["premium", "pro", "growth", "enterprise"])
    )

    db = SessionLocal()
    try:
        profile = (
            db.query(Profile)
            .filter(func.lower(Profile.email) == email, Profile.role == role)
            .one_or_none()
        )

        if profile is None:
            profile = Profile(email=email, role=role)
            db.add(profile)

        existing_data = profile.data if isinstance(profile.data, dict) else {}
        subscription_data = {
            "email": email,
            "plan": plan,
            "subscription_plan": plan,
            "subscription_status": status,
            "subscriptionStatus": status,
        }
        for key in (
            "id",
            "user_id",
            "stripe_customer_id",
            "stripe_subscription_id",
            "current_period_end",
            "cancel_at_period_end",
        ):
            source_key = "id" if key == "user_id" else key
            value = user.get(source_key)
            if value not in (None, ""):
                subscription_data[key] = value
        profile.data = {**existing_data, **subscription_data}
        profile.subscription_plan = plan
        profile.subscription_status = status

        if is_active_paid and is_premium_plan:
            profile.visibility_tier = "premium"
            profile.featured = True
            profile.promoted = True

        db.commit()
    except Exception as exc:
        db.rollback()
        print("⚠️ Profile subscription sync skipped:", str(exc))
    finally:
        db.close()

def _save_user_updates(user: Dict[str, Any]) -> None:
    user["updated_at"] = int(datetime.now(tz=timezone.utc).timestamp())
    _persist_users()
    _sync_profile_subscription_from_user(user)


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


def _is_verification_checkout(metadata: Dict[str, Any]) -> bool:
    payment_type = str(metadata.get("payment_type") or "").strip().lower()
    verification_flag = str(metadata.get("verification") or "").strip().lower()
    return payment_type == "verification_fee" or verification_flag == "true"


def _mark_verification_checkout_paid(session: Any) -> bool:
    """Route verification-fee Stripe events to verifications.py, not subscription billing.

    This prevents a one-time verification payment from being treated as a paid
    subscription and accidentally granting premium vendor/organizer placement.
    """
    metadata = _extract_metadata(session)
    if not _is_verification_checkout(metadata):
        return False

    email = str(metadata.get("email") or "").strip().lower()
    role = str(metadata.get("role") or "vendor").strip().lower()
    if role not in {"vendor", "organizer"}:
        role = "vendor"

    if not email:
        customer_details = _stripe_get(session, "customer_details", {}) or {}
        if isinstance(customer_details, dict):
            email = str(customer_details.get("email") or "").strip().lower()
        else:
            email = str(getattr(customer_details, "email", "") or "").strip().lower()

    if not email:
        print("⚠️ Verification checkout ignored: missing email metadata")
        return True

    payment_status = str(_stripe_get(session, "payment_status", "") or "").strip().lower()
    session_status = str(_stripe_get(session, "status", "") or "").strip().lower()
    if payment_status != "paid" and session_status != "complete":
        print("⚠️ Verification checkout not complete yet", {"payment_status": payment_status, "status": session_status})
        return True

    session_id = str(_stripe_get(session, "id", "") or "").strip()
    payment_intent_id = str(_stripe_get(session, "payment_intent", "") or "").strip()
    amount_paid = _stripe_get(session, "amount_total", None)

    try:
        from app.routers.verifications import mark_verification_paid

        mark_verification_paid(
            email=email,
            role=role,
            stripe_session_id=session_id,
            stripe_payment_intent_id=payment_intent_id,
            amount_paid=amount_paid,
        )
        print("✅ Verification payment synced without granting premium", {"email": email, "role": role, "session_id": session_id})
    except Exception as exc:
        print("🔥 Verification checkout sync failed:", str(exc))

    return True


def _find_user_from_checkout_session(session: Any) -> Optional[Dict[str, Any]]:
    try:
        metadata = _extract_metadata(session)

        client_reference_id = getattr(session, "client_reference_id", None)
        if client_reference_id is None and isinstance(session, dict):
            client_reference_id = session.get("client_reference_id")

        if client_reference_id:
            user = _lookup_user(user_id=client_reference_id, role=metadata.get("role"))
            if user:
                return user

        user_id = metadata.get("user_id")
        if user_id:
            user = _lookup_user(user_id=user_id, role=metadata.get("role"))
            if user:
                return user

        email = getattr(session, "customer_email", None)
        if not email and isinstance(session, dict):
            email = session.get("customer_email")

        if not email:
            customer_details = getattr(session, "customer_details", None)
            if customer_details is None and isinstance(session, dict):
                customer_details = session.get("customer_details") or {}

            if isinstance(customer_details, dict):
                email = customer_details.get("email")
            else:
                email = getattr(customer_details, "email", None)

        if not email:
            email = metadata.get("email")

        if email:
            user = _lookup_user(email=email, role=metadata.get("role"))
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

    user = _lookup_user(user_id=metadata.get("user_id"), email=metadata.get("email"), role=metadata.get("role"))

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


def _stripe_get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _ensure_success_url_has_session_id(url: str) -> str:
    clean = str(url or "").strip()
    if not clean or "{CHECKOUT_SESSION_ID}" in clean:
        return clean
    separator = "&" if "?" in clean else "?"
    return f"{clean}{separator}upgrade=success&session_id={{CHECKOUT_SESSION_ID}}"


def _normalize_subscription_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status in {"active", "trialing"}:
        return status
    if status == "paid":
        return "active"
    if status in {"past_due", "unpaid", "canceled", "cancelled", "incomplete_expired", "inactive"}:
        return "inactive"
    return status or "inactive"


def _apply_checkout_session_to_user(session: Any, *, user_hint: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    stripe_sdk = _require_stripe()
    metadata = _extract_metadata(session)
    if _is_verification_checkout(metadata):
        _mark_verification_checkout_paid(session)
        raise HTTPException(status_code=400, detail="This checkout session is for verification, not a subscription upgrade")

    payment_status = str(_stripe_get(session, "payment_status", "") or "").strip().lower()
    session_status = str(_stripe_get(session, "status", "") or "").strip().lower()
    if payment_status not in {"paid", "no_payment_required"} and session_status != "complete":
        raise HTTPException(status_code=400, detail="Stripe checkout is not complete yet")

    user = user_hint or _find_user_from_checkout_session(session)
    if user is None:
        raise HTTPException(status_code=404, detail="Could not match Stripe checkout to a VendCore account")

    customer_id = str(_stripe_get(session, "customer", "") or "").strip() or None
    subscription_id = str(_stripe_get(session, "subscription", "") or "").strip() or None
    plan = str(metadata.get("plan") or user.get("plan") or "starter").strip().lower()
    subscription_status = "active"
    current_period_end = None
    cancel_at_period_end = False

    if subscription_id:
        try:
            subscription = stripe_sdk.Subscription.retrieve(subscription_id)
            price_id = _extract_subscription_price_id(subscription)
            plan = _price_id_to_plan(price_id) or plan
            subscription_status = _normalize_subscription_status(_stripe_get(subscription, "status", "active"))
            current_period_end = _stripe_get(subscription, "current_period_end", None)
            cancel_at_period_end = bool(_stripe_get(subscription, "cancel_at_period_end", False))
            customer_id = str(_stripe_get(subscription, "customer", "") or customer_id or "").strip() or customer_id
        except Exception as exc:
            print("🔥 SUBSCRIPTION LOOKUP ERROR:", str(exc))

    if plan == "starter":
        metadata_plan = str(metadata.get("plan") or "").strip().lower()
        if metadata_plan in {"pro_vendor", "enterprise_organizer"}:
            plan = metadata_plan
        elif str(user.get("role") or "").strip().lower() == "organizer":
            plan = "enterprise_organizer"
        elif str(user.get("role") or "").strip().lower() == "vendor":
            plan = "pro_vendor"

    _apply_subscription_state(
        user,
        plan=plan,
        subscription_status=subscription_status,
        customer_id=customer_id,
        subscription_id=subscription_id,
        current_period_end=current_period_end,
        cancel_at_period_end=cancel_at_period_end,
    )

    return {
        "ok": True,
        "plan": user.get("plan"),
        "subscription_plan": user.get("subscription_plan") or user.get("plan"),
        "subscription_status": user.get("subscription_status"),
        "subscriptionStatus": user.get("subscriptionStatus") or user.get("subscription_status"),
        "stripe_customer_id": user.get("stripe_customer_id"),
        "stripe_subscription_id": user.get("stripe_subscription_id"),
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

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"), role=user.get("role"))
    if lookup is None:
        raise HTTPException(status_code=404, detail="Account not found")

    session_kwargs = {
        "mode": "subscription",
        "success_url": _ensure_success_url_has_session_id(payload.success_url),
        "cancel_url": payload.cancel_url,
        "line_items": [{"price": price_id, "quantity": 1}],
        "client_reference_id": str(lookup.get("id")),
        "metadata": {
            "payment_type": "subscription",
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


@router.post("/confirm-checkout-session")
def confirm_checkout_session(
    payload: ConfirmCheckoutSessionRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()
    session_id = str(payload.session_id or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe checkout lookup failed: {exc}")

    metadata = _extract_metadata(session)
    session_email = str(metadata.get("email") or _stripe_get(session, "customer_email", "") or "").strip().lower()
    current_email = str(user.get("email") or "").strip().lower()
    if session_email and current_email and session_email != current_email:
        raise HTTPException(status_code=403, detail="This checkout session belongs to a different account")

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"), role=user.get("role")) or user
    return _apply_checkout_session_to_user(session, user_hint=lookup)


@router.post("/create-portal-session")
def create_portal_session(
    payload: PortalSessionRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()

    lookup = _lookup_user(user_id=user.get("id"), email=user.get("email"), role=user.get("role"))
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




@router.get("/connect/status")
def get_connect_status(user: dict = Depends(get_current_user)):
    account_id = _get_connect_account_id(user)
    if not account_id:
        return {"ok": True, "connected": False, "account_id": None}

    stripe_sdk = _require_stripe()
    try:
        account = stripe_sdk.Account.retrieve(account_id)
        return {
            "ok": True,
            "connected": True,
            "account_id": account_id,
            **_stripe_connect_account_status(account),
        }
    except Exception as exc:
        return {
            "ok": True,
            "connected": False,
            "account_id": account_id,
            "error": str(exc),
        }


@router.post("/connect/account")
def create_connect_account(user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()
    role = str(user.get("role") or "").strip().lower()
    if role not in {"organizer", "admin"}:
        raise HTTPException(status_code=403, detail="Stripe Connect setup is only available to organizer accounts")

    existing = _get_connect_account_id(user)
    if existing:
        try:
            account = stripe_sdk.Account.retrieve(existing)
            return {
                "ok": True,
                "account_id": existing,
                "accountId": existing,
                "connected": True,
                **_stripe_connect_account_status(account),
            }
        except Exception:
            # Continue and create a fresh Express account if the stored ID no longer exists.
            pass

    try:
        account = stripe_sdk.Account.create(
            type="express",
            email=str(user.get("email") or "").strip() or None,
            business_type="company",
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
            metadata={
                "vendcore_user_id": str(user.get("id") or ""),
                "vendcore_email": str(user.get("email") or ""),
                "vendcore_role": role,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe Connect account creation failed: {exc}")

    account_id = str(_stripe_get(account, "id", "") or "").strip()
    if not account_id:
        raise HTTPException(status_code=500, detail="Stripe did not return an account ID")

    _save_connect_account_id(user, account_id)

    return {
        "ok": True,
        "account_id": account_id,
        "accountId": account_id,
        "connected": True,
        **_stripe_connect_account_status(account),
    }


@router.post("/connect/onboarding-link")
def create_connect_onboarding_link(
    payload: ConnectOnboardingLinkRequest,
    user: dict = Depends(get_current_user),
):
    stripe_sdk = _require_stripe()

    account_id = str(payload.account_id or "").strip() or _get_connect_account_id(user)
    if not account_id:
        raise HTTPException(status_code=400, detail="Missing Stripe Connect account ID")

    if payload.account_id:
        _save_connect_account_id(user, account_id)

    try:
        link = stripe_sdk.AccountLink.create(
            account=account_id,
            refresh_url=payload.refresh_url,
            return_url=payload.return_url,
            type="account_onboarding",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe onboarding failed: {exc}")

    return {"ok": True, "url": link.url, "onboarding_url": link.url, "account_id": account_id}


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
            if _is_verification_checkout(metadata):
                _mark_verification_checkout_paid(data_object)
            else:
                subscription_id = str(_stripe_get(data_object, "subscription", "") or "").strip()
                if not subscription_id:
                    print("⚠️ Non-subscription checkout ignored by billing webhook")
                else:
                    user = _find_user_from_checkout_session(data_object)
                    if user:
                        _apply_checkout_session_to_user(data_object, user_hint=user)
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
