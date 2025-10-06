# alembic/env.py
from __future__ import annotations

import os
import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# ── Ensure project root on sys.path & load .env ────────────────────────────────
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv  # optional
    load_dotenv(dotenv_path=ROOT / ".env")
except Exception:
    pass

# ── Alembic config & logging ───────────────────────────────────────────────────
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Prefer DATABASE_URL; fallback to alembic.ini sqlalchemy.url
db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if not db_url:
    raise RuntimeError("Set DATABASE_URL or sqlalchemy.url in alembic.ini")

config.set_main_option("sqlalchemy.url", db_url)
is_sqlite = db_url.startswith("sqlite:")

# --- Import Base and models (tolerant) ----------------------------------------
from app.db import Base

def _try_import(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except Exception:
        return False

# Import only modules that actually exist
_try_import("app.models.event")
_try_import("app.models.vendor")
_try_import("app.models.application")
_try_import("app.models.slot")      # <= our Slot model
# _try_import("app.models.user")    # add if/when available

target_metadata = Base.metadata

# Whitelist the tables to manage now
MANAGED_TABLES = {
    "events",
    "event_slots",
    "applications",
    "vendors",
    # "users",
    # "vendor_profiles",
}

def _include_object(object, name, type_, reflected, compare_to):
    """
    Only manage whitelisted tables, and avoid dropping tables that exist
    in DB but aren't in metadata.
    """
    if type_ == "table":
        if name not in MANAGED_TABLES:
            return False
        if reflected and compare_to is None:  # would become a DROP — block it
            return False
        return True

    parent = getattr(object, "table", None)
    if parent is not None:
        if parent.name not in MANAGED_TABLES:
            return False
        if reflected and compare_to is None:
            return False
    return True

# ── Migration runners ─────────────────────────────────────────────────────────
def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=is_sqlite,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = create_engine(db_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=is_sqlite,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
