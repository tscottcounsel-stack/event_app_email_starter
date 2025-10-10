# app/db.py
from __future__ import annotations
import os
from pathlib import Path
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from datetime import datetime
from sqlalchemy import DateTime, func
from typing import Generator

# Load .env from project root if present
ROOT = Path(__file__).resolve().parents[1]
dotenv_path = ROOT / ".env"
if dotenv_path.exists():
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(dotenv_path=dotenv_path)
    except Exception:
        pass

# *** FORCE the working DSN for now ***
# If you want env to win, comment the next line and rely on os.environ
DATABASE_URL = "postgresql+psycopg2://postgres:Tazvendor@127.0.0.1:5432/eventdb"

print("[db] Effective DATABASE_URL =", DATABASE_URL)

engine = sa.create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

class TimestampMixin:
    created_at = sa.orm.mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = sa.orm.mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    __table_args__ = {"extend_existing": True}

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
