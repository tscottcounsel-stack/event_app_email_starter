from __future__ import annotations
from typing import Optional

from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin  # your table has created_at/updated_at, so mixin is OK


class Application(TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False
    )

    # REQUIRED by DB (NOT NULL)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    # DB default is 'submitted'; API may send "pending"/etc.
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="submitted")

    # Use the TEXT 'notes' column; we ignore the stray varchar 'note' column
    notes: Mapped[Optional[str]] = mapped_column(Text)

    event = relationship("Event", back_populates="applications")
    vendor = relationship("Vendor", back_populates="applications")
