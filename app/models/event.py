# app/models/event.py
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.database import Base


class Event(Base):
    __tablename__ = "events"

    # Identity / ownership
    id = sa.Column(sa.Integer, primary_key=True)
    organizer_id = sa.Column(sa.Integer, nullable=False)

    # Core public details
    title = sa.Column(sa.String, nullable=False)
    description = sa.Column(sa.Text, nullable=True)

    # Stored as VARCHAR in DB (legacy decision). Keep as String.
    # NOTE: your DB currently shows this column is NOT NULL.
    date = sa.Column(sa.String(64), nullable=False)

    location = sa.Column(sa.String, nullable=True)
    city = sa.Column(sa.String, nullable=True)

    max_vendor_slots = sa.Column(sa.Integer, nullable=True, server_default=sa.text("0"))

    created_at = sa.Column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )
    updated_at = sa.Column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("CURRENT_TIMESTAMP"),
    )

    # IMPORTANT: match DB contract (NOT NULL + default 'general')
    # This prevents SQLAlchemy from ever inserting kind=NULL.
    kind = sa.Column(
        sa.String,
        nullable=False,
        server_default=sa.text("'general'"),
    )

    business_only = sa.Column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    badge_required = sa.Column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )

    # Capacity fields (if migrations added them; safe even if unused by UI contract)
    total_vendor_capacity = sa.Column(sa.Integer, nullable=True)
    category_vendor_capacity = sa.Column(
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    )
