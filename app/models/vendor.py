from __future__ import annotations
from typing import Optional, List

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin


class Vendor(TimestampMixin, Base):
    __tablename__ = "vendors"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text)

    # Reverse side for Application.vendor
    applications: Mapped[List["Application"]] = relationship(
        "Application",
        back_populates="vendor",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
applications = relationship("Application", back_populates="vendor", cascade="all, delete-orphan")
