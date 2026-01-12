"""
Add public_email to vendor_profiles and organizer_profiles

Revision ID: 5f3f5bbebf43
Revises: b83df4c3e3c9
Create Date: 2025-12-18 16:08:04.864603
"""

import sqlalchemy as sa

from alembic import op

revision = "5f3f5bbebf43"
down_revision = "b83df4c3e3c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add public_email TEXT to vendor_profiles and organizer_profiles
    in a defensive way — only if the tables/columns exist and aren't already there.
    """

    op.execute(
        """
        DO $$
        BEGIN
            -- vendor_profiles.public_email
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name='vendor_profiles'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='vendor_profiles'
                AND column_name='public_email'
            )
            THEN
                ALTER TABLE vendor_profiles
                    ADD COLUMN public_email TEXT;
            END IF;

            -- organizer_profiles.public_email
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name='organizer_profiles'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='organizer_profiles'
                AND column_name='public_email'
            )
            THEN
                ALTER TABLE organizer_profiles
                    ADD COLUMN public_email TEXT;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    """
    Drop public_email from vendor_profiles and organizer_profiles if it exists.
    """

    op.execute(
        """
        DO $$
        BEGIN
            -- vendor_profiles.public_email
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='vendor_profiles'
                AND column_name='public_email'
            )
            THEN
                ALTER TABLE vendor_profiles
                    DROP COLUMN public_email;
            END IF;

            -- organizer_profiles.public_email
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='organizer_profiles'
                AND column_name='public_email'
            )
            THEN
                ALTER TABLE organizer_profiles
                    DROP COLUMN public_email;
            END IF;
        END
        $$;
        """
    )
