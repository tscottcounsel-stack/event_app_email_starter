# backend/database.py
from app.db import Base
from __future__ import annotations

import os
import atexit
from urllib.parse import urlsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool


def _is_app_test_sqlite_url(url: str) -> bool:
    if not url or not isinstance(url, str) or not url.lower().startswith("sqlite"):
        return False
    try:
        parts = urlsplit(url)
        path = (parts.path or "").replace("\\", "/")
        base = path.rsplit("/", 1)[-1].lower()
        return base.startswith("app_test_") and base.endswith(".db")
    except Exception:
        return False


# Accept either env var name; default to a local file if neither is set.
_raw_url = os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URL") or "sqlite:///./app.db"

# If the tests passed a temp file like .../app_test_XXXX.db, force in-memory.
if _is_app_test_sqlite_url(_raw_url):
    DATABASE_URL = "sqlite:///:memory:"
    os.environ["DATABASE_URL"] = DATABASE_URL
    os.environ["SQLALCHEMY_DATABASE_URL"] = DATABASE_URL
else:
    DATABASE_URL = _raw_url

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool,       # avoid pooled connections (helps Windows cleanup)
    connect_args=connect_args,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)

Base = declarative_base()


@atexit.register
def _dispose_engine_at_exit():
    try:
        engine.dispose()
    except Exception:
        pass
