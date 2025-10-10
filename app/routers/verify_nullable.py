import os, sqlalchemy as sa
u=os.environ["DATABASE_URL"]
e=sa.create_engine(u, pool_pre_ping=True)
with e.connect() as c:
    q = """SELECT is_nullable
             FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='applications'
              AND column_name='price_cents'"""
    print("is_nullable =", c.exec_driver_sql(q).scalar())
