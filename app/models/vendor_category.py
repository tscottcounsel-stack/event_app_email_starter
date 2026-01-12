# app/models/vendor_category.py
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from app.db import Base


class VendorCategory(Base):
    __tablename__ = "vendor_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=True)
    slug = Column(String, nullable=True)
