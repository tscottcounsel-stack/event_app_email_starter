# app/models/application.py

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.db import Base


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)

    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)

    status = Column(String, nullable=False, default="pending")

    # Denormalized vendor display name snapshot (optional).
    # If you later move to vendor_id + join to vendors table, you can deprecate this.
    vendor_name = Column(String, nullable=True)

    event = relationship("Event", back_populates="applications")
