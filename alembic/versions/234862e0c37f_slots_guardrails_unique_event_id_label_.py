from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "234862e0c37f"
down_revision = "706341e69f48"
branch_labels = None
depends_on = None

def upgrade():
    # 1) Ensure UNIQUE(event_id,label) exists.
    #    If a matching unique index already exists (e.g. ux_event_slots_event_label),
    #    attach it to the table constraint; else create the constraint.
    op.execute("""
    DO $$
    DECLARE
        has_constraint bool;
        idx_name text;
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'event_slots'
              AND c.conname = 'event_slots_event_id_label_key'
        ) INTO has_constraint;

        IF NOT has_constraint THEN
            -- Look for any unique index on (event_id, label)
            SELECT i.relname
              INTO idx_name
            FROM pg_class t
            JOIN pg_index x ON x.indrelid = t.oid
            JOIN pg_class i ON i.oid = x.indexrelid
            WHERE t.relname = 'event_slots'
              AND x.indisunique
              AND pg_get_indexdef(i.oid) ILIKE '%(event_id, label)%'
            LIMIT 1;

            IF idx_name IS NOT NULL THEN
                EXECUTE format(
                    'ALTER TABLE public.event_slots
                     ADD CONSTRAINT event_slots_event_id_label_key
                     UNIQUE USING INDEX %I', idx_name
                );
            ELSE
                ALTER TABLE public.event_slots
                ADD CONSTRAINT event_slots_event_id_label_key
                UNIQUE (event_id, label);
            END IF;
        END IF;
    END$$;
    """)

    # 2) Helpful index for list queries (IF NOT EXISTS)
    op.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = 'ix_event_slots_event_id'
              AND n.nspname = 'public'
        ) THEN
            CREATE INDEX ix_event_slots_event_id ON public.event_slots (event_id);
        END IF;
    END$$;
    """)

    # 3) Applications.slot_id FK -> event_slots.id with ON DELETE SET NULL (idempotent)
    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_name = 'applications_slot_id_fkey'
              AND table_name = 'applications'
              AND constraint_type = 'FOREIGN KEY'
        ) THEN
            ALTER TABLE public.applications DROP CONSTRAINT applications_slot_id_fkey;
        END IF;

        ALTER TABLE public.applications
        ADD CONSTRAINT applications_slot_id_fkey
        FOREIGN KEY (slot_id) REFERENCES public.event_slots(id)
        ON DELETE SET NULL;
    END$$;
    """)

def downgrade():
    # Downgrade best-effort (safe to re-run)
    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_name = 'applications_slot_id_fkey'
              AND table_name = 'applications'
              AND constraint_type = 'FOREIGN KEY'
        ) THEN
            ALTER TABLE public.applications DROP CONSTRAINT applications_slot_id_fkey;
        END IF;
    END$$;
    """)

    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'event_slots'
              AND c.conname = 'event_slots_event_id_label_key'
        ) THEN
            ALTER TABLE public.event_slots
            DROP CONSTRAINT event_slots_event_id_label_key;
        END IF;
    END$$;
    """)

    op.execute("""
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = 'ix_event_slots_event_id'
              AND n.nspname = 'public'
        ) THEN
            DROP INDEX public.ix_event_slots_event_id;
        END IF;
    END$$;
    """)
