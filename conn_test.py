import os

import sqlalchemy as sa

u = os.environ["DATABASE_URL"]
print("URL =", u)
e = sa.create_engine(u, pool_pre_ping=True)
with e.connect() as c:
    print("Connected OK:", c.exec_driver_sql("select version()").scalar())
