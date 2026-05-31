from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.db import TimestampMixin


class EventCheckIn(Base, TimestampMixin):
    __tablename__ = "event_checkins"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    event_id: Mapped[int] = mapped_column(sa.Integer, nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(sa.Integer, nullable=False, index=True)
    application_id: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, index=True)

    status: Mapped[str] = mapped_column(
        sa.String, default="pending"
    )  # checked_in | late | no_show | rejected

    checked_in_at: Mapped[sa.DateTime] = mapped_column(sa.DateTime, nullable=True)
    checked_in_by: Mapped[int] = mapped_column(sa.Integer, nullable=True)

    notes: Mapped[str] = mapped_column(sa.Text, nullable=True)
