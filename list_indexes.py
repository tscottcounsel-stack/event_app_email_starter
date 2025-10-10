import os, sqlalchemy as sa
e = sa.create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
sql = """
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='organizer_profiles'
order by indexname;
"""
with e.connect() as c:
    for r in c.exec_driver_sql(sql):
        print(f"{r.indexname:35}  {r.indexdef}")
