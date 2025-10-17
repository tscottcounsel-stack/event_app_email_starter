# scripts/seed.py
import os

import sqlalchemy as sa

url = os.environ.get("DATABASE_URL")
engine = sa.create_engine(url, pool_pre_ping=True, future=True)
with engine.begin() as conn:
    # Example: insert or ignore — adjust to your schema
    conn.exec_driver_sql(
        """
    INSERT INTO users (email, password_hash, role)
    SELECT 'organizer@example.com','x','organizer'
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE email='organizer@example.com');
    """
    )
print("Seed complete.")
