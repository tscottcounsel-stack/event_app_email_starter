import os, sqlalchemy as sa
u=os.environ["DATABASE_URL"]; e=sa.create_engine(u, pool_pre_ping=True)
with e.connect() as c:
    for tbl in ("events","vendors"):
        print(tbl, c.exec_driver_sql(f"select count(*) from {tbl}").scalar())
    print("sample ids:",
          "event id min=", c.exec_driver_sql("select min(id) from events").scalar(),
          "vendor id min=", c.exec_driver_sql("select min(id) from vendors").scalar())
