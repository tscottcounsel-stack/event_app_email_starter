# alembic/env.py
from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# ------------------------------------------------------------
# Config & URL
# ------------------------------------------------------------
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url", "")
if not db_url:
    # Prefer not to crash here, but Alembic needs a URL to do anything useful.
    raise RuntimeError("Set DATABASE_URL (preferred) or sqlalchemy.url in alembic.ini")

# Keep Alembic's idea of the URL in sync so 'alembic current' shows correctly.
config.set_main_option("sqlalchemy.url", db_url)

# ------------------------------------------------------------
# Optional preflight (only if you opt in)
# ------------------------------------------------------------
PREFLIGHT = os.getenv("DB_PREFLIGHT", "0") == "1"
if PREFLIGHT and not context.is_offline_mode():
    try:
        engine = create_engine(db_url, pool_pre_ping=True, future=True)
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        print("[db] Preflight OK")
    except Exception as e:
        # Log and keep going; don't block migrations.
        print(f"[db] Preflight skipped: {e}")

# Weâ€™re not using autogenerate here
target_metadata = None


# ------------------------------------------------------------
# Runners
# ------------------------------------------------------------
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
    connectable = create_engine(db_url, poolclass=pool.NullPool, future=True)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
