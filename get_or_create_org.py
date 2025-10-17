import os
import random
from pathlib import Path

import sqlalchemy as sa
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(dotenv_path=ROOT / ".env")
url = os.environ.get("DATABASE_URL")
e = sa.create_engine(url, pool_pre_ping=True, future=True)

with e.begin() as c:
    # grab any organizer/admin
    row = c.exec_driver_sql(
        "select id from public.users where role in ('organizer','admin') order by id limit 1"
    ).first()
    if row:
        print(row[0])
        raise SystemExit

    # create a simple organizer
    email = f"org_{random.randint(1000,9999)}@example.com"
    r = c.exec_driver_sql(
        "insert into public.users (email, password, role) values (%(email)s, %(password)s, 'organizer') returning id",
        {"email": email, "password": "pass"},
    )
    print(r.scalar())
