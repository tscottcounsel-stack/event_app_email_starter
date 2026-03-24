import os

import sqlalchemy as sa

u = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://postgres:Tazvendor@127.0.0.1:5432/eventdb"
)
e = sa.create_engine(u, pool_pre_ping=True)
with e.connect() as c:
    q = """SELECT is_nullable
             FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='applications'
              AND column_name='price_cents'"""
    print("is_nullable =", c.exec_driver_sql(q).scalar())
    print(
        "alembic_version =",
        c.exec_driver_sql("SELECT version_num FROM alembic_version").scalar(),
    )
