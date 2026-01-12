# app/models/user.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base  # Same Base used in slot.py


class User(Base):
    """
    ORM mapping for the existing `users` table.

    Columns (from Postgres):

        id              integer  PK
        email           varchar, unique, not null
        hashed_password varchar, not null
        role            varchar, nullable
        is_active       boolean, not null, default true
        password_hash   text, nullable (legacy)
        created_at      timestamptz, not null, default now()
        updated_at      timestamptz, not null, default now()
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, index=True)

    email: Mapped[str] = mapped_column(
        sa.String,
        nullable=False,
        unique=True,
        index=True,
    )

    # Canonical password column going forward.
    hashed_password: Mapped[str] = mapped_column(
        sa.String,
        nullable=False,
    )

    # "vendor", "organizer", "admin", etc.
    role: Mapped[Optional[str]] = mapped_column(
        sa.String,
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        server_default=sa.true(),
    )

    # Legacy / unused but present in DB schema.
    password_hash: Mapped[Optional[str]] = mapped_column(
        sa.Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} email={self.email!r} role={self.role!r}>"
