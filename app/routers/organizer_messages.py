# app/routers/organizer_messages.py
from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Integer, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from app.auth import AuthUser, get_current_user
from app.database import get_db

router = APIRouter(prefix="/organizer/messages", tags=["organizer_messages"])

Channel = Literal["email", "sms"]


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------


class DryRunRequest(BaseModel):
    channel: Channel
    subject: Optional[str] = None
    body: str
    contact_ids: List[int]


class DryRunRecipient(BaseModel):
    contact_id: int
    name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    rendered_text: str
    reason_skipped: Optional[str] = None


class DryRunResponse(BaseModel):
    channel: Channel
    subject: Optional[str] = None
    body: str
    eligible: List[DryRunRecipient]
    skipped: List[DryRunRecipient]


class QueueResponse(BaseModel):
    bulk_message_id: int
    channel: Channel
    status: str
    eligible_count: int
    skipped_count: int


class BulkMessageSummary(BaseModel):
    id: int
    channel: Channel
    subject: Optional[str] = None
    body: str
    status: str
    created_at: Optional[str] = None
    queued_at: Optional[str] = None
    eligible_count: int = 0
    skipped_count: int = 0


class BulkMessageListOut(BaseModel):
    items: List[BulkMessageSummary]
    count: int


class BulkMessageRecipientOut(BaseModel):
    id: Optional[int] = None
    bulk_message_id: int
    contact_id: int
    name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    status: str
    reason_skipped: Optional[str] = None
    rendered_text: Optional[str] = None
    created_at: Optional[str] = None


class BulkMessageDetailOut(BaseModel):
    message: BulkMessageSummary
    recipients: List[BulkMessageRecipientOut]


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _require_organizer(user: AuthUser) -> None:
    if not user or getattr(user, "role", None) != "organizer":
        raise HTTPException(status_code=403, detail="Organizer access required")


def _render(template: str, c: Dict[str, Any]) -> str:
    t = template or ""
    return (
        t.replace("{name}", c.get("name") or "")
        .replace("{company}", c.get("company") or "")
        .replace("{email}", c.get("email") or "")
        .replace("{phone}", c.get("phone") or "")
    )


def _skip_reason(channel: Channel, c: Dict[str, Any]) -> Optional[str]:
    if channel == "email":
        if not (c.get("email") or "").strip():
            return "missing_email"
    else:
        if not (c.get("phone") or "").strip():
            return "missing_phone"
    return None


