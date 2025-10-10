import os, sys, traceback
import sqlalchemy as sa

u = os.environ.get("DATABASE_URL")
print("DATABASE_URL =", u)
if not u:
    print("WARNING: env var is empty; will rely on alembic.ini for URL")

try:
    # Fall back to alembic.ini URL if env var missing (so this probe still works)
    if not u:
        # You can optionally parse alembic.ini here; for now just error clearly:
        raise RuntimeError("Set DATABASE_URL in this shell to test connectivity.")

    e = sa.create_engine(u, pool_pre_ping=True)
    with e.connect() as c:
        ver = c.exec_driver_sql("select version()").scalar()
        print("Connected OK:", ver)
except Exception as ex:
    print("ERROR connecting:", ex)
    traceback.print_exc()
    sys.exit(2)
