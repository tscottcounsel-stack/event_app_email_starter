from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.db import Base


class Event(Base):
    __tablename__ = "events"

    id = sa.Column(Integer, primary_key=True, index=True)

    title = sa.Column(String, nullable=False, index=True)
    description = sa.Column(Text, nullable=True)

    start_date = sa.Column(DateTime(timezone=True), nullable=True)
    end_date = sa.Column(DateTime(timezone=True), nullable=True)

    venue_name = sa.Column(String, nullable=True)
    street_address = sa.Column(String, nullable=True)
    city = sa.Column(String, nullable=True, index=True)
    state = sa.Column(String, nullable=True, index=True)
    zip_code = sa.Column(String, nullable=True)

    ticket_sales_url = sa.Column(String, nullable=True)
    google_maps_url = sa.Column(String, nullable=True)
    category = sa.Column(String, nullable=True, index=True)

    hero_image_url = sa.Column(String, nullable=True)
    image_urls = sa.Column(sa.JSON, nullable=False, default=list)
    video_urls = sa.Column(sa.JSON, nullable=False, default=list)

    organizer_email = sa.Column(String, nullable=True, index=True)
    owner_email = sa.Column(String, nullable=True, index=True)
    organizer_id = sa.Column(String, nullable=True, index=True)
    owner_id = sa.Column(String, nullable=True)
    created_by = sa.Column(String, nullable=True)

    published = sa.Column(Boolean, nullable=False, default=False)
    archived = sa.Column(Boolean, nullable=False, default=False)
    requirements_published = sa.Column(Boolean, nullable=False, default=False)
    layout_published = sa.Column(Boolean, nullable=False, default=False)

    created_at = sa.Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = sa.Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    applications = relationship(
        "Application",
        back_populates="event",
        cascade="all, delete-orphan",
    )

    booths = relationship(
        "Booth",
        back_populates="event",
        cascade="all, delete-orphan",
    )

    diagrams = relationship(
        "Diagram",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="Diagram.id",
    )