from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.routers.auth import get_current_user

try:
    import stripe
except Exception:
    stripe = None

router = APIRouter(tags=["Verifications"])

VALID_ROLES = {"vendor", "organizer"}
VALID_REVIEW_STATUSES = {"verified", "rejected"}
EXPIRING_SOON_DAYS = 30
DEFAULT_VERIFICATION_DURATION_DAYS = 365
DEFAULT_VERIFICATION_FEES = {"vendor": 25, "organizer": 49}

REQUIRED_DOCS = {
    "vendor": ["business_license", "government_id"],
    "organizer": ["business_license", "government_id"],
}

DOC_LABELS = {
    "business_license": "Business License / Registration",
    "government_id": "Government-issued ID",
    "certificate_of_insurance": "Certificate of Insurance",
    "w9_document": "W-9",
    "business_registration": "Business Registration",
    "sales_tax_permit": "Sales Tax Permit",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _role(value: Any) -> str:
    role = _safe_lower(value)
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Role must be vendor or organizer")
    return role


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    if _safe_lower(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = _safe_str(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _normalize_documents(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    docs: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        doc_type = _safe_lower(item.get("type") or item.get("document_type") or item.get("category"))
        label = _safe_str(item.get("label") or item.get("name") or DOC_LABELS.get(doc_type, doc_type or "Document"))
        doc = {
            "name": _safe_str(item.get("name") or label),
            "label": label,
            "type": doc_type,
            "url": _safe_str(item.get("url") or item.get("file_url") or item.get("fileUrl")),
            "expiration_date": _safe_str(item.get("expiration_date") or item.get("expirationDate") or item.get("expires_at") or item.get("expiresAt")),
            "uploaded_at": _safe_str(item.get("uploaded_at") or item.get("uploadedAt") or _now_iso()),
        }
        if doc["name"] or doc["url"] or doc["type"]:
            docs.append(doc)
    return docs


def _document_status_summary(role: str, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    required = REQUIRED_DOCS.get(role, [])
    now = _now()
    found_types = set()
    missing_expiration_docs: List[str] = []
    expired_docs: List[Dict[str, Any]] = []
    expiring_soon_docs: List[Dict[str, Any]] = []
    active_docs: List[Dict[str, Any]] = []

    for doc in documents:
        doc_type = _safe_lower(doc.get("type"))
        if doc_type:
            found_types.add(doc_type)
        label = _safe_str(doc.get("label") or doc.get("name") or DOC_LABELS.get(doc_type, doc_type or "Document"))
        expiration = _parse_datetime(doc.get("expiration_date"))
        item = {**doc, "label": label, "expiration_date": expiration.isoformat() if expiration else None}
        if not expiration:
            missing_expiration_docs.append(doc_type or label)
        elif expiration < now:
            expired_docs.append(item)
        elif expiration - now <= timedelta(days=EXPIRING_SOON_DAYS):
            expiring_soon_docs.append(item)
        else:
            active_docs.append(item)

    missing_docs = [doc_type for doc_type in required if doc_type not in found_types]
    return {
        "required_docs": required,
        "missing_docs": missing_docs,
        "missing_expiration_docs": missing_expiration_docs,
        "expired_docs": expired_docs,
        "expiring_soon_docs": expiring_soon_docs,
        "active_docs": active_docs,
        "all_required_present": not missing_docs,
        "all_required_unexpired": not missing_docs and not expired_docs and not missing_expiration_docs,
    }


def _earliest_expiration(documents: List[Dict[str, Any]]) -> Optional[datetime]:
    expirations = [_parse_datetime(doc.get("expiration_date")) for doc in documents if isinstance(doc, dict)]
    expirations = [dt for dt in expirations if dt]
    return min(expirations) if expirations else None


def _verification_fee_amount(role: str) -> int:
    env_name = "STRIPE_VERIFICATION_FEE_ORGANIZER" if role == "organizer" else "STRIPE_VERIFICATION_FEE_VENDOR"
    raw = (os.getenv(env_name) or "").strip()
    try:
        return int(round(float(raw))) if raw else int(DEFAULT_VERIFICATION_FEES.get(role, 25))
    except Exception:
        return int(DEFAULT_VERIFICATION_FEES.get(role, 25))


def _require_stripe() -> Any:
    if stripe is None:
        raise HTTPException(status_code=500, detail="Stripe SDK missing. Install stripe.")
    secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not secret:
        raise HTTPException(status_code=500, detail="STRIPE_SECRET_KEY is not set")
    stripe.api_key = secret
    return stripe


def _checkout_session_value(session: Any, key: str, default: Any = None) -> Any:
    if isinstance(session, dict):
        return session.get(key, default)
    return getattr(session, key, default)


def _checkout_metadata(session: Any) -> Dict[str, Any]:
    metadata = _checkout_session_value(session, "metadata", {})
    if isinstance(metadata, dict):
        return metadata
    try:
        return dict(metadata or {})
    except Exception:
        return {}


def _get_profile(db: Session, email: str, role: str) -> Optional[Profile]:
    email = _safe_lower(email)
    role = _safe_lower(role)
    return (
        db.query(Profile)
        .filter(func.lower(Profile.email) == email, Profile.role == role)
        .one_or_none()
    )


def _get_or_create_profile(db: Session, email: str, role: str) -> Profile:
    email = _safe_lower(email)
    role = _role(role)
    row = _get_profile(db, email, role)
    if row is None:
        row = Profile(email=email, role=role)
        row.data = {"email": email, "role": role}
        row.categories = []
        db.add(row)
        db.flush()
    return row


def _profile_data(row: Profile) -> Dict[str, Any]:
    data = dict(row.data or {})
    data.setdefault("email", _safe_lower(row.email))
    data.setdefault("role", _safe_lower(row.role))
    return data


def _set_profile_state(row: Profile, data: Dict[str, Any]) -> None:
    existing = dict(row.data or {})
    merged = {**existing, **dict(data or {})}
    email = _safe_lower(merged.get("email") or row.email)
    role = _safe_lower(merged.get("role") or row.role)
    merged["email"] = email
    merged["role"] = role

    name = _safe_str(
        merged.get("business_name")
        or merged.get("businessName")
        or merged.get("organizationName")
        or merged.get("name")
        or row.business_name
    )
    display_name = _safe_str(merged.get("contact_name") or merged.get("contactName") or merged.get("display_name") or row.display_name or name)
    categories = merged.get("categories") or merged.get("vendor_categories") or row.categories or []
    if not isinstance(categories, list):
        categories = [str(categories)] if categories else []

    row.email = email
    row.role = role
    row.business_name = name or row.business_name
    row.display_name = display_name or row.display_name
    row.city = _safe_str(merged.get("city") or row.city)
    row.state = _safe_str(merged.get("state") or row.state)
    row.categories = categories
    row.data = merged

    row.verified = bool(merged.get("verified") is True or merged.get("is_verified") is True or row.verified)
    row.verification_status = _safe_lower(merged.get("verification_status") or merged.get("verificationStatus") or row.verification_status) or None
    row.public_verification_status = _safe_lower(merged.get("public_verification_status") or row.public_verification_status) or None
    row.public_verification_label = _safe_str(merged.get("public_verification_label") or row.public_verification_label) or None
    row.review_status = _safe_lower(merged.get("review_status") or merged.get("reviewStatus") or row.review_status) or None
    row.visibility_tier = _safe_lower(merged.get("visibility_tier") or merged.get("visibilityTier") or row.visibility_tier) or None
    row.subscription_plan = _safe_lower(merged.get("subscription_plan") or merged.get("subscriptionPlan") or merged.get("plan") or row.subscription_plan) or None
    row.subscription_status = _safe_lower(merged.get("subscription_status") or merged.get("subscriptionStatus") or row.subscription_status) or None
    row.featured = bool(merged.get("featured") or row.featured)
    row.promoted = bool(merged.get("promoted") or row.promoted)


def _profile_public(row: Profile) -> Dict[str, Any]:
    data = _profile_data(row)
    documents = data.get("documents") if isinstance(data.get("documents"), list) else []
    doc_status = _document_status_summary(_safe_lower(row.role), documents)
    expires_at = data.get("expires_at") or data.get("expiration_date")
    expiration = _parse_datetime(expires_at) or _earliest_expiration(documents)

    status = _safe_lower(row.verification_status or data.get("verification_status") or data.get("status"))
    review = _safe_lower(row.review_status or data.get("review_status"))
    public_status = _safe_lower(row.public_verification_status or data.get("public_verification_status"))
    verified = bool(row.verified or public_status == "verified" or status == "verified" or review == "approved")

    if verified:
        status = "verified"
        review = review or "approved"
        public_status = "verified"
        public_label = row.public_verification_label or "Verified"
    elif review == "rejected" or status == "rejected":
        status = "rejected"
        public_status = "not_verified"
        public_label = row.public_verification_label or "Not verified"
    elif status in {"expired", "expiring_soon", "needs_renewal", "renewal_pending"}:
        public_status = "renewal_pending"
        public_label = row.public_verification_label or "Renewal pending"
    else:
        status = status or "pending"
        public_status = public_status or "renewal_pending"
        public_label = row.public_verification_label or "Renewal pending"

    return {
        **data,
        "id": row.id,
        "email": _safe_lower(row.email),
        "role": _safe_lower(row.role),
        "name": row.business_name or row.display_name or data.get("business_name") or data.get("organizationName") or data.get("email"),
        "business_name": row.business_name or data.get("business_name") or data.get("businessName") or data.get("organizationName"),
        "company_name": row.business_name or data.get("business_name") or data.get("businessName") or data.get("organizationName"),
        "verified": verified,
        "is_verified": verified,
        "status": status,
        "verification_status": status,
        "review_status": review or ("approved" if verified else "renewal_pending"),
        "public_verification_status": public_status,
        "public_verification_label": public_label,
        "payment_status": data.get("payment_status") or data.get("verification_payment_status") or "unpaid",
        "fee_paid": bool(data.get("fee_paid") or data.get("payment_status") == "paid"),
        "fee_amount": data.get("fee_amount") or _verification_fee_amount(_safe_lower(row.role)),
        "documents": documents,
        "document_status": doc_status,
        "submitted_at": data.get("submitted_at") or data.get("created_at") or (row.created_at.isoformat() if row.created_at else None),
        "reviewed_at": data.get("reviewed_at") or data.get("last_verified_at"),
        "reviewed_by": data.get("reviewed_by"),
        "notes": data.get("notes") or "",
        "expires_at": expiration.isoformat() if expiration else data.get("expires_at"),
        "expiration_date": expiration.isoformat() if expiration else data.get("expiration_date"),
        "last_verified_at": data.get("last_verified_at"),
        "subscription_plan": row.subscription_plan or data.get("subscription_plan") or data.get("plan"),
        "subscription_status": row.subscription_status or data.get("subscription_status"),
        "visibility_tier": row.visibility_tier or data.get("visibility_tier"),
        "featured": bool(row.featured),
        "promoted": bool(row.promoted),
    }


def _is_pending_queue_row(row: Profile) -> bool:
    public = _profile_public(row)
    if public.get("verified") is True or public.get("public_verification_status") == "verified":
        return False
    status = _safe_lower(public.get("status") or public.get("verification_status"))
    review = _safe_lower(public.get("review_status"))
    payment_status = _safe_lower(public.get("payment_status"))
    docs = public.get("documents") if isinstance(public.get("documents"), list) else []
    return bool(
        docs
        or status in {"pending", "submitted", "renewal_pending", "needs_renewal", "expired", "expiring_soon"}
        or review in {"pending", "renewal_pending"}
        or payment_status == "paid"
    )


def mark_verification_paid(*, email: str, role: str, stripe_session_id: str = "", stripe_payment_intent_id: str = "", amount_paid: Any = None) -> Optional[Dict[str, Any]]:
    # Used by billing/webhook flows. Persist payment state to Profile.data, not JSON.
    from app.db import SessionLocal
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        normalized_email = _safe_lower(email)
        normalized_role = _role(role)
        row = _get_or_create_profile(db, normalized_email, normalized_role)
        data = _profile_data(row)
        data.update({
            "payment_status": "paid",
            "verification_payment_status": "paid",
            "fee_paid": True,
            "paid_at": _now_iso(),
            "fee_amount": data.get("fee_amount") or _verification_fee_amount(normalized_role),
        })
        if stripe_session_id:
            data["stripe_checkout_session_id"] = stripe_session_id
        if stripe_payment_intent_id:
            data["stripe_payment_intent_id"] = stripe_payment_intent_id
        if amount_paid not in (None, ""):
            try:
                data["amount_paid"] = round(float(amount_paid) / 100, 2)
            except Exception:
                data["amount_paid"] = amount_paid
        _set_profile_state(row, data)
        db.commit()
        db.refresh(row)
        return _profile_public(row)
    finally:
        db.close()


def _find_latest_record(email: str, role: str = "") -> Optional[Dict[str, Any]]:
    # Compatibility helper for existing vendor/organizer modules. Postgres only.
    from app.db import SessionLocal
    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        normalized_email = _safe_lower(email)
        normalized_role = _safe_lower(role)
        query = db.query(Profile).filter(func.lower(Profile.email) == normalized_email)
        if normalized_role:
            query = query.filter(Profile.role == normalized_role)
        row = query.order_by(Profile.updated_at.desc()).first()
        return _profile_public(row) if row else None
    finally:
        db.close()


@router.post("/verification/submit")
def submit_verification(payload: Dict[str, Any], user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(payload.get("email") or user.get("email"))
    role = _role(payload.get("role") or user.get("role"))
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    documents = _normalize_documents(payload.get("documents"))
    doc_summary = _document_status_summary(role, documents)
    if doc_summary.get("missing_docs"):
        labels = [DOC_LABELS.get(item, item) for item in doc_summary["missing_docs"]]
        raise HTTPException(status_code=400, detail="Missing required document(s): " + ", ".join(labels))
    if doc_summary.get("missing_expiration_docs"):
        labels = [DOC_LABELS.get(item, item) for item in doc_summary["missing_expiration_docs"]]
        raise HTTPException(status_code=400, detail="Expiration date required for: " + ", ".join(labels))

    row = _get_or_create_profile(db, email, role)
    data = _profile_data(row)
    submitted_at = _now_iso()
    data.update({
        "email": email,
        "role": role,
        "status": "pending",
        "verification_status": "pending",
        "review_status": "pending",
        "public_verification_status": "renewal_pending",
        "public_verification_label": "Renewal pending",
        "submitted_at": submitted_at,
        "reviewed_at": None,
        "reviewed_by": None,
        "notes": _safe_str(payload.get("notes") or data.get("notes")),
        "documents": documents,
        "payment_status": _safe_str(payload.get("payment_status") or data.get("payment_status") or "unpaid"),
        "fee_paid": bool(data.get("fee_paid") or _safe_lower(payload.get("payment_status")) == "paid"),
        "fee_amount": payload.get("fee_amount", data.get("fee_amount", _verification_fee_amount(role))),
        "expiration_date": payload.get("expiration_date") or data.get("expiration_date"),
        "updated_at": submitted_at,
    })
    row.verified = False
    row.verification_status = "pending"
    row.review_status = "pending"
    row.public_verification_status = "renewal_pending"
    row.public_verification_label = "Renewal pending"
    _set_profile_state(row, data)
    db.commit()
    db.refresh(row)
    return {"ok": True, "verification": _profile_public(row)}


@router.get("/verification/me")
def get_my_verification(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(user.get("email"))
    role = _role(user.get("role"))
    row = _get_or_create_profile(db, email, role)
    db.commit()
    db.refresh(row)
    public = _profile_public(row)
    return {
        "ok": True,
        "email": email,
        "role": role,
        "verification_status": public.get("verification_status"),
        "expires_at": public.get("expires_at"),
        "last_verified_at": public.get("last_verified_at"),
        "expires_in_days": None,
        "verification": public,
    }


@router.post("/verification/create-checkout")
def create_verification_checkout(payload: Dict[str, Any], user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    stripe_sdk = _require_stripe()
    email = _safe_lower(user.get("email"))
    role = _role(user.get("role"))
    success_url = _safe_str(payload.get("success_url"))
    cancel_url = _safe_str(payload.get("cancel_url"))
    if not success_url or not cancel_url:
        raise HTTPException(status_code=400, detail="Missing success_url or cancel_url")

    row = _get_or_create_profile(db, email, role)
    data = _profile_data(row)
    fee_amount = _verification_fee_amount(role)
    data["fee_amount"] = data.get("fee_amount") or fee_amount
    _set_profile_state(row, data)
    db.commit()

    try:
        session = stripe_sdk.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=str(user.get("id") or ""),
            customer_email=email or None,
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": f"VendCore {role.title()} Verification Fee"},
                    "unit_amount": int(fee_amount * 100),
                },
                "quantity": 1,
            }],
            metadata={"payment_type": "verification_fee", "verification": "true", "email": email, "role": role, "renewal": "true" if payload.get("renewal") else "false"},
            payment_intent_data={"metadata": {"payment_type": "verification_fee", "verification": "true", "email": email, "role": role}},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Stripe verification checkout failed: {exc}")

    data = _profile_data(row)
    data["stripe_checkout_session_id"] = str(_checkout_session_value(session, "id", "") or "")
    data["checkout_created_at"] = _now_iso()
    _set_profile_state(row, data)
    db.commit()
    return {"ok": True, "url": _checkout_session_value(session, "url", None), "session_id": _checkout_session_value(session, "id", None), "verification": _profile_public(row)}


@router.post("/verification/confirm-payment")
def confirm_verification_payment(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
    stripe_sdk = _require_stripe()
    session_id = _safe_str(payload.get("session_id"))
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to retrieve Stripe session: {exc}")
    metadata = _checkout_metadata(session)
    payment_type = _safe_lower(metadata.get("payment_type"))
    payment_status = _safe_lower(_checkout_session_value(session, "payment_status", ""))
    if payment_type != "verification_fee" and _safe_lower(metadata.get("verification")) != "true":
        raise HTTPException(status_code=400, detail="Stripe session is not a verification payment")
    email = _safe_lower(metadata.get("email") or user.get("email"))
    role = _role(metadata.get("role") or user.get("role"))
    if email != _safe_lower(user.get("email")) or role != _safe_lower(user.get("role")):
        raise HTTPException(status_code=403, detail="Stripe session does not belong to this account")
    if payment_status != "paid":
        raise HTTPException(status_code=400, detail="Payment is not marked paid yet")
    record = mark_verification_paid(email=email, role=role, stripe_session_id=session_id, stripe_payment_intent_id=str(_checkout_session_value(session, "payment_intent", "") or ""), amount_paid=_checkout_session_value(session, "amount_total", None))
    return {"ok": True, "verification": record}


@router.get("/verification/status")
def get_verification_status(email: str, role: str = "", db: Session = Depends(get_db)):
    normalized_email = _safe_lower(email)
    normalized_role = _safe_lower(role)
    query = db.query(Profile).filter(func.lower(Profile.email) == normalized_email)
    if normalized_role:
        query = query.filter(Profile.role == normalized_role)
    row = query.first()
    public = _profile_public(row) if row else None
    return {"ok": True, "email": normalized_email, "role": normalized_role, "verification_status": public.get("verification_status") if public else "unverified", "verification": public}


@router.get("/admin/verifications")
def get_admin_verifications(db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    rows = db.query(Profile).filter(Profile.role.in_(["vendor", "organizer"])).all()
    records = [_profile_public(row) for row in rows if _is_pending_queue_row(row)]
    records.sort(key=lambda item: _safe_str(item.get("submitted_at") or item.get("created_at") or ""), reverse=True)
    return {"ok": True, "verifications": records, "count": len(records)}


@router.post("/admin/verify/{verification_id}")
def review_verification(verification_id: int, payload: Dict[str, Any], db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    row = db.query(Profile).filter(Profile.id == int(verification_id)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification not found")
    status = _safe_lower(payload.get("status"))
    if status not in VALID_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be verified or rejected")

    data = _profile_data(row)
    now = _now()
    reviewed_at = now.isoformat()
    data["reviewed_at"] = reviewed_at
    data["reviewed_by"] = _safe_str(payload.get("reviewed_by") or payload.get("reviewedBy") or user.get("email"))
    data["notes"] = _safe_str(payload.get("notes"))

    if status == "verified":
        documents = data.get("documents") if isinstance(data.get("documents"), list) else []
        expiration = _parse_datetime(payload.get("expires_at") or payload.get("expiration_date") or payload.get("expirationDate")) or _earliest_expiration(documents) or (now + timedelta(days=DEFAULT_VERIFICATION_DURATION_DAYS))
        data.update({
            "verified": True,
            "is_verified": True,
            "status": "verified",
            "verification_status": "verified",
            "review_status": "approved",
            "public_verification_status": "verified",
            "public_verification_label": "Verified",
            "last_verified_at": reviewed_at,
            "expires_at": expiration.isoformat(),
            "expiration_date": expiration.isoformat(),
            "locked": True,
        })
        row.verified = True
        row.verification_status = "verified"
        row.review_status = "approved"
        row.public_verification_status = "verified"
        row.public_verification_label = "Verified"
    else:
        data.update({
            "verified": False,
            "is_verified": False,
            "status": "rejected",
            "verification_status": "rejected",
            "review_status": "rejected",
            "public_verification_status": "not_verified",
            "public_verification_label": "Not verified",
            "locked": True,
        })
        row.verified = False
        row.verification_status = "rejected"
        row.review_status = "rejected"
        row.public_verification_status = "not_verified"
        row.public_verification_label = "Not verified"

    _set_profile_state(row, data)
    db.commit()
    db.refresh(row)
    return {"ok": True, "verification": _profile_public(row)}


@router.delete("/admin/verifications/{verification_id}")
def delete_verification(verification_id: int, db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    row = db.query(Profile).filter(Profile.id == int(verification_id)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification not found")
    data = _profile_data(row)
    data.update({
        "status": "dismissed",
        "verification_status": "dismissed",
        "review_status": "dismissed",
        "dismissed_at": _now_iso(),
        "dismissed_by": user.get("email"),
    })
    row.verification_status = "dismissed"
    row.review_status = "dismissed"
    row.data = data
    db.commit()
    return {"ok": True, "deleted": _profile_public(row)}
