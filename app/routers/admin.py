
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

from app.routers.auth import (
    admin_create_user,
    admin_delete_user,
    get_current_user,
    list_all_users,
)
from app.db import get_db
from app.models.profile import EventAlert, Profile
from app.store import get_store_snapshot, load_store, save_store
from app import store as store_module

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



def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _account_identity(account: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        _safe_lower(account.get("email")),
        _safe_lower(account.get("role")),
        _safe_str(account.get("id") or account.get("sub") or account.get("user_id")),
    )


def _row_identity_matches(row: Any, *, email: str, role: str = "", user_id: str = "") -> bool:
    if not isinstance(row, dict):
        return False

    email_fields = [
        "email",
        "owner_email",
        "vendor_email",
        "organizer_email",
        "user_email",
        "created_by_email",
        "contact_email",
    ]
    role_fields = ["role", "owner_role", "user_role"]
    id_fields = ["user_id", "vendor_id", "organizer_id", "owner_id", "created_by", "account_id", "id"]

    row_emails = {_safe_lower(row.get(field)) for field in email_fields if _safe_lower(row.get(field))}
    row_roles = {_safe_lower(row.get(field)) for field in role_fields if _safe_lower(row.get(field))}
    row_ids = {_safe_str(row.get(field)) for field in id_fields if _safe_str(row.get(field))}

    if email and email in row_emails:
        if not role or not row_roles or role in row_roles:
            return True
        # Applications/payments often do not carry an owner_role field; email is enough.
        return True

    if user_id and user_id in row_ids:
        if not role or not row_roles or role in row_roles:
            return True

    return False


def _delete_matching_from_dict(mapping: Any, *, email: str, role: str = "", user_id: str = "", keys: set[str] | None = None) -> int:
    if not isinstance(mapping, dict):
        return 0

    removed = 0
    keys = keys or set()
    for key, value in list(mapping.items()):
        normalized_key = _safe_lower(key)
        remove = normalized_key in keys or normalized_key == email
        if not remove and isinstance(value, dict):
            remove = _row_identity_matches(value, email=email, role=role, user_id=user_id)
        if remove:
            mapping.pop(key, None)
            removed += 1
    return removed


def _delete_matching_from_list(items: Any, *, email: str, role: str = "", user_id: str = "", event_ids: set[str] | None = None) -> int:
    if not isinstance(items, list):
        return 0

    event_ids = event_ids or set()
    keep = []
    removed = 0
    for item in items:
        remove = False
        if isinstance(item, dict):
            item_event_id = _safe_str(item.get("event_id") or item.get("eventId"))
            remove = _row_identity_matches(item, email=email, role=role, user_id=user_id) or (item_event_id and item_event_id in event_ids)
        if remove:
            removed += 1
        else:
            keep.append(item)
    items[:] = keep
    return removed


def _store_event_ids_for_owner(email: str, user_id: str) -> set[str]:
    event_ids: set[str] = set()
    events = getattr(store_module, "_EVENTS", {})
    if not isinstance(events, dict):
        return event_ids

    for key, value in list(events.items()):
        if isinstance(value, dict) and _row_identity_matches(value, email=email, role="organizer", user_id=user_id):
            event_id = _safe_str(value.get("id") or key)
            if event_id:
                event_ids.add(event_id)
                try:
                    event_ids.add(str(int(float(event_id))))
                except Exception:
                    pass
    return event_ids


