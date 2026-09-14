from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import get_current_user


router = APIRouter(prefix="/admin", tags=["admin"])


def _safe_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")
    if _safe_lower(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class ComplimentaryAccessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    role: str
    enabled: bool
    reason: str | None = None


def _effective_plan_for_role(role: str) -> str:
    normalized = _safe_lower(role)
    if normalized == "organizer":
        return "enterprise_organizer"
    if normalized == "vendor":
        return "pro_vendor"
    raise HTTPException(status_code=400, detail="Complimentary access supports vendor and organizer accounts only.")


def _profile_data(profile: Profile) -> Dict[str, Any]:
    return dict(profile.data) if isinstance(profile.data, dict) else {}


def _grant_payload(profile: Profile) -> Dict[str, Any]:
    data = _profile_data(profile)
    enabled = data.get("complimentary_access") is True
    role = _safe_lower(profile.role)
    return {
        "email": _safe_lower(profile.email),
        "role": role,
        "enabled": enabled,
        "access_source": "complimentary" if enabled else "standard",
        "effective_plan": _effective_plan_for_role(role) if enabled else (
            profile.subscription_plan or data.get("complimentary_original_plan") or "starter"
        ),
        "reason": data.get("complimentary_access_reason"),
        "granted_at": data.get("complimentary_access_granted_at"),
        "granted_by": data.get("complimentary_access_granted_by"),
        "revoked_at": data.get("complimentary_access_revoked_at"),
        "revoked_by": data.get("complimentary_access_revoked_by"),
    }


@router.get("/complimentary-access")
def admin_list_complimentary_access(
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    profiles = (
        db.query(Profile)
        .filter(Profile.role.in_(["vendor", "organizer"]))
        .order_by(Profile.updated_at.desc())
        .all()
    )

    grants = []
    for profile in profiles:
        data = _profile_data(profile)
        if data.get("complimentary_access") is True:
            grants.append(_grant_payload(profile))

    return {"ok": True, "grants": grants}


@router.put("/complimentary-access")
def admin_set_complimentary_access(
    payload: ComplimentaryAccessRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    email = _safe_lower(payload.email)
    role = _safe_lower(payload.role)

    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    if role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")

    profile = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == email, Profile.role == role)
        .one_or_none()
    )

    if profile is None:
        profile = Profile(email=email, role=role)
        db.add(profile)
        db.flush()

    data = _profile_data(profile)
    now = _utc_now_iso()
    admin_email = _safe_lower(user.get("email"))
    effective_plan = _effective_plan_for_role(role)

    if payload.enabled:
        # Preserve the real billing/access state so revoke restores it cleanly.
        if data.get("complimentary_access") is not True:
            data["complimentary_original_plan"] = (
                profile.subscription_plan
                or data.get("subscription_plan")
                or data.get("plan")
                or "starter"
            )
            data["complimentary_original_status"] = (
                profile.subscription_status
                or data.get("subscription_status")
                or data.get("subscriptionStatus")
                or "inactive"
            )
            data["complimentary_original_visibility_tier"] = (
                profile.visibility_tier
                or data.get("visibility_tier")
                or data.get("visibilityTier")
                or None
            )

        # Existing VendCore gates already trust plan + active status.
        # This grants full product access without creating a Stripe subscription.
        profile.subscription_plan = effective_plan
        profile.subscription_status = "active"
        profile.visibility_tier = profile.visibility_tier or "premium"

        data.update({
            "complimentary_access": True,
            "complimentary_access_level": "full",
            "complimentary_access_reason": str(payload.reason or "").strip() or None,
            "complimentary_access_granted_at": now,
            "complimentary_access_granted_by": admin_email,
            "complimentary_access_revoked_at": None,
            "complimentary_access_revoked_by": None,
            "access_source": "complimentary",
            "billing_exempt": True,
            "plan": effective_plan,
            "subscription_plan": effective_plan,
            "subscriptionPlan": effective_plan,
            "subscription_status": "active",
            "subscriptionStatus": "active",
            "visibility_tier": profile.visibility_tier,
            "visibilityTier": profile.visibility_tier,
        })
    else:
        original_plan = str(data.get("complimentary_original_plan") or "starter").strip().lower() or "starter"
        original_status = str(data.get("complimentary_original_status") or "inactive").strip().lower() or "inactive"
        original_visibility = data.get("complimentary_original_visibility_tier")

        profile.subscription_plan = original_plan
        profile.subscription_status = original_status
        profile.visibility_tier = original_visibility

        data.update({
            "complimentary_access": False,
            "complimentary_access_level": None,
            "complimentary_access_reason": None,
            "complimentary_access_revoked_at": now,
            "complimentary_access_revoked_by": admin_email,
            "access_source": "billing" if original_plan != "starter" else "standard",
            "billing_exempt": False,
            "plan": original_plan,
            "subscription_plan": original_plan,
            "subscriptionPlan": original_plan,
            "subscription_status": original_status,
            "subscriptionStatus": original_status,
            "visibility_tier": original_visibility,
            "visibilityTier": original_visibility,
        })

    profile.data = data
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return {
        "ok": True,
        "grant": _grant_payload(profile),
        "message": (
            "Complimentary full access granted."
            if payload.enabled
            else "Complimentary access revoked and previous plan restored."
        ),
    }
