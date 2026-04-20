from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.db import Base


class Application(Base):
    __tablename__ = "applications"

    id = sa.Column(Integer, primary_key=True, index=True)
    event_id = sa.Column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    vendor_email = sa.Column(String, nullable=True, index=True)
    vendor_name = sa.Column(String, nullable=True)
    vendor_display_name = sa.Column(String, nullable=True)
    vendor_company_name = sa.Column(String, nullable=True)

    booth_id = sa.Column(String, nullable=True, index=True)
    payment_status = sa.Column(String, nullable=True, index=True)
    booth_reserved_until = sa.Column(DateTime(timezone=True), nullable=True)

    status = sa.Column(String, nullable=False, default="draft", index=True)
    notes = sa.Column(Text, nullable=True)

    docs = sa.Column(sa.JSON, nullable=False, default=dict)
    checked = sa.Column(sa.JSON, nullable=False, default=dict)

    created_at = sa.Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = sa.Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    event = relationship("Event", back_populates="applications")
