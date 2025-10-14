import sqlalchemy as sa

from alembic import op

revision = "a1b2c3d4e5f6"  # KEEP your value
down_revision = "5f965d041c4a"  # KEEP your value
branch_labels = None
depends_on = None


def upgrade():
    # Create table without FKs first (safe to re-run)
    op.execute(
        """
    CREATE TABLE IF NOT EXISTS public.applications (
        id           SERIAL PRIMARY KEY,
        event_id     INTEGER NOT NULL,
        vendor_id    INTEGER NOT NULL,
        note         VARCHAR(255),
        price_cents  INTEGER,  -- nullable until organizer approves
        status       VARCHAR(50) NOT NULL DEFAULT 'submitted',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes        TEXT
    );
    """
    )

    # Unique (event_id, vendor_id) — idempotent via index
    op.execute(
        """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public'
          AND tablename='applications'
          AND indexname='ux_applications_event_vendor'
      ) THEN
        CREATE UNIQUE INDEX ux_applications_event_vendor
          ON public.applications(event_id, vendor_id);
      END IF;
    END $$;
    """
    )

    # Add FKs only if referenced tables exist; make sure vendor FK points to vendors(id)
    op.execute(
        """
    DO $$
    BEGIN
      IF to_regclass('public.events')  IS NOT NULL
         AND to_regclass('public.vendors') IS NOT NULL THEN

        -- drop any existing FKs (names may vary)
        PERFORM 1
        FROM pg_constraint
        WHERE conrelid = 'public.applications'::regclass
          AND contype  = 'f';
        IF FOUND THEN
          EXECUTE $sql$
            ALTER TABLE public.applications
              DROP CONSTRAINT IF EXISTS applications_event_id_fkey,
              DROP CONSTRAINT IF EXISTS applications_vendor_id_fkey
          $sql$;
        END IF;

        -- add correct FKs with CASCADE
        ALTER TABLE public.applications
          ADD CONSTRAINT applications_event_id_fkey
            FOREIGN KEY (event_id)  REFERENCES public.events(id)  ON DELETE CASCADE,
          ADD CONSTRAINT applications_vendor_id_fkey
            FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;
      END IF;
    END $$;
    """
    )


def downgrade():
    op.execute(
        """
    DO $$
    BEGIN
      IF to_regclass('public.applications') IS NOT NULL THEN
        DROP TABLE public.applications;
      END IF;
    END $$;
    """
    )
