# alembic/env.py
from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Use env var first; fall back to alembic.ini only locally
db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if not db_url:
    raise RuntimeError("Set DATABASE_URL (preferred) or sqlalchemy.url")

# Keep Alembic CLI in sync
config.set_main_option("sqlalchemy.url", db_url)

# --- Preflight: connect once with psycopg2 so we see the real cause clearly ---
try:
    from urllib.parse import urlparse

    import psycopg2

    p = urlparse(db_url.replace("postgresql+psycopg2://", "postgresql://"))
    conn = psycopg2.connect(
        dbname=(p.path or "/").lstrip("/") or "postgres",
        user=p.username or "postgres",
        host=p.hostname or "127.0.0.1",
        port=p.port or 5432,
        password=p.password or "",  # empty is fine when service uses trust
    )
    conn.close()
    print("[db] Preflight psycopg2 connect: OK")
except Exception as e:
    raise RuntimeError(f"[db] Preflight psycopg2 connect failed: {e}")

# We don't need metadata/autogenerate here
target_metadata = None


def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(db_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
