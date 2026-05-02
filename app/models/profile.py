from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from app.db import Base


def _json_type():
    # JSONB when running Postgres, generic JSON otherwise.
    return JSON().with_variant(JSONB, "postgresql")


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        UniqueConstraint("role", "email", name="uq_profiles_role_email"),
        {"extend_existing": True},
    )

    id = sa.Column(Integer, primary_key=True, index=True)
    role = sa.Column(String, nullable=False, index=True)  # vendor | organizer
    email = sa.Column(String, nullable=False, index=True)

    display_name = sa.Column(String, nullable=True, index=True)
    business_name = sa.Column(String, nullable=True, index=True)
    city = sa.Column(String, nullable=True, index=True)
    state = sa.Column(String, nullable=True, index=True)

    categories = sa.Column(_json_type(), nullable=False, default=list)
    data = sa.Column(_json_type(), nullable=False, default=dict)

    verified = sa.Column(Boolean, nullable=False, default=False, index=True)
    verification_status = sa.Column(String, nullable=True, index=True)
    public_verification_status = sa.Column(String, nullable=True, index=True)
    public_verification_label = sa.Column(String, nullable=True)
    review_status = sa.Column(String, nullable=True)

    visibility_tier = sa.Column(String, nullable=True, index=True)
    subscription_plan = sa.Column(String, nullable=True)
    subscription_status = sa.Column(String, nullable=True)
    featured = sa.Column(Boolean, nullable=False, default=False, index=True)
    promoted = sa.Column(Boolean, nullable=False, default=False, index=True)

    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class EventAlert(Base):
    __tablename__ = "event_alerts"
    __table_args__ = (
        UniqueConstraint("vendor_email", "event_id", "category", name="uq_event_alert_vendor_event_category"),
        {"extend_existing": True},
    )

    id = sa.Column(Integer, primary_key=True, index=True)
    vendor_email = sa.Column(String, nullable=False, index=True)
    vendor_profile_id = sa.Column(Integer, nullable=True, index=True)
    event_id = sa.Column(Integer, nullable=False, index=True)
    event_title = sa.Column(String, nullable=True)
    event_city = sa.Column(String, nullable=True)
    event_state = sa.Column(String, nullable=True)
    category = sa.Column(String, nullable=False, index=True)
    alert_type = sa.Column(String, nullable=False, default="new_matching_event", index=True)
    message = sa.Column(String, nullable=False)
    read = sa.Column(Boolean, nullable=False, default=False, index=True)
    data = sa.Column(_json_type(), nullable=False, default=dict)
    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
