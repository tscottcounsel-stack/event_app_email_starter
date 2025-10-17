from sqlalchemy import text

from app.db import engine

with engine.connect() as c:
    row = (
        c.execute(
            text(
                """
        SELECT id, email, role::text AS role, password
        FROM public.users
        WHERE email=:e
        LIMIT 1
    """
            ),
            {"e": "vendor1@example.com"},
        )
        .mappings()
        .first()
    )

if not row:
    print("NO USER")
else:
    pw = row["password"] or ""
    print(
        {
            "id": row["id"],
            "email": row["email"],
            "role": row["role"],
            "hashed": pw.startswith("$"),
            "pw_preview": pw[:12],
        }
    )