def _delete_from_runtime_store(*, email: str, role: str, user_id: str, db_event_ids: set[str] | None = None) -> Dict[str, int]:
    load_store()
    removed: Dict[str, int] = {}
    event_ids = set(db_event_ids or set())

    if role == "organizer":
        event_ids |= _store_event_ids_for_owner(email, user_id)

    vendors = getattr(store_module, "_VENDORS", None)
    if role == "vendor" and isinstance(vendors, dict):
        removed["public_vendor_profiles"] = _delete_matching_from_dict(
            vendors,
            email=email,
            role="vendor",
            user_id=user_id,
            keys={email},
        )

    reviews = getattr(store_module, "_REVIEWS", None)
    if role == "vendor" and isinstance(reviews, dict):
        removed["vendor_reviews"] = _delete_matching_from_dict(
            reviews,
            email=email,
            role="vendor",
            user_id=user_id,
            keys={email},
        )

    events = getattr(store_module, "_EVENTS", None)
    if role == "organizer" and isinstance(events, dict):
        removed_count = 0
        for key, value in list(events.items()):
            key_text = _safe_str(key)
            value_event_id = _safe_str(value.get("id")) if isinstance(value, dict) else ""
            if key_text in event_ids or value_event_id in event_ids or (isinstance(value, dict) and _row_identity_matches(value, email=email, role="organizer", user_id=user_id)):
                events.pop(key, None)
                removed_count += 1
        removed["events"] = removed_count

    applications = getattr(store_module, "_APPLICATIONS", None)
    if isinstance(applications, dict):
        removed_count = 0
        for key, value in list(applications.items()):
            event_id = _safe_str(value.get("event_id") or value.get("eventId")) if isinstance(value, dict) else ""
            if isinstance(value, dict) and (_row_identity_matches(value, email=email, role=role, user_id=user_id) or (event_id and event_id in event_ids)):
                applications.pop(key, None)
                removed_count += 1
        removed["applications"] = removed_count
    elif isinstance(applications, list):
        removed["applications"] = _delete_matching_from_list(applications, email=email, role=role, user_id=user_id, event_ids=event_ids)

    payments = getattr(store_module, "_PAYMENTS", None)
    if isinstance(payments, dict):
        removed_count = 0
        for key, value in list(payments.items()):
            event_id = _safe_str(value.get("event_id") or value.get("eventId")) if isinstance(value, dict) else ""
            if isinstance(value, dict) and (_row_identity_matches(value, email=email, role=role, user_id=user_id) or (event_id and event_id in event_ids)):
                payments.pop(key, None)
                removed_count += 1
        removed["payments"] = removed_count
    elif isinstance(payments, list):
        removed["payments"] = _delete_matching_from_list(payments, email=email, role=role, user_id=user_id, event_ids=event_ids)

    requirements = getattr(store_module, "_REQUIREMENTS", None)
    if role == "organizer" and isinstance(requirements, dict) and event_ids:
        removed_count = 0
        for key in list(requirements.keys()):
            if _safe_str(key) in event_ids:
                requirements.pop(key, None)
                removed_count += 1
        removed["requirements"] = removed_count

    # Some older store snapshots keep these as dynamic globals. Handle them if present.
    for attr_name, label in (
        ("_VERIFICATIONS", "verification_records"),
        ("_HOMEPAGE_FEATURES", "homepage_features"),
        ("_WAITLIST", "waitlist_rows"),
    ):
        obj = getattr(store_module, attr_name, None)
        if isinstance(obj, dict):
            removed[label] = _delete_matching_from_dict(obj, email=email, role=role, user_id=user_id)
        elif isinstance(obj, list):
            removed[label] = _delete_matching_from_list(obj, email=email, role=role, user_id=user_id, event_ids=event_ids)

    save_store()
    return {key: value for key, value in removed.items() if value}


def _execute_optional(db: Session, sql: str, params: Dict[str, Any], label: str) -> int:
    try:
        result = db.execute(text(sql), params)
        return int(result.rowcount or 0)
    except Exception as exc:
        db.rollback()
        print(f"⚠️ Account cleanup skipped {label}: {exc}")
        return 0


def _fetch_owned_event_ids(db: Session, email: str, user_id: str) -> set[str]:
    event_ids: set[str] = set()
    for sql, params in (
        (
            """
            SELECT id FROM events
            WHERE lower(coalesce(organizer_email, '')) = :email
               OR lower(coalesce(owner_email, '')) = :email
               OR coalesce(cast(organizer_id as text), '') = :user_id
               OR coalesce(cast(owner_id as text), '') = :user_id
               OR coalesce(cast(created_by as text), '') = :user_id
            """,
            {"email": email, "user_id": user_id},
        ),
    ):
        try:
            rows = db.execute(text(sql), params).fetchall()
            for row in rows:
                if row and row[0] is not None:
                    event_ids.add(str(row[0]))
        except Exception as exc:
            db.rollback()
            print(f"⚠️ Owned event lookup skipped: {exc}")
    return event_ids


