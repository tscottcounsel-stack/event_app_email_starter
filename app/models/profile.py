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
