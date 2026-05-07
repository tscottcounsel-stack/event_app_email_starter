from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from app.db import Base


def _json_type():
    return JSON().with_variant(JSONB, "postgresql")


class VerificationDocument(Base):
    __tablename__ = "verification_documents"
    __table_args__ = {"extend_existing": True}

    id = sa.Column(Integer, primary_key=True, index=True)

    owner_email = sa.Column(String, nullable=False, index=True)
    owner_role = sa.Column(String, nullable=False, index=True)  # vendor | organizer
    owner_profile_id = sa.Column(Integer, nullable=True, index=True)

    document_type = sa.Column(String, nullable=False, index=True)
    display_name = sa.Column(String, nullable=True)

    bucket = sa.Column(String, nullable=False)
    storage_key = sa.Column(String, nullable=False, unique=True, index=True)
    original_filename = sa.Column(String, nullable=True)
    mime_type = sa.Column(String, nullable=True)
    file_size = sa.Column(Integer, nullable=True)
    checksum_sha256 = sa.Column(String, nullable=True)

    status = sa.Column(String, nullable=False, default="uploaded", index=True)
    review_status = sa.Column(String, nullable=False, default="pending", index=True)
    scan_status = sa.Column(String, nullable=False, default="pending", index=True)

    expires_at = sa.Column(DateTime(timezone=True), nullable=True, index=True)
    uploaded_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at = sa.Column(DateTime(timezone=True), nullable=True)
    reviewed_by = sa.Column(String, nullable=True)
    deleted_at = sa.Column(DateTime(timezone=True), nullable=True, index=True)

    notes = sa.Column(Text, nullable=True)
    rejection_reason = sa.Column(Text, nullable=True)
    metadata_json = sa.Column(_json_type(), nullable=False, default=dict)

    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DocumentAccessGrant(Base):
    __tablename__ = "document_access_grants"
    __table_args__ = {"extend_existing": True}

    id = sa.Column(Integer, primary_key=True, index=True)
    document_id = sa.Column(Integer, nullable=False, index=True)
    owner_email = sa.Column(String, nullable=False, index=True)
    granted_to_email = sa.Column(String, nullable=False, index=True)
    granted_to_role = sa.Column(String, nullable=False, default="organizer", index=True)
    purpose = sa.Column(String, nullable=True)
    expires_at = sa.Column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at = sa.Column(DateTime(timezone=True), nullable=True, index=True)
    created_by = sa.Column(String, nullable=True)
    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DocumentAuditLog(Base):
    __tablename__ = "document_audit_logs"
    __table_args__ = {"extend_existing": True}

    id = sa.Column(Integer, primary_key=True, index=True)
    document_id = sa.Column(Integer, nullable=True, index=True)
    actor_email = sa.Column(String, nullable=True, index=True)
    actor_role = sa.Column(String, nullable=True, index=True)
    action = sa.Column(String, nullable=False, index=True)
    ip_address = sa.Column(String, nullable=True)
    user_agent = sa.Column(Text, nullable=True)
    data = sa.Column(_json_type(), nullable=False, default=dict)
    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
