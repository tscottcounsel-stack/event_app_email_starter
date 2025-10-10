from pathlib import Path
from dotenv import load_dotenv
import os, random, sys
import sqlalchemy as sa
from sqlalchemy.exc import SQLAlchemyError, DBAPIError

ROOT = Path(__file__).resolve().parent
load_dotenv(dotenv_path=ROOT / ".env")

url = os.environ.get("DATABASE_URL")
if not url:
    print("ERROR: No DATABASE_URL in .env", file=sys.stderr)
    sys.exit(2)

def mask(u: str) -> str:
    try:
        # postgresql+psycopg2://user:pass@host:port/db
        prefix, rest = u.split("://", 1)
        creds, tail = rest.split("@", 1)
        if ":" in creds:
            user, _ = creds.split(":", 1)
            creds_masked = f"{user}:***"
        else:
            creds_masked = creds
        return f"{prefix}://{creds_masked}@{tail}"
    except Exception:
        return "<hidden>"

print("DATABASE_URL:", mask(url), file=sys.stderr)

eng = sa.create_engine(url, future=True, pool_pre_ping=True)

try:
    with eng.connect() as c:
        dbname = c.exec_driver_sql("select current_database()").scalar()
        print("current_database:", dbname, file=sys.stderr)
        tables = c.execute(sa.text("""
            select table_name
            from information_schema.tables
            where table_schema = 'public'
            order by table_name
        """)).scalars().all()
        print("public tables:", tables, file=sys.stderr)
except Exception as e:
    print("ERROR checking DB:", e, file=sys.stderr)

try:
    with eng.begin() as conn:
        # Ensure users table exists (minimal shape)
        conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS public.users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL
        )
        """))

        row = conn.execute(sa.text(
            "SELECT id FROM public.users WHERE role IN ('organizer','admin') ORDER BY id LIMIT 1"
        )).first()
        if row:
            print(row[0])
            sys.exit(0)

        email = f"org_{random.randint(1000,9999)}@example.com"
        new_id = conn.execute(
            sa.text("INSERT INTO public.users (email, password, role) VALUES (:email, :pw, 'organizer') RETURNING id"),
            {"email": email, "pw": "pass"}
        ).scalar_one()
        print(new_id)
        sys.exit(0)

except (SQLAlchemyError, DBAPIError) as e:
    print("DB ERROR:", e.__class__.__name__, file=sys.stderr)
    print(str(e), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print("ERROR:", e, file=sys.stderr)
    sys.exit(1)
