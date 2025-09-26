# app/db.py
from __future__ import annotations

import os
from typing import Generator
from datetime import datetime

from sqlalchemy import create_engine, func, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session, Mapped, mapped_column
# ^ Mapped/mapped_column are needed for TimestampMixin

# --- Config ---
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/eventdb",  # fallback for local dev
)

# --- Engine / Session / Base ---
engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)

Base = declarative_base()

# --- Common mixins ---
class TimestampMixin:
    """UTC timestamps with automatic update on write."""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Help avoid duplicate-table crashes if modules get imported twice during dev reload
    __table_args__ = {"extend_existing": True}

# --- FastAPI dependency ---
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
