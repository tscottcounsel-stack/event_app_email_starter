"""application flow fields

Revision ID: 724a5a9000e7
Revises: None
Create Date: 2025-09-27 09:39:54.926226
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "724a5a9000e7"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make adding columns safe if they already exist
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='desired_location'
      ) THEN
        ALTER TABLE public.applications ADD COLUMN desired_location VARCHAR(200);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='payment_ref'
      ) THEN
        ALTER TABLE public.applications ADD COLUMN payment_ref VARCHAR(100);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='paid_at'
      ) THEN
        ALTER TABLE public.applications ADD COLUMN paid_at TIMESTAMPTZ NULL;
      END IF;
    END $$;
    """)


def downgrade() -> None:
    # Drop columns if present
    op.execute("""
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='paid_at'
      ) THEN
        ALTER TABLE public.applications DROP COLUMN paid_at;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='payment_ref'
      ) THEN
        ALTER TABLE public.applications DROP COLUMN payment_ref;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='desired_location'
      ) THEN
        ALTER TABLE public.applications DROP COLUMN desired_location;
      END IF;
    END $$;
    """)
