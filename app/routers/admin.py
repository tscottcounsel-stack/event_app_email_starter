from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import (
    admin_create_user,
    admin_delete_user,
    get_current_user,
    list_all_users,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminAccountCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    password: str
    role: str
    full_name: str | None = None
    username: str | None = None


class AdminProfilePremiumRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    role: str
    featured: bool = True
    promoted: bool | None = None



def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Inactive account")
    if str(user.get("role", "")).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def _profile_display_name(profile: Profile) -> str:
    data = profile.data if isinstance(profile.data, dict) else {}
    return (
        profile.business_name
        or profile.display_name
        or data.get("business_name")
        or data.get("businessName")
        or data.get("organizationName")
        or data.get("contactName")
        or profile.email
        or "Unknown"
    )


def _profile_to_pending_item(profile: Profile) -> Dict[str, Any]:
    data = profile.data if isinstance(profile.data, dict) else {}
    return {
        "id": profile.id,
        "profile_id": profile.id,
        "email": profile.email,
        "name": _profile_display_name(profile),
        "company_name": profile.business_name or data.get("businessName") or data.get("organizationName"),
        "role": profile.role,
        "status": profile.verification_status or profile.review_status or "pending",
        "verification_status": profile.verification_status,
        "public_verification_status": profile.public_verification_status,
        "review_status": profile.review_status,
        "submitted_at": data.get("submitted_at") or data.get("created_at") or profile.created_at.isoformat() if profile.created_at else None,
    }


def _profile_payload(profile: Profile) -> Dict[str, Any]:
    data = profile.data if isinstance(profile.data, dict) else {}
    return {
        "ok": True,
        "exists": True,
        "id": profile.id,
        "email": profile.email,
        "role": profile.role,
        "display_name": profile.display_name,
        "business_name": profile.business_name,
        "city": profile.city,
        "state": profile.state,
        "categories": profile.categories or [],
        "verified": bool(profile.verified),
        "verification_status": profile.verification_status,
        "public_verification_status": profile.public_verification_status,
        "public_verification_label": profile.public_verification_label,
        "review_status": profile.review_status,
        "visibility_tier": profile.visibility_tier,
        "subscription_plan": profile.subscription_plan,
        "subscription_status": profile.subscription_status,
        "featured": bool(profile.featured),
        "promoted": bool(profile.promoted),
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "profile": data,
    }


def _mark_profiles_deleted(
    *,
    db: Session,
    email: str,
    role: str | None = None,
    admin_email: str = "",
) -> int:
    """Soft-delete every matching profile/verification row for an account.

    Account deletion must clear the login record and also remove the profile from
    public/admin verification surfaces. We keep the row for audit/history, but
    force every verification/status field into a deleted state.
    """
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)
    if not normalized_email:
        return 0

    query = db.query(Profile).filter(func.lower(Profile.email) == normalized_email)
    if normalized_role in {"vendor", "organizer", "admin"}:
        query = query.filter(Profile.role == normalized_role)

    profiles = query.all()
    if not profiles:
        return 0

    now_iso = utc_now_iso()
    deleted_by = _safe_lower(admin_email)

    for profile in profiles:
        data = profile.data if isinstance(profile.data, dict) else {}

        profile.verified = False
        profile.verification_status = "deleted"
        profile.public_verification_status = "deleted"
        profile.public_verification_label = "Deleted"
        profile.review_status = "deleted"
        profile.featured = False
        profile.promoted = False
        profile.visibility_tier = "standard"

        profile.data = {
            **data,
            "email": normalized_email,
            "role": _safe_lower(profile.role or normalized_role),
            "verified": False,
            "is_verified": False,
            "status": "deleted",
            "verification_status": "deleted",
            "review_status": "deleted",
            "public_verification_status": "deleted",
            "public_verification_label": "Deleted",
            "featured": False,
            "promoted": False,
            "visibility_tier": "standard",
            "deleted_at": now_iso,
            "dismissed_at": now_iso,
            "deleted_by": deleted_by,
            "dismissed_by": deleted_by,
        }
        db.add(profile)

    db.commit()
    return len(profiles)


