from sqlalchemy import text

from app.db import engine

with engine.begin() as tx:
    tx.execute(
        text(
            """
        INSERT INTO public.users (email, password, role, created_at)
        VALUES (:e, :pw, 'vendor'::userrole, NOW())
        ON CONFLICT (email) DO UPDATE
        SET password = EXCLUDED.password,
            role     = EXCLUDED.role
    """
        ),
        {"e": "vendor1@example.com", "pw": "secret123"},
    )
    row = (
        tx.execute(
            text(
                """
        SELECT id, email, role::text AS role, password
        FROM public.users WHERE email=:e
        LIMIT 1
    """
            ),
            {"e": "vendor1@example.com"},
        )
        .mappings()
        .first()
    )
    print(
        "UPSERTED:",
        {
            "id": row["id"],
            "role": row["role"],
            "hashed": row["password"].startswith("$"),
            "pw_preview": row["password"][:12],
        },
    )
