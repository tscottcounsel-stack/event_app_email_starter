import os
import random
import sys
from pathlib import Path

import sqlalchemy as sa
from dotenv import load_dotenv
from sqlalchemy.exc import SQLAlchemyError

ROOT = Path(__file__).resolve().parent
load_dotenv(dotenv_path=ROOT / ".env")

url = os.environ.get("DATABASE_URL")
if not url:
    print("ERROR: No DATABASE_URL in .env", file=sys.stderr)
    sys.exit(2)

try:
    eng = sa.create_engine(url, pool_pre_ping=True, future=True)
    with eng.begin() as conn:
        # Ensure users table exists (minimal shape)
        conn.exec_driver_sql(
            """
        CREATE TABLE IF NOT EXISTS public.users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL
        )
        """
        )

        row = conn.exec_driver_sql(
            "SELECT id FROM public.users WHERE role IN ('organizer','admin') ORDER BY id LIMIT 1"
        ).first()
        if row:
            print(row[0])
            sys.exit(0)

        email = f"org_{random.randint(1000,9999)}@example.com"
        new_id = conn.exec_driver_sql(
            "INSERT INTO public.users (email, password, role) VALUES (%(email)s, %(pw)s, 'organizer') RETURNING id",
            {"email": email, "pw": "pass"},
        ).scalar()
        print(new_id)
        sys.exit(0)

except SQLAlchemyError as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
