# app/models/event.py
from __future__ import annotations
from typing import Optional, List
from datetime import datetime

from sqlalchemy import Integer, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base  # <- no TimestampMixin here

class Event(Base):  # <- removed TimestampMixin
    __tablename__ = "events"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organizer_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(), nullable=False)  # timestamp w/o tz
    location: Mapped[str] = mapped_column(String(255), nullable=False)

    description: Mapped[Optional[str]] = mapped_column(Text)
    diagram_url: Mapped[Optional[str]] = mapped_column(String(255))
    layout_json: Mapped[Optional[str]] = mapped_column(Text)

    applications: Mapped[List["Application"]] = relationship(
        "Application",
        back_populates="event",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
