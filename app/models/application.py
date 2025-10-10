# app/models/application.py
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    String,
    Text,
    DateTime,
    Integer,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

# Use the project's shared Base (do NOT redefine it locally)
from app.db import Base


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("event_id", "vendor_id", name="uq_applications_event_vendor"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    event_id: Mapped[int] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"),
        nullable=False,
    )

    # pricing / status
    price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)  # <-- matches migration
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default="submitted")

    # flow fields
    desired_location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.current_timestamp(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    # relationships (Event/Vendor must define back_populates="applications")
    event = relationship("Event", back_populates="applications")
    vendor = relationship("Vendor", back_populates="applications")