def _col_exists(db: Session, table_name: str, col_name: str) -> bool:
    sql = text(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = :t
          AND column_name = :c
        LIMIT 1
        """
    )
    return db.execute(sql, {"t": table_name, "c": col_name}).first() is not None


def _recipient_cols(db: Session) -> Tuple[str, str]:
    # allow slight schema differences
    fk = (
        "bulk_message_id"
        if _col_exists(db, "bulk_message_recipients", "bulk_message_id")
        else "message_id"
    )
    st = "status" if _col_exists(db, "bulk_message_recipients", "status") else "state"
    return fk, st


def _counts_for_message(
    db: Session, organizer_id: int, bulk_message_id: int
) -> tuple[int, int]:
    fk_col, status_col = _recipient_cols(db)
    sql = text(
        f"""
        SELECT
          SUM(CASE WHEN r.{status_col} = 'eligible' THEN 1 ELSE 0 END) AS eligible_count,
          SUM(CASE WHEN r.{status_col} = 'skipped'  THEN 1 ELSE 0 END) AS skipped_count
        FROM bulk_message_recipients r
        JOIN bulk_messages m
          ON m.id = r.{fk_col}
        WHERE r.{fk_col} = :bulk_message_id
          AND m.organizer_id = :organizer_id
        """
    )
    row = (
        db.execute(
            sql, {"organizer_id": organizer_id, "bulk_message_id": bulk_message_id}
        )
        .mappings()
        .first()
    )
    if not row:
        return (0, 0)
    return (int(row.get("eligible_count") or 0), int(row.get("skipped_count") or 0))


CONTACTS_BY_IDS_SQL = text(
    """
        SELECT
            id,
            organizer_id,
            name,
            email,
            phone,
            company
        FROM organizer_contacts
        WHERE organizer_id = :organizer_id
          AND id = ANY(:contact_ids)
        ORDER BY id
        """
).bindparams(bindparam("contact_ids", type_=ARRAY(Integer)))


# -----------------------------------------------------------------------------
# Dry-run
# -----------------------------------------------------------------------------


@router.post("/dry-run", response_model=DryRunResponse)
def dry_run(
    payload: DryRunRequest,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DryRunResponse:
    _require_organizer(current_user)

    contact_ids = [int(x) for x in (payload.contact_ids or []) if int(x) > 0]
    if not contact_ids:
        return DryRunResponse(
            channel=payload.channel,
            subject=payload.subject if payload.channel == "email" else None,
            body=payload.body,
            eligible=[],
            skipped=[],
        )

    try:
        rows = (
            db.execute(
                CONTACTS_BY_IDS_SQL,
                {"organizer_id": current_user.id, "contact_ids": contact_ids},
            )
            .mappings()
            .all()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load contacts for dry-run: {exc.__class__.__name__}: {exc}",
        ) from exc

    eligible: List[DryRunRecipient] = []
    skipped: List[DryRunRecipient] = []

    for r in rows:
        c = {
            "id": int(r["id"]),
            "name": r.get("name"),
            "company": r.get("company"),
            "email": r.get("email"),
            "phone": r.get("phone"),
        }
        reason = _skip_reason(payload.channel, c)
        rendered = _render(payload.body, c)

        rec = DryRunRecipient(
            contact_id=c["id"],
            name=c["name"],
            company=c["company"],
            email=c["email"],
            phone=c["phone"],
            rendered_text=rendered,
            reason_skipped=reason,
        )
        (eligible if reason is None else skipped).append(rec)

    return DryRunResponse(
        channel=payload.channel,
        subject=payload.subject if payload.channel == "email" else None,
        body=payload.body,
        eligible=eligible,
        skipped=skipped,
    )


# -----------------------------------------------------------------------------
# Queue (persistence; NO real sending)
# -----------------------------------------------------------------------------


@router.post("/queue", response_model=QueueResponse)
def queue_campaign(
    payload: DryRunRequest,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QueueResponse:
    _require_organizer(current_user)

    contact_ids = [int(x) for x in (payload.contact_ids or []) if int(x) > 0]
    if not contact_ids:
        raise HTTPException(status_code=400, detail="contact_ids is required")

    # Load contacts (enforces organizer ownership)
    try:
        rows = (
            db.execute(
                CONTACTS_BY_IDS_SQL,
                {"organizer_id": current_user.id, "contact_ids": contact_ids},
            )
            .mappings()
            .all()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load contacts for queue: {exc.__class__.__name__}: {exc}",
        ) from exc

    eligible_rows: List[Dict[str, Any]] = []
    skipped_rows: List[Dict[str, Any]] = []

    for r in rows:
        c = {
            "id": int(r["id"]),
            "name": r.get("name"),
            "company": r.get("company"),
            "email": r.get("email"),
            "phone": r.get("phone"),
        }
        reason = _skip_reason(payload.channel, c)
        rendered = _render(payload.body, c)

        status = "eligible" if reason is None else "skipped"
        rec = {
            "contact_id": c["id"],
            "name": c["name"],
            "company": c["company"],
            "email": c["email"],
            "phone": c["phone"],
            "rendered_text": rendered,
            "reason_skipped": reason,
            "status": status,
        }
        (eligible_rows if reason is None else skipped_rows).append(rec)

    subject = (
        payload.subject.strip()
        if (payload.channel == "email" and payload.subject)
        else None
    )

    # Bulk message columns may vary slightly depending on migration iteration
    has_contact_ids = _col_exists(
        db, "bulk_messages", "contact_ids"
    )  # jsonb, often NOT NULL
    has_eligible = _col_exists(db, "bulk_messages", "eligible_count")
    has_skipped = _col_exists(db, "bulk_messages", "skipped_count")

    cols = ["organizer_id", "channel", "subject", "body", "status", "created_at"]
    vals = [":organizer_id", ":channel", ":subject", ":body", "'queued'", "NOW()"]

    params: Dict[str, Any] = {
        "organizer_id": current_user.id,
        "channel": payload.channel,
        "subject": subject,
        "body": payload.body,
    }

    if has_contact_ids:
        # Store JSON array (string) and cast to jsonb in SQL
        cols.insert(4, "contact_ids")
        vals.insert(4, "CAST(:contact_ids AS jsonb)")
        params["contact_ids"] = json.dumps(contact_ids)

    if has_eligible and has_skipped:
        cols.insert(-1, "eligible_count")
        cols.insert(-1, "skipped_count")
        vals.insert(-1, ":eligible_count")
        vals.insert(-1, ":skipped_count")
        params["eligible_count"] = len(eligible_rows)
        params["skipped_count"] = len(skipped_rows)

    insert_msg_sql = text(
        f"""
        INSERT INTO bulk_messages ({", ".join(cols)})
        VALUES ({", ".join(vals)})
        RETURNING id
        """
    )

    fk_col, status_col = _recipient_cols(db)
    insert_rec_sql = text(
        f"""
        INSERT INTO bulk_message_recipients (
          {fk_col},
          contact_id,
          name,
          company,
          email,
          phone,
          {status_col},
          reason_skipped,
          rendered_text,
          created_at
        )
        VALUES (
          :bulk_message_id,
          :contact_id,
          :name,
          :company,
          :email,
          :phone,
          :status,
          :reason_skipped,
          :rendered_text,
          NOW()
        )
        """
    )

    try:
        msg_id = int(db.execute(insert_msg_sql, params).scalar_one())

        for rec in eligible_rows + skipped_rows:
            db.execute(
                insert_rec_sql,
                {
                    "bulk_message_id": msg_id,
                    "contact_id": rec["contact_id"],
                    "name": rec.get("name"),
                    "company": rec.get("company"),
                    "email": rec.get("email"),
                    "phone": rec.get("phone"),
                    "status": rec["status"],
                    "reason_skipped": rec.get("reason_skipped"),
                    "rendered_text": rec.get("rendered_text"),
                },
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue bulk campaign: {exc.__class__.__name__}: {exc}",
        ) from exc

    return QueueResponse(
        bulk_message_id=msg_id,
        channel=payload.channel,
        status="queued",
        eligible_count=len(eligible_rows),
        skipped_count=len(skipped_rows),
    )


# -----------------------------------------------------------------------------
# List + detail
# -----------------------------------------------------------------------------


@router.get("", response_model=BulkMessageListOut)
def list_campaigns(
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkMessageListOut:
    _require_organizer(current_user)

    has_queued_at = _col_exists(db, "bulk_messages", "queued_at")

    sql = text(
        f"""
        SELECT
          id,
          channel,
          subject,
          body,
          status,
          created_at
          {", queued_at" if has_queued_at else ""}
        FROM bulk_messages
        WHERE organizer_id = :organizer_id
        ORDER BY id DESC
        LIMIT 100
        """
    )

    try:
        rows = db.execute(sql, {"organizer_id": current_user.id}).mappings().all()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load campaigns: {exc.__class__.__name__}: {exc}",
        ) from exc

    items: List[BulkMessageSummary] = []
    for r in rows:
        msg_id = int(r["id"])
        eligible_count, skipped_count = _counts_for_message(db, current_user.id, msg_id)

        items.append(
            BulkMessageSummary(
                id=msg_id,
                channel=r.get("channel"),
                subject=r.get("subject"),
                body=r.get("body"),
                status=r.get("status"),
                created_at=(
                    str(r.get("created_at"))
                    if r.get("created_at") is not None
                    else None
                ),
                queued_at=(
                    str(r.get("queued_at")) if r.get("queued_at") is not None else None
                ),
                eligible_count=eligible_count,
                skipped_count=skipped_count,
            )
        )

    return BulkMessageListOut(items=items, count=len(items))


@router.get("/{bulk_message_id}", response_model=BulkMessageDetailOut)
def get_campaign(
    bulk_message_id: int,
    current_user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkMessageDetailOut:
    _require_organizer(current_user)

    has_queued_at = _col_exists(db, "bulk_messages", "queued_at")

    msg_sql = text(
        f"""
        SELECT
          id,
          channel,
          subject,
          body,
          status,
          created_at
          {", queued_at" if has_queued_at else ""}
        FROM bulk_messages
        WHERE id = :id
          AND organizer_id = :organizer_id
        LIMIT 1
        """
    )

    fk_col, status_col = _recipient_cols(db)
    rec_sql = text(
        f"""
        SELECT
          id,
          {fk_col} AS bulk_message_id,
          contact_id,
          name,
          company,
          email,
          phone,
          {status_col} AS status,
          reason_skipped,
          rendered_text,
          created_at
        FROM bulk_message_recipients
        WHERE {fk_col} = :id
        ORDER BY id ASC
        """
    )

    try:
        msg_row = (
            db.execute(
                msg_sql, {"id": int(bulk_message_id), "organizer_id": current_user.id}
            )
            .mappings()
            .first()
        )
        if not msg_row:
            raise HTTPException(status_code=404, detail="Campaign not found")

        eligible_count, skipped_count = _counts_for_message(
            db, current_user.id, int(bulk_message_id)
        )
        msg = BulkMessageSummary(
            id=int(msg_row["id"]),
            channel=msg_row.get("channel"),
            subject=msg_row.get("subject"),
            body=msg_row.get("body"),
            status=msg_row.get("status"),
            created_at=(
                str(msg_row.get("created_at"))
                if msg_row.get("created_at") is not None
                else None
            ),
            queued_at=(
                str(msg_row.get("queued_at"))
                if msg_row.get("queued_at") is not None
                else None
            ),
            eligible_count=eligible_count,
            skipped_count=skipped_count,
        )

        rec_rows = db.execute(rec_sql, {"id": int(bulk_message_id)}).mappings().all()
        recipients = [
            BulkMessageRecipientOut(
                id=int(r.get("id")) if r.get("id") is not None else None,
                bulk_message_id=int(r.get("bulk_message_id")),
                contact_id=int(r.get("contact_id")),
                name=r.get("name"),
                company=r.get("company"),
                email=r.get("email"),
                phone=r.get("phone"),
                status=r.get("status"),
                reason_skipped=r.get("reason_skipped"),
                rendered_text=r.get("rendered_text"),
                created_at=(
                    str(r.get("created_at"))
                    if r.get("created_at") is not None
                    else None
                ),
            )
            for r in rec_rows
        ]

        return BulkMessageDetailOut(message=msg, recipients=recipients)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load campaign: {exc.__class__.__name__}: {exc}",
        ) from exc
