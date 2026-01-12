# app/models/application.py
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )

    vendor_profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("vendor_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(length=32), nullable=False, server_default="pending"
    )
    requested_slots: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_due_cents: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    payment_status: Mapped[str] = mapped_column(
        String(length=32), nullable=False, server_default="unpaid"
    )

    assigned_slot_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("event_slots.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
