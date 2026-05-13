from __future__ import annotations

from datetime import datetime, timedelta, timezone
import mimetypes
import os
import secrets
from typing import Any, Dict, Optional
from uuid import uuid4

import boto3
import sqlalchemy as sa
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.models.verification_document import (
    DocumentAccessGrant,
    DocumentAccessRequest,
    DocumentAuditLog,
    VerificationDocument,
)
from app.routers.auth import get_current_user

router = APIRouter(tags=["Verification Documents"])

VALID_OWNER_ROLES = {"vendor", "organizer"}
VALID_DOCUMENT_TYPES = {
    "business_license",
    "government_id",
    "certificate_of_insurance",
    "insurance_certificate",
    "food_handler_permit",
    "health_permit",
    "sales_tax_permit",
    "w9_document",
    "business_registration",
    "other",
}
ALLOWED_UPLOAD_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_UPLOAD_BYTES = int(os.getenv("VERIFICATION_DOC_MAX_BYTES", str(15 * 1024 * 1024)))
DEFAULT_UPLOAD_URL_SECONDS = int(os.getenv("VERIFICATION_DOC_UPLOAD_URL_SECONDS", "900"))
DEFAULT_VIEW_URL_SECONDS = int(os.getenv("VERIFICATION_DOC_VIEW_URL_SECONDS", "300"))
DEFAULT_GRANT_DAYS = int(os.getenv("VERIFICATION_DOC_GRANT_DAYS", "7"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _frontend_base_url() -> str:
    return _safe_str(os.getenv("PUBLIC_FRONTEND_URL") or os.getenv("FRONTEND_URL") or "https://vendcore.co").rstrip("/")


def _public_shared_link(token: str) -> str:
    return f"{_frontend_base_url()}/shared-documents/{token}"


def _new_share_token() -> str:
    return secrets.token_urlsafe(32)


def _json_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _send_document_share_email(to_email: str, *, vendor_email: str, link: str, organization_name: str = "", note: str = "") -> None:
    try:
        from app.routers.auth import _send_resend_email  # type: ignore
    except Exception:
        _send_resend_email = None  # type: ignore
    if _send_resend_email is None:
        print(f"Document share email skipped to {to_email}: email helper unavailable")
        return
    subject = "VendCore document access shared with you"
    org_line = f" for {organization_name}" if organization_name else ""
    safe_note = f"<p><strong>Vendor note:</strong> {note}</p>" if note else ""
    html = f"""
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.6; max-width:640px; margin:0 auto;">
      <h1>VendCore document access</h1>
      <p>A VendCore vendor ({vendor_email}) shared limited document access{org_line}.</p>
      {safe_note}
      <p>This private link only opens the documents the vendor approved for sharing. It expires automatically.</p>
      <p style="margin:28px 0;">
        <a href="{link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          View shared documents
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280;">If the button does not work, copy and paste this link into your browser:<br />{link}</p>
      <p>— VendCore</p>
    </div>
    """
    text = f"A VendCore vendor ({vendor_email}) shared limited document access with you. View here: {link}\n\n{note or ''}\n\n— VendCore"
    _send_resend_email(to_email=to_email, subject=subject, html=html, text=text)


def _send_document_request_email(to_email: str, *, requester_email: str, requester_name: str = "", organization_name: str = "", event_name: str = "", message: str = "") -> None:
    try:
        from app.routers.auth import _send_resend_email  # type: ignore
    except Exception:
        _send_resend_email = None  # type: ignore
    if _send_resend_email is None:
        print(f"Document request email skipped to {to_email}: email helper unavailable")
        return
    requester = requester_name or requester_email
    subject = "New VendCore document access request"
    details = "".join([
        f"<p><strong>Requester:</strong> {requester}</p>",
        f"<p><strong>Email:</strong> {requester_email}</p>",
        f"<p><strong>Organization:</strong> {organization_name}</p>" if organization_name else "",
        f"<p><strong>Event:</strong> {event_name}</p>" if event_name else "",
        f"<p><strong>Message:</strong> {message}</p>" if message else "",
    ])
    html = f"""
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.6; max-width:640px; margin:0 auto;">
      <h1>Document access request</h1>
      <p>An organizer requested limited access to your VendCore verification documents.</p>
      {details}
      <p>Log in to VendCore and approve only the documents you want to share.</p>
      <p style="margin:28px 0;">
        <a href="{_frontend_base_url()}/vendor/document-requests" style="background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700;">
          Review request
        </a>
      </p>
      <p>— VendCore</p>
    </div>
    """
    text = f"{requester} ({requester_email}) requested access to your VendCore documents. Review: {_frontend_base_url()}/vendor/document-requests"
    _send_resend_email(to_email=to_email, subject=subject, html=html, text=text)


def _ensure_document_access_schema(db: Session) -> None:
    """Small runtime schema guard for Railway while formal migrations are not yet in place."""
    try:
        bind = db.get_bind()
        dialect = bind.dialect.name
        if dialect != "postgresql":
            return
        statements = [
            "ALTER TABLE document_access_grants ADD COLUMN IF NOT EXISTS access_token VARCHAR",
            "ALTER TABLE document_access_grants ADD COLUMN IF NOT EXISTS granted_to_name VARCHAR",
            "ALTER TABLE document_access_grants ADD COLUMN IF NOT EXISTS organization_name VARCHAR",
            "ALTER TABLE document_access_grants ADD COLUMN IF NOT EXISTS public_note TEXT",
            "ALTER TABLE document_access_grants ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "CREATE INDEX IF NOT EXISTS ix_document_access_grants_access_token ON document_access_grants (access_token)",
            "CREATE TABLE IF NOT EXISTS document_access_requests (id SERIAL PRIMARY KEY, vendor_email VARCHAR NOT NULL, requester_email VARCHAR NOT NULL, requester_name VARCHAR, organization_name VARCHAR, event_name VARCHAR, requested_document_types JSONB NOT NULL DEFAULT '[]'::jsonb, message TEXT, status VARCHAR NOT NULL DEFAULT 'pending', share_token VARCHAR, responded_at TIMESTAMPTZ, responded_by VARCHAR, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
            "CREATE INDEX IF NOT EXISTS ix_document_access_requests_vendor_email ON document_access_requests (vendor_email)",
            "CREATE INDEX IF NOT EXISTS ix_document_access_requests_requester_email ON document_access_requests (requester_email)",
            "CREATE INDEX IF NOT EXISTS ix_document_access_requests_status ON document_access_requests (status)",
            "CREATE INDEX IF NOT EXISTS ix_document_access_requests_share_token ON document_access_requests (share_token)",
        ]
        for statement in statements:
            db.execute(sa.text(statement))
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Document access schema guard skipped: {exc}")



def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _require_role(value: Any) -> str:
    role = _safe_lower(value)
    if role not in VALID_OWNER_ROLES:
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
        raise HTTPException(status_code=400, detail="Invalid expires_at date")


def _bucket_name() -> str:
    bucket = _safe_str(os.getenv("AWS_S3_VERIFICATION_BUCKET"))
    if not bucket:
        raise HTTPException(status_code=500, detail="AWS_S3_VERIFICATION_BUCKET is not set")
    return bucket


def _s3_client():
    region = _safe_str(os.getenv("AWS_REGION") or "us-east-2")
    try:
        return boto3.client("s3", region_name=region)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to initialize S3 client: {exc}")


def _profile_for_user(db: Session, email: str, role: str) -> Optional[Profile]:
    return (
        db.query(Profile)
        .filter(func.lower(Profile.email) == _safe_lower(email), Profile.role == _safe_lower(role))
        .one_or_none()
    )


def _clean_filename(filename: str) -> str:
    base = os.path.basename(_safe_str(filename) or "document")
    cleaned = "".join(ch for ch in base if ch.isalnum() or ch in {".", "-", "_", " "}).strip()
    return cleaned[:140] or "document"


def _normalize_doc_type(value: Any) -> str:
    doc_type = _safe_lower(value).replace(" ", "_").replace("-", "_")
    if doc_type not in VALID_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document_type")
    return doc_type


def _guess_mime(filename: str, provided: str = "") -> str:
    provided = _safe_lower(provided)
    guessed = mimetypes.guess_type(filename)[0] or ""
    mime = provided or guessed or "application/octet-stream"
    if mime not in ALLOWED_UPLOAD_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF, JPG, PNG, or WEBP verification documents are allowed")
    return mime


def _storage_key(*, owner_role: str, owner_email: str, document_type: str, filename: str) -> str:
    safe_email = _safe_lower(owner_email).replace("@", "_at_").replace(".", "_")
    ext = os.path.splitext(filename)[1].lower()[:12]
    return f"prod/{owner_role}s/{safe_email}/verification/{document_type}/{uuid4().hex}{ext}"


def _audit(db: Session, request: Optional[Request], user: Dict[str, Any], action: str, document_id: Optional[int] = None, data: Optional[Dict[str, Any]] = None) -> None:
    db.add(
        DocumentAuditLog(
            document_id=document_id,
            actor_email=_safe_lower(user.get("email")),
            actor_role=_safe_lower(user.get("role")),
            action=action,
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            data=data or {},
        )
    )


def _document_public(row: VerificationDocument) -> Dict[str, Any]:
    return {
        "id": row.id,
        "owner_email": row.owner_email,
        "owner_role": row.owner_role,
        "owner_profile_id": row.owner_profile_id,
        "document_type": row.document_type,
        "display_name": row.display_name,
        "original_filename": row.original_filename,
        "mime_type": row.mime_type,
        "file_size": row.file_size,
        "status": row.status,
        "review_status": row.review_status,
        "scan_status": row.scan_status,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "reviewed_by": row.reviewed_by,
        "notes": row.notes,
        "rejection_reason": row.rejection_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _can_view_document(db: Session, row: VerificationDocument, user: Dict[str, Any]) -> bool:
    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))
    if role == "admin":
        return True
    if email and email == _safe_lower(row.owner_email) and role == _safe_lower(row.owner_role):
        return True
    if role == "organizer" and email:
        grant = (
            db.query(DocumentAccessGrant)
            .filter(
                DocumentAccessGrant.document_id == row.id,
                func.lower(DocumentAccessGrant.granted_to_email) == email,
                DocumentAccessGrant.revoked_at.is_(None),
                DocumentAccessGrant.expires_at > _now(),
            )
            .first()
        )
        return grant is not None
    return False


@router.post("/verification-documents/upload-url")
def create_verification_document_upload_url(payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(user.get("email"))
    role = _require_role(user.get("role"))
    if not email:
        raise HTTPException(status_code=401, detail="Authenticated email required")

    document_type = _normalize_doc_type(payload.get("document_type") or payload.get("type"))
    original_filename = _clean_filename(payload.get("filename") or payload.get("name") or f"{document_type}.pdf")
    mime_type = _guess_mime(original_filename, payload.get("mime_type") or payload.get("content_type"))
    file_size = int(payload.get("file_size") or payload.get("size") or 0)
    if file_size and file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"Document is too large. Max size is {MAX_UPLOAD_BYTES} bytes")

    bucket = _bucket_name()
    key = _storage_key(owner_role=role, owner_email=email, document_type=document_type, filename=original_filename)
    profile = _profile_for_user(db, email, role)

    row = VerificationDocument(
        owner_email=email,
        owner_role=role,
        owner_profile_id=profile.id if profile else None,
        document_type=document_type,
        display_name=_safe_str(payload.get("display_name") or payload.get("label") or document_type.replace("_", " ").title()),
        bucket=bucket,
        storage_key=key,
        original_filename=original_filename,
        mime_type=mime_type,
        file_size=file_size or None,
        status="upload_url_created",
        review_status="pending",
        scan_status="pending",
        expires_at=_parse_datetime(payload.get("expires_at") or payload.get("expiration_date")),
        metadata_json={"upload_url_created_at": _now().isoformat()},
    )
    db.add(row)
    db.flush()

    try:
        upload_url = _s3_client().generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ContentType": mime_type,
            },
            ExpiresIn=DEFAULT_UPLOAD_URL_SECONDS,
        )
    except (BotoCoreError, ClientError) as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to create S3 upload URL: {exc}")

    _audit(db, request, user, "verification_document_upload_url_created", row.id, {"document_type": document_type})
    db.commit()
    db.refresh(row)

    return {
        "ok": True,
        "document": _document_public(row),
        "upload_url": upload_url,
        "method": "PUT",
        "headers": {"Content-Type": mime_type},
        "expires_in_seconds": DEFAULT_UPLOAD_URL_SECONDS,
    }


