from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db import Base  # ← matches your project (NOT app.database)


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)

    organizer_email = Column(String, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=True)

    rating = Column(Integer, nullable=False)
    comment = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # optional relationship (safe even if not used yet)
    vendor = relationship("Vendor", backref="reviews")
