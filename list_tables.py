import os, sqlalchemy as sa
e = sa.create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
with e.connect() as c:
    rows = c.exec_driver_sql("""
        select table_name from information_schema.tables
        where table_schema='public' order by 1
    """).scalars().all()
print("\n".join(rows))
