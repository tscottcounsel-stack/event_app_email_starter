# app/models/event.py

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.db import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)

    applications = relationship(
        "Application",
        back_populates="event",
        cascade="all, delete-orphan",
    )
