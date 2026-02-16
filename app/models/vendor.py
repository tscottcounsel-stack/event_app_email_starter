# app/models/vendor.py

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.db import Base


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True, index=True)

    # Minimal safe fields
    company_name = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
