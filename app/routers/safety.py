from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.routers.auth import get_current_user

router = APIRouter(tags=["Safety"])

ALLOWED_REPORT_REASONS = {
    "spam",
    "scam",
    "harassment",
    "inappropriate_content",
    "impersonation",
    "threats",
    "other",
}


class BlockUserPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    target_email: str


class SafetyReportCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    target_email: str = ""
    context_type: str = "user"
    context_id: str = ""
    content_id: str = ""
    reason: str = "other"
    details: str = ""


class SafetyReportStatusPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: str


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_safety_tables(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS user_blocks (
                blocker_email VARCHAR(320) NOT NULL,
                blocked_email VARCHAR(320) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (blocker_email, blocked_email)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS safety_reports (
                report_id VARCHAR(64) PRIMARY KEY,
                reporter_email VARCHAR(320) NOT NULL,
                reporter_role VARCHAR(40),
                target_email VARCHAR(320),
                context_type VARCHAR(80) NOT NULL,
                context_id VARCHAR(160),
                content_id VARCHAR(160),
                reason VARCHAR(80) NOT NULL,
                details TEXT,
                status VARCHAR(40) NOT NULL DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    db.commit()


def are_users_blocked(email_a: str, email_b: str) -> bool:
    """True if either user has blocked the other."""
    a = _norm(email_a)
    b = _norm(email_b)
    if not a or not b or a == b or SessionLocal is None:
        return False

    db = SessionLocal()
    try:
        ensure_safety_tables(db)
        row = db.execute(
            text(
                """
                SELECT 1
                FROM user_blocks
                WHERE (blocker_email = :a AND blocked_email = :b)
                   OR (blocker_email = :b AND blocked_email = :a)
                LIMIT 1
                """
            ),
            {"a": a, "b": b},
        ).first()
        return row is not None
    except Exception as exc:
        print(f"Safety block lookup failed: {exc}")
        return False
    finally:
        db.close()


def create_report_record(
    *,
    reporter_email: str,
    reporter_role: str,
    target_email: str = "",
    context_type: str,
    context_id: str = "",
    content_id: str = "",
    reason: str = "other",
    details: str = "",
) -> Dict[str, Any]:
    reporter = _norm(reporter_email)
    target = _norm(target_email)
    clean_reason = _norm(reason).replace(" ", "_")
    if clean_reason not in ALLOWED_REPORT_REASONS:
        clean_reason = "other"

    if not reporter:
        raise HTTPException(status_code=401, detail="Unable to identify reporting user.")

    report_id = uuid4().hex
    if SessionLocal is None:
        raise HTTPException(status_code=503, detail="Safety reporting is temporarily unavailable.")

    db = SessionLocal()
    try:
        ensure_safety_tables(db)
        db.execute(
            text(
                """
                INSERT INTO safety_reports (
                    report_id, reporter_email, reporter_role, target_email,
                    context_type, context_id, content_id, reason, details,
                    status, created_at, updated_at
                )
                VALUES (
                    :report_id, :reporter_email, :reporter_role, :target_email,
                    :context_type, :context_id, :content_id, :reason, :details,
                    'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "report_id": report_id,
                "reporter_email": reporter,
                "reporter_role": _norm(reporter_role),
                "target_email": target,
                "context_type": str(context_type or "user").strip()[:80],
                "context_id": str(context_id or "").strip()[:160],
                "content_id": str(content_id or "").strip()[:160],
                "reason": clean_reason,
                "details": str(details or "").strip()[:2000],
            },
        )
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to submit report: {exc}")
    finally:
        db.close()

    return {
        "report_id": report_id,
        "status": "open",
        "reason": clean_reason,
        "created_at": _now_iso(),
    }


def block_user_pair(blocker_email: str, blocked_email: str) -> None:
    blocker = _norm(blocker_email)
    blocked = _norm(blocked_email)
    if not blocker or not blocked:
        raise HTTPException(status_code=400, detail="Both users are required.")
    if blocker == blocked:
        raise HTTPException(status_code=400, detail="You cannot block your own account.")
    if SessionLocal is None:
        raise HTTPException(status_code=503, detail="Blocking is temporarily unavailable.")

    db = SessionLocal()
    try:
        ensure_safety_tables(db)
        existing = db.execute(
            text(
                """
                SELECT 1 FROM user_blocks
                WHERE blocker_email = :blocker AND blocked_email = :blocked
                LIMIT 1
                """
            ),
            {"blocker": blocker, "blocked": blocked},
        ).first()
        if not existing:
            db.execute(
                text(
                    """
                    INSERT INTO user_blocks (blocker_email, blocked_email, created_at)
                    VALUES (:blocker, :blocked, CURRENT_TIMESTAMP)
                    """
                ),
                {"blocker": blocker, "blocked": blocked},
            )
            db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to block user: {exc}")
    finally:
        db.close()


@router.get("/safety/blocks")
def list_my_blocks(
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = _norm(user.get("email") or user.get("sub"))
    ensure_safety_tables(db)
    rows = db.execute(
        text(
            """
            SELECT blocked_email, created_at
            FROM user_blocks
            WHERE blocker_email = :email
            ORDER BY created_at DESC
            """
        ),
        {"email": email},
    ).mappings().all()
    return {"ok": True, "blocks": [dict(row) for row in rows]}


@router.post("/safety/blocks")
def block_user(
    payload: BlockUserPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    blocker = _norm(user.get("email") or user.get("sub"))
    target = _norm(payload.target_email)
    block_user_pair(blocker, target)
    return {"ok": True, "blocked": True, "target_email": target}


@router.delete("/safety/blocks/{target_email}")
def unblock_user(
    target_email: str,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blocker = _norm(user.get("email") or user.get("sub"))
    target = _norm(target_email)
    ensure_safety_tables(db)
    db.execute(
        text(
            """
            DELETE FROM user_blocks
            WHERE blocker_email = :blocker AND blocked_email = :blocked
            """
        ),
        {"blocker": blocker, "blocked": target},
    )
    db.commit()
    return {"ok": True, "blocked": False, "target_email": target}


@router.post("/safety/reports")
def submit_safety_report(
    payload: SafetyReportCreate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    result = create_report_record(
        reporter_email=_norm(user.get("email") or user.get("sub")),
        reporter_role=_norm(user.get("role")),
        target_email=payload.target_email,
        context_type=payload.context_type,
        context_id=payload.context_id,
        content_id=payload.content_id,
        reason=payload.reason,
        details=payload.details,
    )
    return {"ok": True, "report": result}


def _require_admin(user: Dict[str, Any]) -> None:
    if _norm(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


@router.get("/admin/safety/reports")
def admin_list_safety_reports(
    status: str = "open",
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    ensure_safety_tables(db)
    clean_status = _norm(status)
    if clean_status in {"all", "*"}:
        rows = db.execute(
            text("SELECT * FROM safety_reports ORDER BY created_at DESC LIMIT 500")
        ).mappings().all()
    else:
        rows = db.execute(
            text(
                """
                SELECT * FROM safety_reports
                WHERE status = :status
                ORDER BY created_at DESC
                LIMIT 500
                """
            ),
            {"status": clean_status or "open"},
        ).mappings().all()
    return {"ok": True, "reports": [dict(row) for row in rows]}


@router.patch("/admin/safety/reports/{report_id}")
def admin_update_safety_report(
    report_id: str,
    payload: SafetyReportStatusPayload,
    user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(user)
    next_status = _norm(payload.status)
    if next_status not in {"open", "reviewing", "resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="Invalid report status.")

    ensure_safety_tables(db)
    result = db.execute(
        text(
            """
            UPDATE safety_reports
            SET status = :status, updated_at = CURRENT_TIMESTAMP
            WHERE report_id = :report_id
            """
        ),
        {"status": next_status, "report_id": report_id},
    )
    db.commit()
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"ok": True, "report_id": report_id, "status": next_status}