@router.post("/verification-documents/{document_id}/complete-upload")
def complete_verification_document_upload(document_id: int, payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(VerificationDocument).filter(VerificationDocument.id == int(document_id), VerificationDocument.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    if _safe_lower(user.get("role")) != "admin" and (_safe_lower(user.get("email")) != _safe_lower(row.owner_email) or _safe_lower(user.get("role")) != _safe_lower(row.owner_role)):
        raise HTTPException(status_code=403, detail="You can only complete uploads for your own documents")

    try:
        head = _s3_client().head_object(Bucket=row.bucket, Key=row.storage_key)
    except ClientError as exc:
        raise HTTPException(status_code=400, detail=f"S3 object not found yet: {exc}")
    except BotoCoreError as exc:
        raise HTTPException(status_code=500, detail=f"Unable to verify S3 object: {exc}")

    size = int(head.get("ContentLength") or row.file_size or 0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Uploaded document is larger than allowed")

    row.status = "uploaded"
    row.review_status = "pending"
    row.scan_status = _safe_lower(payload.get("scan_status") or "pending")
    row.file_size = size or row.file_size
    row.checksum_sha256 = _safe_str(payload.get("checksum_sha256")) or row.checksum_sha256
    row.metadata_json = {**(row.metadata_json or {}), "completed_at": _now().isoformat(), "s3_etag": _safe_str(head.get("ETag"))}

    _audit(db, request, user, "verification_document_upload_completed", row.id)
    db.commit()
    db.refresh(row)
    return {"ok": True, "document": _document_public(row)}


def _doc_url_from_legacy_doc(doc: Dict[str, Any]) -> str:
    return _safe_str(
        doc.get("url")
        or doc.get("file_url")
        or doc.get("fileUrl")
        or doc.get("secure_url")
        or doc.get("href")
        or doc.get("dataUrl")
        or doc.get("path")
    )


def _legacy_doc_type(doc: Dict[str, Any]) -> str:
    raw = _safe_lower(doc.get("type") or doc.get("document_type") or doc.get("category") or doc.get("key") or "other")
    raw = raw.replace(" ", "_").replace("-", "_")
    return raw if raw in VALID_DOCUMENT_TYPES else "other"


def _legacy_doc_label(doc: Dict[str, Any], doc_type: str) -> str:
    return _safe_str(doc.get("label") or doc.get("display_name") or doc.get("name") or doc.get("original_filename") or doc_type.replace("_", " ").title())


def _sync_legacy_profile_documents(db: Session, *, email: str, role: str) -> None:
    """Backfill older verification docs stored in Profile.data into the secure document table.

    Earlier VendCore verification uploads were stored as document metadata on the
    profile/verification record. The new sharing flow expects rows in
    verification_documents. This keeps existing verified users from seeing an
    empty share vault while we move toward the S3-backed document vault.
    """
    profile = _profile_for_user(db, email, role)
    if profile is None:
        return

    data = profile.data if isinstance(profile.data, dict) else {}
    legacy_docs = data.get("documents") if isinstance(data.get("documents"), list) else []
    if not legacy_docs:
        return

    changed = False
    for item in legacy_docs:
        if not isinstance(item, dict):
            continue

        external_url = _doc_url_from_legacy_doc(item)
        if not external_url:
            continue

        doc_type = _legacy_doc_type(item)
        label = _legacy_doc_label(item, doc_type)
        filename = _clean_filename(_safe_str(item.get("name") or item.get("original_filename") or f"{doc_type}.pdf"))
        storage_key = f"legacy-profile-doc://{role}/{email}/{doc_type}/{abs(hash(external_url))}"

        existing = (
            db.query(VerificationDocument)
            .filter(
                func.lower(VerificationDocument.owner_email) == email,
                VerificationDocument.owner_role == role,
                VerificationDocument.storage_key == storage_key,
                VerificationDocument.deleted_at.is_(None),
            )
            .one_or_none()
        )
        if existing is not None:
            continue

        expires_at = None
        try:
            expires_at = _parse_datetime(item.get("expires_at") or item.get("expiration_date") or item.get("expirationDate"))
        except HTTPException:
            expires_at = None

        row = VerificationDocument(
            owner_email=email,
            owner_role=role,
            owner_profile_id=profile.id,
            document_type=doc_type,
            display_name=label,
            bucket="legacy_profile_document",
            storage_key=storage_key,
            original_filename=filename,
            mime_type=_safe_str(item.get("mime_type") or item.get("type") or "application/pdf") or "application/pdf",
            file_size=int(item.get("size") or item.get("file_size") or 0) or None,
            checksum_sha256=None,
            status="approved" if profile.verified else "uploaded",
            review_status="approved" if profile.verified else "pending",
            scan_status="legacy",
            expires_at=expires_at,
            reviewed_at=profile.updated_at if profile.verified else None,
            reviewed_by="legacy_profile_import" if profile.verified else None,
            notes="Imported from existing verification profile document metadata.",
            metadata_json={
                "source": "legacy_profile_document",
                "external_url": external_url,
                "legacy_document": item,
            },
        )
        db.add(row)
        changed = True

    if changed:
        db.commit()


def _list_my_verification_documents_payload(user: dict, db: Session) -> Dict[str, Any]:
    _ensure_document_access_schema(db)
    email = _safe_lower(user.get("email"))
    role = _require_role(user.get("role"))
    if not email:
        raise HTTPException(status_code=401, detail="Authenticated email required")

    _sync_legacy_profile_documents(db, email=email, role=role)

    rows = (
        db.query(VerificationDocument)
        .filter(func.lower(VerificationDocument.owner_email) == email, VerificationDocument.owner_role == role, VerificationDocument.deleted_at.is_(None))
        .order_by(VerificationDocument.created_at.desc())
        .all()
    )
    return {"ok": True, "documents": [_document_public(row) for row in rows]}


@router.get("/verification-documents/me")
def list_my_verification_documents(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return _list_my_verification_documents_payload(user, db)


@router.get("/verification-documents/my")
def list_my_verification_documents_alias(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return _list_my_verification_documents_payload(user, db)


@router.get("/verification-documents/admin/pending")
def list_pending_verification_documents(db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    rows = (
        db.query(VerificationDocument)
        .filter(VerificationDocument.deleted_at.is_(None), VerificationDocument.review_status == "pending")
        .order_by(VerificationDocument.created_at.desc())
        .all()
    )
    return {"ok": True, "documents": [_document_public(row) for row in rows], "count": len(rows)}


@router.post("/verification-documents/{document_id}/approve")
def approve_verification_document(document_id: int, payload: Dict[str, Any], request: Request, db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    row = db.query(VerificationDocument).filter(VerificationDocument.id == int(document_id), VerificationDocument.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    row.status = "approved"
    row.review_status = "approved"
    row.reviewed_at = _now()
    row.reviewed_by = _safe_lower(user.get("email"))
    row.notes = _safe_str(payload.get("notes")) or row.notes
    expiration = _parse_datetime(payload.get("expires_at") or payload.get("expiration_date"))
    if expiration:
        row.expires_at = expiration
    _audit(db, request, user, "verification_document_approved", row.id)
    db.commit()
    db.refresh(row)
    return {"ok": True, "document": _document_public(row)}


@router.post("/verification-documents/{document_id}/reject")
def reject_verification_document(document_id: int, payload: Dict[str, Any], request: Request, db: Session = Depends(get_db), user: dict = Depends(_require_admin)):
    row = db.query(VerificationDocument).filter(VerificationDocument.id == int(document_id), VerificationDocument.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    row.status = "rejected"
    row.review_status = "rejected"
    row.reviewed_at = _now()
    row.reviewed_by = _safe_lower(user.get("email"))
    row.rejection_reason = _safe_str(payload.get("reason") or payload.get("rejection_reason"))
    row.notes = _safe_str(payload.get("notes")) or row.notes
    _audit(db, request, user, "verification_document_rejected", row.id, {"reason": row.rejection_reason})
    db.commit()
    db.refresh(row)
    return {"ok": True, "document": _document_public(row)}


@router.get("/verification-documents/{document_id}/view-url")
def create_verification_document_view_url(document_id: int, request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(VerificationDocument).filter(VerificationDocument.id == int(document_id), VerificationDocument.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    if not _can_view_document(db, row, user):
        raise HTTPException(status_code=403, detail="Document access not granted")
    try:
        view_url = _s3_client().generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": row.bucket, "Key": row.storage_key, "ResponseContentDisposition": f'inline; filename="{_clean_filename(row.original_filename or row.document_type)}"'},
            ExpiresIn=DEFAULT_VIEW_URL_SECONDS,
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create S3 view URL: {exc}")
    _audit(db, request, user, "verification_document_view_url_created", row.id)
    db.commit()
    return {"ok": True, "view_url": view_url, "expires_in_seconds": DEFAULT_VIEW_URL_SECONDS, "document": _document_public(row)}


@router.post("/verification-documents/{document_id}/grant-access")
def grant_verification_document_access(document_id: int, payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.query(VerificationDocument).filter(VerificationDocument.id == int(document_id), VerificationDocument.deleted_at.is_(None)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Verification document not found")
    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))
    if role != "admin" and (email != _safe_lower(row.owner_email) or role != _safe_lower(row.owner_role)):
        raise HTTPException(status_code=403, detail="Only the document owner or admin can grant access")
    granted_to_email = _safe_lower(payload.get("organizer_email") or payload.get("granted_to_email") or payload.get("email"))
    if not granted_to_email:
        raise HTTPException(status_code=400, detail="Organizer email required")
    expires_at = _parse_datetime(payload.get("expires_at")) or (_now() + timedelta(days=DEFAULT_GRANT_DAYS))
    grant = DocumentAccessGrant(
        document_id=row.id,
        owner_email=row.owner_email,
        granted_to_email=granted_to_email,
        granted_to_role="organizer",
        purpose=_safe_str(payload.get("purpose") or "organizer_document_review"),
        expires_at=expires_at,
        created_by=email,
    )
    db.add(grant)
    _audit(db, request, user, "verification_document_access_granted", row.id, {"granted_to_email": granted_to_email, "expires_at": expires_at.isoformat()})
    db.commit()
    db.refresh(grant)
    return {"ok": True, "grant": {"id": grant.id, "document_id": grant.document_id, "granted_to_email": grant.granted_to_email, "expires_at": grant.expires_at.isoformat()}}


@router.post("/verification-documents/grants/{grant_id}/revoke")
def revoke_verification_document_access(grant_id: int, request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.query(DocumentAccessGrant).filter(DocumentAccessGrant.id == int(grant_id), DocumentAccessGrant.revoked_at.is_(None)).one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="Access grant not found")
    email = _safe_lower(user.get("email"))
    role = _safe_lower(user.get("role"))
    if role != "admin" and email != _safe_lower(grant.owner_email):
        raise HTTPException(status_code=403, detail="Only the document owner or admin can revoke access")
    grant.revoked_at = _now()
    _audit(db, request, user, "verification_document_access_revoked", grant.document_id, {"grant_id": grant.id})
    db.commit()
    return {"ok": True, "revoked": True}


@router.post("/verification-documents/share-bundle")
def share_verification_document_bundle(payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    owner_email = _safe_lower(user.get("email"))
    owner_role = _safe_lower(user.get("role"))
    if owner_role not in VALID_OWNER_ROLES or not owner_email:
        raise HTTPException(status_code=403, detail="Vendor or organizer account required")

    recipient_email = _safe_lower(payload.get("recipient_email") or payload.get("organizer_email") or payload.get("email"))
    if not recipient_email:
        raise HTTPException(status_code=400, detail="Organizer email is required")

    document_ids = [int(x) for x in _json_list(payload.get("document_ids") or payload.get("documents")) if str(x).strip().isdigit()]
    if not document_ids:
        raise HTTPException(status_code=400, detail="Select at least one document to share")

    rows = (
        db.query(VerificationDocument)
        .filter(
            VerificationDocument.id.in_(document_ids),
            func.lower(VerificationDocument.owner_email) == owner_email,
            VerificationDocument.owner_role == owner_role,
            VerificationDocument.deleted_at.is_(None),
        )
        .all()
    )
    if len(rows) != len(set(document_ids)):
        raise HTTPException(status_code=400, detail="One or more documents could not be shared")

    expires_at = _parse_datetime(payload.get("expires_at")) or (_now() + timedelta(days=int(payload.get("expires_in_days") or DEFAULT_GRANT_DAYS)))
    token = _new_share_token()
    recipient_name = _safe_str(payload.get("recipient_name") or payload.get("organizer_name"))
    organization_name = _safe_str(payload.get("organization_name") or payload.get("event_name") or payload.get("organizer_organization"))
    purpose = _safe_str(payload.get("purpose") or "organizer_document_review")
    note = _safe_str(payload.get("note") or payload.get("message") or "")

    grants = []
    for row in rows:
        grant = DocumentAccessGrant(
            document_id=row.id,
            owner_email=row.owner_email,
            granted_to_email=recipient_email,
            granted_to_role="organizer",
            access_token=token,
            granted_to_name=recipient_name or None,
            organization_name=organization_name or None,
            public_note=note or None,
            purpose=purpose,
            expires_at=expires_at,
            created_by=owner_email,
            metadata_json={"source": "vendor_bundle_share", "document_type": row.document_type},
        )
        db.add(grant)
        grants.append(grant)
        _audit(db, request, user, "verification_document_bundle_access_granted", row.id, {"granted_to_email": recipient_email, "token": token, "expires_at": expires_at.isoformat()})

    db.commit()
    for grant in grants:
        db.refresh(grant)

    link = _public_shared_link(token)
    _send_document_share_email(recipient_email, vendor_email=owner_email, link=link, organization_name=organization_name, note=note)
    return {
        "ok": True,
        "share_token": token,
        "share_url": link,
        "expires_at": expires_at.isoformat(),
        "grants": [
            {"id": grant.id, "document_id": grant.document_id, "granted_to_email": grant.granted_to_email, "expires_at": grant.expires_at.isoformat()}
            for grant in grants
        ],
    }


@router.get("/verification-documents/grants/mine")
def list_my_document_access_grants(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    owner_email = _safe_lower(user.get("email"))
    owner_role = _safe_lower(user.get("role"))
    if owner_role not in VALID_OWNER_ROLES or not owner_email:
        raise HTTPException(status_code=403, detail="Vendor or organizer account required")

    rows = (
        db.query(DocumentAccessGrant, VerificationDocument)
        .join(VerificationDocument, VerificationDocument.id == DocumentAccessGrant.document_id)
        .filter(func.lower(DocumentAccessGrant.owner_email) == owner_email)
        .order_by(DocumentAccessGrant.created_at.desc())
        .all()
    )
    grants = []
    for grant, doc in rows:
        grants.append({
            "id": grant.id,
            "document_id": grant.document_id,
            "document": _document_public(doc),
            "granted_to_email": grant.granted_to_email,
            "granted_to_name": getattr(grant, "granted_to_name", None),
            "organization_name": getattr(grant, "organization_name", None),
            "purpose": grant.purpose,
            "share_token": getattr(grant, "access_token", None),
            "share_url": _public_shared_link(getattr(grant, "access_token", "")) if getattr(grant, "access_token", None) else None,
            "expires_at": grant.expires_at.isoformat() if grant.expires_at else None,
            "revoked_at": grant.revoked_at.isoformat() if grant.revoked_at else None,
            "created_at": grant.created_at.isoformat() if grant.created_at else None,
        })
    return {"ok": True, "grants": grants}


@router.get("/shared-documents/{token}")
def get_public_shared_documents(token: str, request: Request, db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    cleaned = _safe_str(token)
    if not cleaned:
        raise HTTPException(status_code=404, detail="Shared document link not found")

    rows = (
        db.query(DocumentAccessGrant, VerificationDocument)
        .join(VerificationDocument, VerificationDocument.id == DocumentAccessGrant.document_id)
        .filter(
            DocumentAccessGrant.access_token == cleaned,
            DocumentAccessGrant.revoked_at.is_(None),
            DocumentAccessGrant.expires_at > _now(),
            VerificationDocument.deleted_at.is_(None),
        )
        .order_by(VerificationDocument.document_type.asc(), VerificationDocument.created_at.desc())
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Shared document link is expired, revoked, or unavailable")

    first_grant = rows[0][0]
    documents = []
    for grant, doc in rows:
        metadata = doc.metadata_json if isinstance(doc.metadata_json, dict) else {}
        external_url = _safe_str(metadata.get("external_url"))

        if external_url:
            view_url = external_url
        else:
            try:
                view_url = _s3_client().generate_presigned_url(
                    ClientMethod="get_object",
                    Params={"Bucket": doc.bucket, "Key": doc.storage_key, "ResponseContentDisposition": f'inline; filename="{_clean_filename(doc.original_filename or doc.document_type)}"'},
                    ExpiresIn=DEFAULT_VIEW_URL_SECONDS,
                )
            except (BotoCoreError, ClientError) as exc:
                raise HTTPException(status_code=500, detail=f"Unable to create S3 view URL: {exc}")

        _audit(db, request, {"email": first_grant.granted_to_email, "role": "external_organizer"}, "shared_document_public_view_url_created", doc.id, {"token": cleaned})
        public_doc = _document_public(doc)
        public_doc["view_url"] = view_url
        public_doc["view_url_expires_in_seconds"] = DEFAULT_VIEW_URL_SECONDS if not external_url else None
        documents.append(public_doc)

    db.commit()
    return {
        "ok": True,
        "share": {
            "token": cleaned,
            "owner_email": first_grant.owner_email,
            "granted_to_email": first_grant.granted_to_email,
            "granted_to_name": getattr(first_grant, "granted_to_name", None),
            "organization_name": getattr(first_grant, "organization_name", None),
            "note": getattr(first_grant, "public_note", None),
            "purpose": first_grant.purpose,
            "expires_at": first_grant.expires_at.isoformat() if first_grant.expires_at else None,
        },
        "documents": documents,
    }


@router.post("/verification-documents/request-access")
def request_public_document_access(payload: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    vendor_email = _safe_lower(payload.get("vendor_email") or payload.get("owner_email"))
    requester_email = _safe_lower(payload.get("requester_email") or payload.get("email"))
    if not vendor_email:
        raise HTTPException(status_code=400, detail="Vendor email is required")
    if not requester_email:
        raise HTTPException(status_code=400, detail="Requester email is required")

    row = DocumentAccessRequest(
        vendor_email=vendor_email,
        requester_email=requester_email,
        requester_name=_safe_str(payload.get("requester_name") or payload.get("name")) or None,
        organization_name=_safe_str(payload.get("organization_name") or payload.get("organization") or payload.get("business")) or None,
        event_name=_safe_str(payload.get("event_name") or payload.get("event")) or None,
        requested_document_types=_json_list(payload.get("requested_document_types") or payload.get("document_types")),
        message=_safe_str(payload.get("message") or payload.get("notes")) or None,
        status="pending",
        metadata_json={"source": "public_document_request", "user_agent": request.headers.get("user-agent")},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _send_document_request_email(vendor_email, requester_email=requester_email, requester_name=row.requester_name or "", organization_name=row.organization_name or "", event_name=row.event_name or "", message=row.message or "")
    return {"ok": True, "request": _document_access_request_public(row)}


def _document_access_request_public(row: DocumentAccessRequest) -> Dict[str, Any]:
    return {
        "id": row.id,
        "vendor_email": row.vendor_email,
        "requester_email": row.requester_email,
        "requester_name": row.requester_name,
        "organization_name": row.organization_name,
        "event_name": row.event_name,
        "requested_document_types": row.requested_document_types or [],
        "message": row.message,
        "status": row.status,
        "share_token": row.share_token,
        "share_url": _public_shared_link(row.share_token) if row.share_token else None,
        "responded_at": row.responded_at.isoformat() if row.responded_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/verification-documents/access-requests/mine")
def list_my_document_access_requests(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    owner_email = _safe_lower(user.get("email"))
    owner_role = _safe_lower(user.get("role"))
    if owner_role != "vendor" or not owner_email:
        raise HTTPException(status_code=403, detail="Vendor account required")
    rows = (
        db.query(DocumentAccessRequest)
        .filter(func.lower(DocumentAccessRequest.vendor_email) == owner_email)
        .order_by(DocumentAccessRequest.created_at.desc())
        .all()
    )
    return {"ok": True, "requests": [_document_access_request_public(row) for row in rows]}


@router.post("/verification-documents/access-requests/{request_id}/respond")
def respond_to_document_access_request(request_id: int, payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_document_access_schema(db)
    owner_email = _safe_lower(user.get("email"))
    owner_role = _safe_lower(user.get("role"))
    if owner_role != "vendor" or not owner_email:
        raise HTTPException(status_code=403, detail="Vendor account required")
    row = db.query(DocumentAccessRequest).filter(DocumentAccessRequest.id == int(request_id), func.lower(DocumentAccessRequest.vendor_email) == owner_email).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Document access request not found")

    decision = _safe_lower(payload.get("decision") or payload.get("status"))
    if decision in {"decline", "declined", "reject", "rejected"}:
        row.status = "declined"
        row.responded_at = _now()
        row.responded_by = owner_email
        db.commit()
        db.refresh(row)
        return {"ok": True, "request": _document_access_request_public(row)}

    document_ids = [int(x) for x in _json_list(payload.get("document_ids") or payload.get("documents")) if str(x).strip().isdigit()]
    if not document_ids:
        raise HTTPException(status_code=400, detail="Select at least one document to share")

    rows = (
        db.query(VerificationDocument)
        .filter(
            VerificationDocument.id.in_(document_ids),
            func.lower(VerificationDocument.owner_email) == owner_email,
            VerificationDocument.owner_role == "vendor",
            VerificationDocument.deleted_at.is_(None),
        )
        .all()
    )
    if len(rows) != len(set(document_ids)):
        raise HTTPException(status_code=400, detail="One or more documents could not be shared")

    expires_at = _parse_datetime(payload.get("expires_at")) or (_now() + timedelta(days=int(payload.get("expires_in_days") or DEFAULT_GRANT_DAYS)))
    token = _new_share_token()
    note = _safe_str(payload.get("note") or payload.get("message") or "")
    grants = []
    for doc in rows:
        grant = DocumentAccessGrant(
            document_id=doc.id,
            owner_email=doc.owner_email,
            granted_to_email=row.requester_email,
            granted_to_role="organizer",
            access_token=token,
            granted_to_name=row.requester_name,
            organization_name=row.organization_name or row.event_name,
            public_note=note or row.message,
            purpose="approved_document_access_request",
            expires_at=expires_at,
            created_by=owner_email,
            metadata_json={"source": "document_access_request", "request_id": row.id, "document_type": doc.document_type},
        )
        db.add(grant)
        grants.append(grant)
        _audit(db, request, user, "document_access_request_approved_document_shared", doc.id, {"request_id": row.id, "token": token})
    row.status = "approved"
    row.share_token = token
    row.responded_at = _now()
    row.responded_by = owner_email
    db.commit()
    link = _public_shared_link(token)
    _send_document_share_email(row.requester_email, vendor_email=owner_email, link=link, organization_name=row.organization_name or row.event_name or "", note=note or row.message or "")
    db.refresh(row)
    return {"ok": True, "request": _document_access_request_public(row), "share_token": token, "share_url": link, "grants": [{"id": g.id, "document_id": g.document_id} for g in grants]}
