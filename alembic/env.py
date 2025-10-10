# alembic/env.py
from __future__ import annotations

import os, sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

IN_CI = os.getenv("GITHUB_ACTIONS") or os.getenv("CI")

# ── Alembic config & logging ─────────────────────────────────────────────────
config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# ── Load env vars (.env) only outside CI ─────────────────────────────────────
if not IN_CI:
    try:
        from dotenv import load_dotenv  # optional for local dev
        load_dotenv(dotenv_path=ROOT / ".env")  # override=False by default
    except Exception:
        pass

# ── Choose the DB URL ────────────────────────────────────────────────────────
if IN_CI:
    # In CI: trust ONLY the environment variable, ignore .env / alembic.ini
    db_url = os.environ.get("DATABASE_URL")
else:
    # Locally: allow DATABASE_URL or fallback to alembic.ini
    db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")

if not db_url:
    raise RuntimeError("Set DATABASE_URL (preferred) or sqlalchemy.url in alembic.ini/.env")

# In CI, auto-rewrite localhost -> service hostname 'postgres'
if IN_CI and ("127.0.0.1" in db_url or "@localhost" in db_url or "://localhost" in db_url):
    from urllib.parse import urlparse, urlunparse
    raw = db_url.replace("postgresql+psycopg2://", "postgresql://")
    u = urlparse(raw)
    userinfo = (u.username or "postgres"), (u.password or "postgres")
    host = "postgres"
    port = u.port or 5432
    path = u.path or "/eventdb"
    db_url = f"postgresql+psycopg2://{userinfo[0]}:{userinfo[1]}@{host}:{port}{path}"

# Mirror URL into Alembic config for consistency
config.set_main_option("sqlalchemy.url", db_url)
print(f"[db] Effective DATABASE_URL = {db_url}")
is_sqlite = db_url.startswith("sqlite:")

# ── Import Base & models so metadata is populated ────────────────────────────
from app.db import Base  # your project's declarative Base

for mod in (
    "app.models.event",
    "app.models.vendor",
    "app.models.application",
    "app.models.slot",
    # add "app.models.user", etc. when they exist
):
    try:
        __import__(mod)
    except Exception as e:
        print(f"[alembic] optional import failed: {mod}: {e}")

target_metadata = Base.metadata

def _include_object(object, name, type_, reflected, compare_to):
    return True  # manage everything

# ── Migration runners ────────────────────────────────────────────────────────
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
