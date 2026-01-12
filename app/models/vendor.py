# app/models/vendor.py
from __future__ import annotations

from typing import List, Optional

from sqlalchemy import Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin


class Vendor(TimestampMixin, Base):
    """
    Canonical vendor model.

    NOTE:
    - Database table is `vendor_profiles`
    - Older code referenced `vendors`, which does NOT exist
    """

    __tablename__ = "vendor_profiles"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Core profile fields
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    website: Mapped[Optional[str]] = mapped_column(String(255))
    about: Mapped[Optional[str]] = mapped_column(Text)

    # Optional linkage (only if your schema has it)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # NEW: public story + checklist + categories
    # These columns must already exist from the Alembic migration.
    vendor_story: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Simple JSON arrays of strings, used for badges and categories.
    checklist_tags: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    vendor_categories: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)

    # Applications linked via vendor_profile_id
    applications: Mapped[List["Application"]] = relationship(
        "Application",
        back_populates="vendor",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
