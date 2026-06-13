from __future__ import annotations

from datetime import datetime, timedelta, timezone
import mimetypes
import os
from typing import Any, Dict, List, Optional
from uuid import uuid4

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.profile import Profile
from app.models.verification_document import (
    DocumentAccessGrant,
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


def _legacy_doc_type(value: Any) -> str:
    """Map older verification/profile document labels to vault document types."""
    raw = _safe_lower(value).replace("-", "_").replace(" ", "_").replace("/", "_")
    aliases = {
        "business_license": "business_license",
        "business_license_registration": "business_license",
        "business_registration": "business_registration",
        "dba_business_registration": "business_registration",
        "certificate_of_insurance": "certificate_of_insurance",
        "insurance": "certificate_of_insurance",
        "insurance_certificate": "insurance_certificate",
        "coi": "certificate_of_insurance",
        "w_9": "w9_document",
        "w9": "w9_document",
        "w9_document": "w9_document",
        "sales_tax_resale_permit": "sales_tax_permit",
        "sales_tax_permit": "sales_tax_permit",
        "resale_permit": "sales_tax_permit",
        "government_id": "government_id",
        "identity_verification_support": "government_id",
        "food_handler_permit": "food_handler_permit",
        "health_permit": "health_permit",
    }
    if raw in VALID_DOCUMENT_TYPES:
        return raw
    if raw in aliases:
        return aliases[raw]
    for token, mapped in aliases.items():
        if token and token in raw:
            return mapped
    return "other"


def _legacy_doc_mime(filename: str, provided: Any = "", url: str = "") -> str:
    provided_mime = _safe_lower(provided)
    if provided_mime in ALLOWED_UPLOAD_MIME_TYPES:
        return provided_mime

    guessed = mimetypes.guess_type(filename or url)[0] or ""
    if guessed in ALLOWED_UPLOAD_MIME_TYPES:
        return guessed

    lowered = _safe_lower(url or filename)
    if lowered.startswith("data:application/pdf") or ".pdf" in lowered:
        return "application/pdf"
    if lowered.startswith("data:image/png") or lowered.endswith(".png"):
        return "image/png"
    if lowered.startswith("data:image/webp") or lowered.endswith(".webp"):
        return "image/webp"
    if lowered.startswith("data:image/jpeg") or lowered.startswith("data:image/jpg") or lowered.endswith(".jpg") or lowered.endswith(".jpeg"):
        return "image/jpeg"

    return "application/pdf"


def _legacy_doc_label(item: Dict[str, Any], document_type: str) -> str:
    label = _safe_str(
        item.get("display_name")
        or item.get("label")
        or item.get("name")
        or item.get("original_filename")
    )
    if label:
        return label
    return document_type.replace("_", " ").title()


def _backfill_profile_documents(db: Session, *, email: str, role: str) -> None:
    """Create vault rows for older verification-record/profile documents.

    Some older verification uploads were saved only inside profile.data["documents"].
    The send-docs page needs real verification_documents IDs, so this performs a
    conservative one-way backfill. It does not delete or modify existing vault rows.
    """
    profile = _profile_for_user(db, email, role)
    if profile is None:
        return

    data = profile.data if isinstance(profile.data, dict) else {}
    raw_docs = data.get("documents")
    if not isinstance(raw_docs, list):
        return

    changed = False
    for item in raw_docs:
        if not isinstance(item, dict):
            continue

        document_type = _legacy_doc_type(
            item.get("document_type")
            or item.get("type")
            or item.get("label")
            or item.get("name")
            or item.get("category")
        )
        url = _safe_str(item.get("url") or item.get("file_url") or item.get("fileUrl"))
        filename = _clean_filename(
            item.get("original_filename")
            or item.get("filename")
            or item.get("name")
            or item.get("label")
            or f"{document_type}.pdf"
        )
        label = _legacy_doc_label(item, document_type)
        storage_key = _safe_str(item.get("storage_key") or item.get("key"))
        if not storage_key:
            storage_key = f"legacy-profile-doc://{role}/{email}/{document_type}/{abs(hash(url or filename or label))}"

        existing = (
            db.query(VerificationDocument)
            .filter(
                func.lower(VerificationDocument.owner_email) == _safe_lower(email),
                VerificationDocument.owner_role == _safe_lower(role),
                VerificationDocument.storage_key == storage_key,
                VerificationDocument.deleted_at.is_(None),
            )
            .first()
        )
        if existing is not None:
            continue

        row = VerificationDocument(
            owner_email=_safe_lower(email),
            owner_role=_safe_lower(role),
            owner_profile_id=profile.id,
            document_type=document_type,
            display_name=label,
            bucket=_safe_str(item.get("bucket")) or "legacy_profile_document",
            storage_key=storage_key,
            original_filename=filename,
            mime_type=_legacy_doc_mime(filename, item.get("mime_type") or item.get("content_type"), url),
            file_size=int(item.get("file_size") or item.get("size") or 0) or None,
            status=_safe_lower(item.get("status")) or "approved",
            review_status=_safe_lower(item.get("review_status") or item.get("reviewStatus") or item.get("public_status") or item.get("status")) or "approved",
            scan_status=_safe_lower(item.get("scan_status")) or "not_scanned",
            expires_at=_parse_datetime(item.get("expires_at") or item.get("expiration_date") or item.get("expirationDate")),
            uploaded_at=_now(),
            reviewed_at=_now() if _safe_lower(item.get("review_status") or item.get("status")) in {"approved", "verified", "reviewed"} else None,
            metadata_json={
                "source": "profile_data_backfill",
                "legacy_url": url,
                "backfilled_at": _now().isoformat(),
            },
        )
        db.add(row)
        changed = True

    if changed:
        db.commit()


def _grant_public(grant: DocumentAccessGrant, document: Optional[VerificationDocument] = None, share_url: str = "") -> Dict[str, Any]:
    return {
        "id": grant.id,
        "document_id": grant.document_id,
        "document": _document_public(document) if document is not None else None,
        "granted_to_email": grant.granted_to_email,
        "granted_to_name": getattr(grant, "granted_to_name", None),
        "organization_name": getattr(grant, "organization_name", None),
        "share_url": share_url,
        "expires_at": grant.expires_at.isoformat() if grant.expires_at else None,
        "revoked_at": grant.revoked_at.isoformat() if getattr(grant, "revoked_at", None) else None,
        "created_at": grant.created_at.isoformat() if getattr(grant, "created_at", None) else None,
    }


def _frontend_origin(request: Request) -> str:
    origin = _safe_str(request.headers.get("origin"))
    if origin:
        return origin.rstrip("/")
    return f"{request.url.scheme}://{request.url.netloc}".rstrip("/")


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
                "Metadata": {
                    "owner_email": email,
                    "owner_role": role,
                    "document_type": document_type,
                    "verification_document_id": str(row.id),
                },
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


@router.get("/verification-documents/me")
def list_my_verification_documents(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(user.get("email"))
    role = _require_role(user.get("role"))
    _backfill_profile_documents(db, email=email, role=role)
    rows = (
        db.query(VerificationDocument)
        .filter(func.lower(VerificationDocument.owner_email) == email, VerificationDocument.owner_role == role, VerificationDocument.deleted_at.is_(None))
        .order_by(VerificationDocument.created_at.desc())
        .all()
    )
    return {"ok": True, "documents": [_document_public(row) for row in rows]}


@router.get("/verification-documents/my")
def list_my_verification_documents_alias(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    # Backward-compatible alias used by the Send Verified Documents page.
    return list_my_verification_documents(user=user, db=db)


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


@router.get("/verification-documents/grants/mine")
def list_my_verification_document_grants(request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(user.get("email"))
    role = _require_role(user.get("role"))
    rows = (
        db.query(DocumentAccessGrant, VerificationDocument)
        .join(VerificationDocument, VerificationDocument.id == DocumentAccessGrant.document_id)
        .filter(
            func.lower(DocumentAccessGrant.owner_email) == email,
            VerificationDocument.owner_role == role,
            VerificationDocument.deleted_at.is_(None),
        )
        .order_by(DocumentAccessGrant.id.desc())
        .limit(100)
        .all()
    )
    origin = _frontend_origin(request)
    grants = [
        _grant_public(grant, doc, f"{origin}/shared-documents/{grant.id}")
        for grant, doc in rows
    ]
    return {"ok": True, "grants": grants}


@router.post("/verification-documents/share-bundle")
def create_verification_document_share_bundle(payload: Dict[str, Any], request: Request, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _safe_lower(user.get("email"))
    role = _require_role(user.get("role"))
    if not email:
        raise HTTPException(status_code=401, detail="Authenticated email required")

    document_ids = payload.get("document_ids") or payload.get("documentIds") or []
    if not isinstance(document_ids, list) or not document_ids:
        raise HTTPException(status_code=400, detail="Select at least one document to share.")

    granted_to_email = _safe_lower(
        payload.get("recipient_email")
        or payload.get("granted_to_email")
        or payload.get("organizer_email")
        or payload.get("email")
    )
    if not granted_to_email:
        raise HTTPException(status_code=400, detail="Recipient email required")

    try:
        expires_in_days = int(payload.get("expires_in_days") or payload.get("expiresInDays") or DEFAULT_GRANT_DAYS)
    except Exception:
        expires_in_days = DEFAULT_GRANT_DAYS
    expires_in_days = max(1, min(expires_in_days, 90))
    expires_at = _now() + timedelta(days=expires_in_days)

    grants: List[DocumentAccessGrant] = []
    origin = _frontend_origin(request)

    for raw_id in document_ids:
        try:
            document_id = int(raw_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid document id")

        row = (
            db.query(VerificationDocument)
            .filter(
                VerificationDocument.id == document_id,
                func.lower(VerificationDocument.owner_email) == email,
                VerificationDocument.owner_role == role,
                VerificationDocument.deleted_at.is_(None),
            )
            .one_or_none()
        )
        if row is None:
            raise HTTPException(status_code=404, detail=f"Verification document {document_id} not found")

        grant = DocumentAccessGrant(
            document_id=row.id,
            owner_email=row.owner_email,
            granted_to_email=granted_to_email,
            granted_to_role="organizer",
            purpose=_safe_str(payload.get("purpose") or "owner_sent_document_bundle"),
            expires_at=expires_at,
            created_by=email,
        )
        db.add(grant)
        db.flush()
        grants.append(grant)
        _audit(
            db,
            request,
            user,
            "verification_document_bundle_access_granted",
            row.id,
            {
                "granted_to_email": granted_to_email,
                "expires_at": expires_at.isoformat(),
                "recipient_name": _safe_str(payload.get("recipient_name")),
                "organization_name": _safe_str(payload.get("organization_name")),
                "note": _safe_str(payload.get("note")),
            },
        )

    db.commit()
    for grant in grants:
        db.refresh(grant)

    share_url = f"{origin}/shared-documents/{grants[0].id}" if grants else ""
    return {
        "ok": True,
        "share_url": share_url,
        "grants": [_grant_public(grant, None, f"{origin}/shared-documents/{grant.id}") for grant in grants],
        "expires_at": expires_at.isoformat(),
        "emailed": False,
        "message": "Secure document access created.",
    }


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
