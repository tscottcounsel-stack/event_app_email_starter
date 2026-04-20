from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.db import Base


class Booth(Base):
    __tablename__ = "booths"

    id = sa.Column(Integer, primary_key=True, index=True)
    event_id = sa.Column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    label = sa.Column(String, nullable=False, index=True)
    x = sa.Column(Integer, nullable=False, default=0)
    y = sa.Column(Integer, nullable=False, default=0)
    w = sa.Column(Integer, nullable=False, default=1)
    h = sa.Column(Integer, nullable=False, default=1)

    category_id = sa.Column(String, nullable=True, index=True)
    price_override = sa.Column(sa.Float, nullable=True)
    status = sa.Column(String, nullable=False, default="available", index=True)

    created_at = sa.Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    event = relationship("Event", back_populates="booths")