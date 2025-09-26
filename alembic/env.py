# alembic/env.py
from __future__ import annotations

import os
import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db import Base
from app.models import application, event, vendor  # ensure tables register
target_metadata = Base.metadata


# --- Alembic config & logging ---
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Debug print if you pass: alembic -x debug=1 ...
args = context.get_x_argument(as_dictionary=True)
if args.get("debug"):
    print("ALEMBIC DEBUG: sqlalchemy.url =", config.get_main_option("sqlalchemy.url"))
    print("ALEMBIC DEBUG: script_location =", config.get_main_option("script_location"))

# Prefer env var over ini
db_url = os.environ.get("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# --- Ensure project root importable ---
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# --- Locate Base & import models so metadata is populated ---
Base = None

try:
    from app.db import Base as _AppBase
    Base = _AppBase
    try:
        from app.models import event, vendor, application  # adjust to your modules
    except Exception:
        pass
except Exception:
    pass

if Base is None:
    try:
        from models import Base as _FlatBase
        Base = _FlatBase
    except Exception:
        pass

if Base is None:
    try:
        from backend.config.database import Base as _BackendBase
        Base = _BackendBase
        try:
            import backend.models  # or: from backend.models import event, vendor, application
        except Exception:
            pass
    except Exception:
        pass

if Base is None:
    raise RuntimeError(
        "Alembic env.py could not import your SQLAlchemy Base. "
        "Fix the import above to point to where Base is defined."
    )

target_metadata = Base.metadata

# --- Offline / Online runners ---
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    if not url:
        raise RuntimeError("No sqlalchemy.url configured (DATABASE_URL not set and alembic.ini empty).")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    if not section.get("sqlalchemy.url") and db_url:
        config.set_main_option("sqlalchemy.url", db_url)

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
