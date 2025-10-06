"""create event_slots table

Revision ID: 70a9d79af4da
Revises: f2e49c4d9b94
Create Date: 2025-10-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "70a9d79af4da"
down_revision: Union[str, Sequence[str], None] = "f2e49c4d9b94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'event_slots'
      ) THEN
        CREATE TABLE public.event_slots (
          id          SERIAL PRIMARY KEY,
          event_id    INT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
          label       VARCHAR(50) NOT NULL,
          coord_x     INT NULL,
          coord_y     INT NULL,
          width       INT NULL,
          height      INT NULL,
          price_cents INT NOT NULL DEFAULT 0,
          status      VARCHAR(20) NOT NULL DEFAULT 'available',
          notes       TEXT NULL
        );
      END IF;
    END $$;
    """)

    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='event_slots' AND indexname='ux_event_slots_event_label'
      ) THEN
        CREATE UNIQUE INDEX ux_event_slots_event_label
          ON public.event_slots(event_id, label);
      END IF;
    END $$;
    """)

    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='event_slots' AND indexname='ix_event_slots_event_id'
      ) THEN
        CREATE INDEX ix_event_slots_event_id
          ON public.event_slots(event_id);
      END IF;
    END $$;
    """)

def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_event_slots_event_id;")
    op.execute("DROP INDEX IF EXISTS public.ux_event_slots_event_label;")
    op.execute("DROP TABLE IF EXISTS public.event_slots;")
