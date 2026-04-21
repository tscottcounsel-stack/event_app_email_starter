from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

import sqlalchemy as sa
from sqlalchemy import DateTime, func
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# Load .env from project root if present
ROOT = Path(__file__).resolve().parents[1]
dotenv_path = ROOT / ".env"
if dotenv_path.exists():
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(dotenv_path=dotenv_path)
    except Exception:
        pass

DATABASE_URL = os.getenv("DATABASE_URL")

print("[db] Effective DATABASE_URL =", DATABASE_URL)

engine = None
SessionLocal = None

try:
    if DATABASE_URL:
        engine = sa.create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    else:
        print("WARNING: DATABASE_URL not set, running without DB")
except Exception as e:
    print("DB INIT FAILED:", e)
    engine = None
    SessionLocal = None

Base = declarative_base()


class TimestampMixin:
    created_at = sa.orm.mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = sa.orm.mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    __table_args__ = {"extend_existing": True}


def get_db() -> Generator[Session, None, None]:
    if SessionLocal is None:
        raise RuntimeError("Database session is not available")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    if engine is not None:
        print(">>> DB ENGINE URL:", engine.url)
        Base.metadata.create_all(bind=engine)
    
