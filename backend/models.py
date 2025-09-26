# backend/models.py
from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship

from backend.database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    # Option A (tests expect 200):
    date = Column(String(64), nullable=True)
    location = Column(String(200), nullable=True)
    # Option B (tests expect 201):
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    applications = relationship("Application", back_populates="event", cascade="all, delete-orphan")


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, unique=True, index=True)
    display_name = Column(String(200), nullable=False)
    bio = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    applications = relationship("Application", back_populates="vendor", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_vendor_profiles_user_id", "user_id", unique=True),
    )


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)  # user.id of vendor
    status = Column(String(32), nullable=False, default="pending")
    message = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    event = relationship("Event", back_populates="applications")
    vendor = relationship("VendorProfile", primaryjoin="VendorProfile.user_id==Application.vendor_id", viewonly=True)