def _delete_from_database(*, db: Session, email: str, role: str, user_id: str) -> Dict[str, int]:
    removed: Dict[str, int] = {}
    event_ids = _fetch_owned_event_ids(db, email, user_id) if role == "organizer" else set()

    try:
        profile_query = db.query(Profile).filter(func.lower(Profile.email) == email)
        if role in {"vendor", "organizer"}:
            profile_query = profile_query.filter(Profile.role == role)
        count = profile_query.delete(synchronize_session=False)
        if count:
            removed["profiles"] = int(count)
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"⚠️ Profile cleanup skipped: {exc}")

    if role == "vendor":
        try:
            count = db.query(EventAlert).filter(func.lower(EventAlert.vendor_email) == email).delete(synchronize_session=False)
            if count:
                removed["event_alerts"] = int(count)
            db.commit()
        except Exception as exc:
            db.rollback()
            print(f"⚠️ Event alert cleanup skipped: {exc}")

    # Verification documents and grants.
    removed["document_grants"] = _execute_optional(
        db,
        """
        DELETE FROM document_access_grants
        WHERE document_id IN (
            SELECT id FROM verification_documents
            WHERE lower(owner_email) = :email AND owner_role = :role
        )
        """,
        {"email": email, "role": role},
        "document_access_grants",
    )
    removed["document_audit_logs"] = _execute_optional(
        db,
        """
        DELETE FROM document_audit_logs
        WHERE document_id IN (
            SELECT id FROM verification_documents
            WHERE lower(owner_email) = :email AND owner_role = :role
        )
        """,
        {"email": email, "role": role},
        "document_audit_logs",
    )
    removed["verification_documents"] = _execute_optional(
        db,
        "DELETE FROM verification_documents WHERE lower(owner_email) = :email AND owner_role = :role",
        {"email": email, "role": role},
        "verification_documents",
    )

    # Verification/trust history tables vary across deploys. Delete only when present.
    if role == "vendor":
        removed["vendor_trust_history"] = _execute_optional(
            db,
            "DELETE FROM vendor_trust_history WHERE lower(vendor_email) = :email",
            {"email": email},
            "vendor_trust_history",
        )
    elif role == "organizer":
        removed["vendor_trust_history"] = _execute_optional(
            db,
            "DELETE FROM vendor_trust_history WHERE lower(organizer_email) = :email",
            {"email": email},
            "vendor_trust_history",
        )

    if role == "vendor":
        removed["applications"] = _execute_optional(
            db,
            "DELETE FROM applications WHERE lower(coalesce(vendor_email, '')) = :email OR coalesce(cast(vendor_id as text), '') = :user_id",
            {"email": email, "user_id": user_id},
            "applications vendor rows",
        )
    elif role == "organizer":
        removed["applications"] = _execute_optional(
            db,
            "DELETE FROM applications WHERE lower(coalesce(organizer_email, '')) = :email OR coalesce(cast(organizer_id as text), '') = :user_id",
            {"email": email, "user_id": user_id},
            "applications organizer rows",
        )

    if role == "organizer" and event_ids:
        # Remove diagram/layout rows before events when those tables exist.
        # Looping avoids dialect-specific array bind behavior on Railway/Postgres.
        event_diagram_removed = 0
        diagrams_removed = 0
        events_removed = 0
        for event_id in sorted(event_ids):
            event_diagram_removed += _execute_optional(
                db,
                "DELETE FROM event_diagram WHERE cast(event_id as text) = :event_id",
                {"event_id": event_id},
                "event_diagram",
            )
            diagrams_removed += _execute_optional(
                db,
                "DELETE FROM diagrams WHERE cast(event_id as text) = :event_id",
                {"event_id": event_id},
                "diagrams",
            )
            events_removed += _execute_optional(
                db,
                "DELETE FROM events WHERE cast(id as text) = :event_id",
                {"event_id": event_id},
                "events",
            )
        removed["event_diagrams"] = event_diagram_removed
        removed["diagrams"] = diagrams_removed
        removed["events"] = events_removed

    # Payment tables may be store-only in current deploys. Clean DB versions defensively.
    removed["payments"] = _execute_optional(
        db,
        """
        DELETE FROM payments
        WHERE lower(coalesce(vendor_email, '')) = :email
           OR lower(coalesce(organizer_email, '')) = :email
           OR coalesce(cast(vendor_id as text), '') = :user_id
           OR coalesce(cast(organizer_id as text), '') = :user_id
        """,
        {"email": email, "user_id": user_id},
        "payments",
    )

    try:
        db.commit()
    except Exception:
        db.rollback()

    return {key: value for key, value in removed.items() if value}


def _cascade_delete_account_data(*, account: Dict[str, Any], db: Session) -> Dict[str, Any]:
    email, role, user_id = _account_identity(account)
    if not email:
        return {"email": email, "role": role, "database": {}, "store": {}}

    db_event_ids = _fetch_owned_event_ids(db, email, user_id) if role == "organizer" else set()
    database_removed = _delete_from_database(db=db, email=email, role=role, user_id=user_id)
    store_removed = _delete_from_runtime_store(email=email, role=role, user_id=user_id, db_event_ids=db_event_ids)

    return {
        "email": email,
        "role": role,
        "user_id": user_id,
        "database": database_removed,
        "store": store_removed,
    }


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


def _resolve_admin_delete_account(user_key: str) -> Dict[str, Any]:
    """Resolve an admin account delete target by auth id, email, or username.

    The Admin dashboard normally sends the numeric auth id. This fallback keeps
    Delete Everywhere working even if an account card is rendered from a row
    that carries email/username but not a stable numeric id.
    """
    key = _safe_str(user_key)
    key_lower = key.lower()
    accounts = list_all_users()

    if not key:
        raise HTTPException(status_code=400, detail="Missing account id or email.")

    for account in accounts:
        if _safe_str(account.get("id")) == key:
            return account

    for account in accounts:
        if _safe_lower(account.get("email")) == key_lower:
            return account

    for account in accounts:
        if _safe_lower(account.get("username")) == key_lower:
            return account

    raise HTTPException(status_code=404, detail="Account not found.")


@router.delete("/accounts/{user_key}")
async def admin_accounts_delete(
    user_key: str,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    account = _resolve_admin_delete_account(user_key)
    target_id = int(account.get("id") or 0)
    current_id = int(user.get("id") or user.get("user_id") or 0)

    if current_id and current_id == target_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    target_email = _safe_lower(account.get("email"))
    current_email = _safe_lower(user.get("email") or user.get("sub"))
    if target_email and current_email and target_email == current_email:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account.")

    # Delete the auth record first, then aggressively remove every public/profile
    # surface tied to that account. This makes the Admin dashboard Delete button
    # mean "remove this user everywhere," not just "remove login access."
    deleted = admin_delete_user(target_id)
    cleanup = _cascade_delete_account_data(account=deleted, db=db)

    return {"ok": True, "account": deleted, "cleanup": cleanup}


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
