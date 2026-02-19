"""Add 'admin' to userrole enum (idempotent)

Revision ID: 58281d45d383
Revises: 7b1943a2273b
Create Date: 2025-09-28
"""

revision = "58281d45d383"
down_revision = "0678be8d8c2b"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    # 1) Ensure the enum type exists
    op.execute(
        """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'userrole') THEN
            CREATE TYPE userrole AS ENUM ('vendor', 'organizer');
        END IF;
    END
    $$ LANGUAGE plpgsql;
    """
    )

    # 2) Add 'admin' only if not present
    op.execute(
        """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'userrole'
              AND e.enumlabel = 'admin'
        ) THEN
            ALTER TYPE userrole ADD VALUE 'admin';
        END IF;
    END
    $$ LANGUAGE plpgsql;
    """
    )


def downgrade():
    # No safe way to remove an enum value in Postgres without heavy surgery.
    pass
