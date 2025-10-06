"""add vendors.user_id fk and unique index

Revision ID: f2e49c4d9b94
Revises: 7b1943a2273b
Create Date: 2025-10-02 09:52:36.822089
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f2e49c4d9b94"
down_revision: Union[str, Sequence[str], None] = "58281d45d383"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None



def upgrade() -> None:
    # 1) Add column if missing
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='vendors' AND column_name='user_id'
            ) THEN
                ALTER TABLE public.vendors ADD COLUMN user_id INTEGER;
            END IF;
        END $$;
    """)

    # 2) Add FK (idempotent)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname='public' AND t.relname='vendors' AND c.conname='vendors_user_id_fkey'
            ) THEN
                ALTER TABLE public.vendors
                ADD CONSTRAINT vendors_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
            END IF;
        END $$;
    """)

    # 3) Unique index on non-null user_id (one vendor per user)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_user_id
        ON public.vendors(user_id)
        WHERE user_id IS NOT NULL;
    """)

def downgrade() -> None:
    # Drop index and FK; keep column (to avoid data loss)
    op.execute("DROP INDEX IF EXISTS public.ux_vendors_user_id")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname='public' AND t.relname='vendors' AND c.conname='vendors_user_id_fkey'
            ) THEN
                ALTER TABLE public.vendors DROP CONSTRAINT vendors_user_id_fkey;
            END IF;
        END $$;
    """)