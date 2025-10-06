"""applications.slot_id + FKs + indexes

Revision ID: 706341e69f48
Revises: 70a9d79af4da
Create Date: 2025-10-03 18:30:56.757594
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "706341e69f48"
down_revision: Union[str, Sequence[str], None] = "70a9d79af4da"  # <- chain to event_slots
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Add slot_id if missing (idempotent)
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications' AND column_name='slot_id'
      ) THEN
        ALTER TABLE public.applications ADD COLUMN slot_id INTEGER NULL;
      END IF;
    END $$;
    """)

    # 2) FK to event_slots(id), idempotent
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname='public' AND t.relname='applications' AND c.conname='applications_slot_id_fkey'
      ) THEN
        ALTER TABLE public.applications
          ADD CONSTRAINT applications_slot_id_fkey
          FOREIGN KEY (slot_id) REFERENCES public.event_slots(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
    """)

    # 3) Helpful index on slot_id
    op.execute("""
    CREATE INDEX IF NOT EXISTS ix_applications_slot_id
      ON public.applications(slot_id);
    """)

    # 4) Enforce: only one approved application per non-null slot_id
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='applications' AND indexname='ux_apps_slot_approved'
      ) THEN
        CREATE UNIQUE INDEX ux_apps_slot_approved
          ON public.applications(slot_id)
          WHERE slot_id IS NOT NULL AND status = 'approved';
      END IF;
    END $$;
    """)

    # 5) Clean up duplicate unique index on (event_id, vendor_id) if you had two
    # Keep only ONE of these; drop the dupe if present.
    op.execute("DROP INDEX IF EXISTS public.ux_applications_event_vendor;")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ux_apps_slot_approved;")
    op.execute("DROP INDEX IF EXISTS public.ix_applications_slot_id;")
    op.execute("""
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname='public' AND t.relname='applications' AND c.conname='applications_slot_id_fkey'
      ) THEN
        ALTER TABLE public.applications DROP CONSTRAINT applications_slot_id_fkey;
      END IF;
    END $$;
    """)
    # keep slot_id column (avoid data loss); drop if you really need to:
    # op.execute("ALTER TABLE public.applications DROP COLUMN IF EXISTS slot_id;")
