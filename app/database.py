# app/database.py
"""
Compatibility shim.

Some modules import `from app.database import get_db` (and sometimes Base).
In this project, DB utilities may live in `app.db`.

This module bridges that gap so imports don't crash during import-time.
"""

from __future__ import annotations

from typing import Generator

try:
    # Preferred: use the project's existing db module if present
    from app.db import Base, SessionLocal, engine, get_db  # type: ignore
except Exception:
    # Fallback: minimal SQLAlchemy session setup
    import os

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, declarative_base, sessionmaker

    DATABASE_URL = os.getenv("DATABASE_URL", "")
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    Base = declarative_base()

    def get_db() -> Generator[Session, None, None]:
        db: Session = SessionLocal()
        try:
            yield db
        finally:
            db.close()
