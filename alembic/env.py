# alembic/env.py
from __future__ import annotations

import os, sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# ── Ensure project root on sys.path & load .env BEFORE importing app modules ──
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv  # optional
    load_dotenv(dotenv_path=ROOT / ".env")
except Exception:
    pass

# ── Alembic config & logging ─────────────────────────────────────────────────
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Prefer DATABASE_URL; fallback to alembic.ini sqlalchemy.url
db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if not db_url:
    raise RuntimeError("Set DATABASE_URL or sqlalchemy.url in alembic.ini")
config.set_main_option("sqlalchemy.url", db_url)
is_sqlite = db_url.startswith("sqlite:")

# ── Import Base & models exactly once (so metadata is populated) ──────────────
# ── Import Base & models exactly once (so metadata is populated) ──────────────
from app.db import Base  # single source of truth for Base

def _try_import(mod: str):
    try:
        __import__(mod)
        return True
    except Exception as e:
        print(f"[alembic] optional import failed: {mod}: {e}")
        return False

# Import model modules so tables register on Base.metadata
for mod in (
    "app.models.event",
    "app.models.vendor",
    "app.models.application",
    "app.models.slot",
    # "app.models.user",  # uncomment only if this module actually exists
):
    _try_import(mod)

target_metadata = Base.metadata

# If you want to restrict tables later, re-enable include_object after baseline.
def _include_object(object, name, type_, reflected, compare_to):
    return True  # baseline: include everything

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
