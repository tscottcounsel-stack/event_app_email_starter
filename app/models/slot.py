# app/models/slot.py
from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Slot(Base):
    """
    EventSlot backing the organizer/vendor diagrams.

    Geometry is in grid units (not pixels).

    NOTE:
    We keep category_id as a nullable integer, but DO NOT declare a ForeignKey
    here to vendor_categories until the VendorCategory model/table is reliably
    registered in Base.metadata (to avoid NoReferencedTableError at runtime).
    """

    __tablename__ = "event_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )

    label: Mapped[str] = mapped_column(String(length=32), nullable=False)

    x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    price_cents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0",
    )

    status: Mapped[str] = mapped_column(
        String(length=32),
        nullable=False,
        server_default="available",
    )

    kind: Mapped[str] = mapped_column(
        String(length=32),
        nullable=False,
        server_default="standard",
    )

    # IMPORTANT: keep as plain nullable int for now (no ORM FK)
    category_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "label",
            name="event_slots_event_id_label_key",
        ),
    )
