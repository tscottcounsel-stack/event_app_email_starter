# alembic/env.py
from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# ── Alembic config & logging ────────────────────────────────────────────────
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# ── Choose DB URL (CI: env var; local: env var or alembic.ini) ──────────────
db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if not db_url:
    raise RuntimeError("Set DATABASE_URL (preferred) or sqlalchemy.url in alembic.ini/.env")

# Mirror into Alembic so CLI shows the same URL
config.set_main_option("sqlalchemy.url", db_url)

# ── Preflight: connect once with psycopg2 so we see the *real* error clearly ─
try:
    import psycopg2
    from urllib.parse import urlparse
    p = urlparse(db_url.replace("postgresql+psycopg2://", "postgresql://"))
    conn = psycopg2.connect(
        dbname=(p.path or "/").lstrip("/") or "postgres",
        user=p.username or "postgres",
        host=p.hostname or "127.0.0.1",
        port=p.port or 5432,
        password=p.password or "",  # empty is fine with HOST_AUTH_METHOD=trust
    )
    conn.close()
    print("[db] Preflight psycopg2 connect: OK")
except Exception as e:
    # show the exact server error here and stop
    raise RuntimeError(f"[db] Preflight psycopg2 connect failed: {e}")

# We are not using autogenerate; metadata isn’t required for these migrations.
target_metadata = None

def _include_object(object, name, type_, reflected, compare_to):
    return True

# ── Migration runners ───────────────────────────────────────────────────────
def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
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
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
