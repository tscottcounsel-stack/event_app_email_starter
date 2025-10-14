# models.py
from __future__ import annotations

from sqlalchemy import Column, Integer, String, Text

from db import Base


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    date = Column(String(64), nullable=True)
    start_time = Column(String(64), nullable=True)
    end_time = Column(String(64), nullable=True)
    location = Column(String(255), nullable=True)


class Vendor(Base):
    __tablename__ = "vendors"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)


class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, nullable=True)
    vendor_id = Column(Integer, nullable=True)
    price_cents = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String(64), default="pending")