@router.get("/dashboard")
async def admin_dashboard(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    accounts = list_all_users()
    vendor_items = [u for u in accounts if _safe_lower(u.get("role")) == "vendor"]
    organizer_items = [u for u in accounts if _safe_lower(u.get("role")) == "organizer"]

    pending_candidates = (
        db.query(Profile)
        .filter(
            Profile.role.in_(["vendor", "organizer"]),
            Profile.verified.is_(False),
            func.lower(Profile.email) != "admin@example.com",
            ~func.lower(Profile.email).like("%@example.com"),
            func.lower(func.coalesce(Profile.review_status, "")).in_(
                ["pending", "renewal_pending", "submitted", "under_review"]
            ),
        )
        .order_by(Profile.updated_at.desc())
        .all()
    )

    def _visible_pending_profile(profile: Profile) -> bool:
        data = profile.data if isinstance(profile.data, dict) else {}
        status_values = {
            _safe_lower(profile.verification_status),
            _safe_lower(profile.public_verification_status),
            _safe_lower(profile.review_status),
            _safe_lower(data.get("status")),
            _safe_lower(data.get("verification_status")),
            _safe_lower(data.get("public_verification_status")),
            _safe_lower(data.get("review_status")),
        }
        if status_values.intersection({"deleted", "dismissed"}):
            return False
        if data.get("deleted_at") or data.get("dismissed_at"):
            return False
        return True

    pending_profiles = [
        profile for profile in pending_candidates if _visible_pending_profile(profile)
    ]

    total_vendors = (
        db.query(Profile)
        .filter(
            Profile.role == "vendor",
            func.lower(func.coalesce(Profile.review_status, "")) != "deleted",
            func.lower(func.coalesce(Profile.public_verification_status, "")) != "deleted",
        )
        .count()
        or len(vendor_items)
    )
    total_organizers = (
        db.query(Profile)
        .filter(
            Profile.role == "organizer",
            func.lower(func.coalesce(Profile.review_status, "")) != "deleted",
            func.lower(func.coalesce(Profile.public_verification_status, "")) != "deleted",
        )
        .count()
        or len(organizer_items)
    )

    return {
        "stats": {
            "total_vendors": total_vendors,
            "total_organizers": total_organizers,
            "live_events": 0,
            "applications_submitted": 0,
            "approved_awaiting_payment": 0,
            "paid_applications": 0,
            "pending_verifications": len(pending_profiles),
            "gross_sales": 0,
            "platform_revenue": 0,
            "organizer_payouts_owed": 0,
        },
        "recent_activity": [],
        "pending_verifications": [_profile_to_pending_item(p) for p in pending_profiles[:5]],
        "recent_payments": [],
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
async def admin_accounts_delete(
    user_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    if int(user.get("id") or 0) == int(user_id):
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    target_account = None
    for account in list_all_users():
        try:
            if int(account.get("id") or 0) == int(user_id):
                target_account = account
                break
        except Exception:
            continue

    if target_account is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    target_email = _safe_lower(target_account.get("email"))
    target_role = _safe_lower(target_account.get("role"))

    if _safe_lower(user.get("email")) == target_email:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    # Important: clear profile/verification rows before deleting the auth account,
    # otherwise the user disappears from Account Management but remains visible in
    # verification/admin profile surfaces.
    deleted_profiles = _mark_profiles_deleted(
        db=db,
        email=target_email,
        role=target_role if target_role in {"vendor", "organizer"} else None,
        admin_email=_safe_lower(user.get("email")),
    )

    deleted = admin_delete_user(user_id)
    return {
        "ok": True,
        "account": deleted,
        "deleted_profiles": deleted_profiles,
    }



def _find_user_id_by_email(email: str) -> int | None:
    target = _safe_lower(email)
    if not target:
        return None

    for account in list_all_users():
        if _safe_lower(account.get("email")) == target:
            try:
                return int(account.get("id"))
            except Exception:
                return None

    return None


@router.delete("/profile")
def admin_delete_profile_and_account(
    email: str,
    role: str,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    email = _safe_lower(email)
    role = _safe_lower(role)

    if not email or role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Invalid email or role")

    if _safe_lower(user.get("email")) == email:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    deleted_profile_count = _mark_profiles_deleted(
        db=db,
        email=email,
        role=role,
        admin_email=_safe_lower(user.get("email")),
    )
    deleted_profile = deleted_profile_count > 0

    deleted_account = None
    account_id = _find_user_id_by_email(email)
    if account_id is not None:
        try:
            deleted_account = admin_delete_user(account_id)
        except Exception as exc:
            deleted_account = {"error": str(exc), "id": account_id}

    if not deleted_profile and deleted_account is None:
        raise HTTPException(status_code=404, detail="No matching profile or account found.")

    return {
        "ok": True,
        "email": email,
        "role": role,
        "deleted_profile": deleted_profile,
        "deleted_account": deleted_account,
    }

@router.get("/profile")
def admin_get_profile(
    email: str,
    role: str,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    email = _safe_lower(email)
    role = _safe_lower(role)

    if not email or role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Invalid email or role")

    profile = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == email, Profile.role == role)
        .one_or_none()
    )

    if not profile:
        return {"ok": True, "exists": False, "email": email, "role": role}

    return _profile_payload(profile)


@router.post("/profile/premium")
def admin_set_profile_premium(
    payload: AdminProfilePremiumRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    email = _safe_lower(payload.email)
    role = _safe_lower(payload.role)

    if not email or role not in {"vendor", "organizer"}:
        raise HTTPException(status_code=400, detail="Invalid email or role")

    profile = (
        db.query(Profile)
        .filter(func.lower(Profile.email) == email, Profile.role == role)
        .one_or_none()
    )

    if profile is None:
        profile = Profile(email=email, role=role)
        db.add(profile)

    promoted = payload.featured if payload.promoted is None else bool(payload.promoted)
    data = profile.data if isinstance(profile.data, dict) else {}

    profile.featured = bool(payload.featured)
    profile.promoted = promoted
    profile.visibility_tier = "premium" if payload.featured or promoted else (profile.visibility_tier or "standard")

    if role == "organizer":
        plan = profile.subscription_plan or data.get("subscription_plan") or data.get("plan") or "enterprise_organizer"
    else:
        plan = profile.subscription_plan or data.get("subscription_plan") or data.get("plan") or "pro_vendor"

    profile.subscription_plan = str(plan).strip().lower()
    profile.subscription_status = profile.subscription_status or data.get("subscription_status") or "active"
    profile.data = {
        **data,
        "email": email,
        "plan": profile.subscription_plan,
        "subscription_plan": profile.subscription_plan,
        "subscription_status": profile.subscription_status,
        "subscriptionStatus": profile.subscription_status,
        "visibility_tier": profile.visibility_tier,
        "visibilityTier": profile.visibility_tier,
        "featured": profile.featured,
        "promoted": profile.promoted,
    }

    db.commit()
    db.refresh(profile)

    return {"ok": True, "profile": _profile_payload(profile)}


@router.get("/payments")
async def admin_payments(user: dict = Depends(require_admin)):
    # Payments are being migrated separately. Do not read JSON store here because
    # that store was reintroducing stale verification/subscription state after deploys.
    return {
        "summary": {
            "total": 0,
            "paid": 0,
            "pending": 0,
            "failed": 0,
            "revenue": 0,
        },
        "payments": [],
    }


@router.put("/payments/{payment_id}/mark-payout-paid")
async def mark_payout_paid(payment_id: int, user: dict = Depends(require_admin)):
    raise HTTPException(status_code=501, detail="Payment payout updates need the Postgres payments model before use.")
