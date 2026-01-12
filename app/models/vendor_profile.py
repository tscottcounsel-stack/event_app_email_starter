# app/models/vendor_profile.py
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from app.db import Base


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    id = Column(Integer, primary_key=True)
    business_name = Column(String, nullable=True)
    contact_name = Column(String, nullable=True)
