import sqlalchemy as sa

from alembic import op

revision = "2bc4ea9ce529"  # KEEP your value
down_revision = "a1b2c3d4e5f6"  # KEEP your value
branch_labels = None
depends_on = None


def upgrade():
    # (Optional) ensure enum exists if this migration also adds it
    op.execute(
        """
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='userrole') THEN
        CREATE TYPE userrole AS ENUM ('organizer','vendor');
      END IF;
    END $$;
    """
    )

    # Rewire FKs idempotently and correctly
    op.execute(
        """
    DO $$
    DECLARE
      con_rec record;
    BEGIN
      -- drop all existing FKs on applications
      FOR con_rec IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.applications'::regclass
          AND contype  = 'f'
      LOOP
        EXECUTE format('ALTER TABLE public.applications DROP CONSTRAINT %I', con_rec.conname);
      END LOOP;

      -- add the correct FKs with CASCADE
      ALTER TABLE public.applications
        ADD CONSTRAINT applications_event_id_fkey
          FOREIGN KEY (event_id)  REFERENCES public.events(id)  ON DELETE CASCADE,
        ADD CONSTRAINT applications_vendor_id_fkey
          FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;
    END $$;
    """
    )


def downgrade():
    op.execute(
        """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='public.applications'::regclass
          AND conname='applications_event_id_fkey'
      ) THEN
        ALTER TABLE public.applications DROP CONSTRAINT applications_event_id_fkey;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='public.applications'::regclass
          AND conname='applications_vendor_id_fkey'
      ) THEN
        ALTER TABLE public.applications DROP CONSTRAINT applications_vendor_id_fkey;
      END IF;

      -- re-add non-cascade FKs to leave DB usable on downgrade
      ALTER TABLE public.applications
        ADD CONSTRAINT applications_event_id_fkey
          FOREIGN KEY (event_id) REFERENCES public.events(id),
        ADD CONSTRAINT applications_vendor_id_fkey
          FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);
    END $$;
    """
    )
