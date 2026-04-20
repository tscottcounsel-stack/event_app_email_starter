from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import relationship

from app.db import Base


class Diagram(Base):
    __tablename__ = "diagrams"

    id = sa.Column(Integer, primary_key=True, index=True)
    event_id = sa.Column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    diagram = sa.Column(sa.JSON, nullable=False, default=dict)
    version = sa.Column(Integer, nullable=False, default=0)

    created_at = sa.Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = sa.Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    event = relationship("Event", back_populates="diagrams")
