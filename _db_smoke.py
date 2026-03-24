import os

from sqlalchemy import create_engine, text

url = os.environ.get("DATABASE_URL")
print("URL:", url)
if not url:
    raise SystemExit("DATABASE_URL not set")

engine = create_engine(url, pool_pre_ping=True, future=True)
with engine.connect() as c:
    print("DB says:", c.execute(text("SELECT 1")).scalar())
