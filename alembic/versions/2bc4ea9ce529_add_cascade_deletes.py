"""Add cascade deletes and userrole enum

Revision ID: 2bc4ea9ce529
Revises: b9ea35497f09
Create Date: 2025-09-03 12:34:56.000000
"""

from alembic import op
import sqlalchemy as sa


# Revision identifiers, used by Alembic.
revision = '2bc4ea9ce529'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    # ✅ Ensure userrole enum exists before altering
    userrole = sa.Enum("vendor", "organizer", name="userrole")
    userrole.create(op.get_bind(), checkfirst=True)

    # ✅ Explicit cast from VARCHAR → ENUM
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE userrole USING role::userrole;")

    # Cascade deletes
    op.drop_constraint("events_organizer_id_fkey", "events", type_="foreignkey")
    op.create_foreign_key(
        "events_organizer_id_fkey",
        "events",
        "users",
        ["organizer_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("applications_event_id_fkey", "applications", type_="foreignkey")
    op.create_foreign_key(
        "applications_event_id_fkey",
        "applications",
        "events",
        ["event_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("applications_vendor_id_fkey", "applications", type_="foreignkey")
    op.create_foreign_key(
        "applications_vendor_id_fkey",
        "applications",
        "users",
        ["vendor_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade():
    # Revert foreign key changes
    op.drop_constraint("applications_vendor_id_fkey", "applications", type_="foreignkey")
    op.create_foreign_key(
        "applications_vendor_id_fkey",
        "applications",
        "users",
        ["vendor_id"],
        ["id"],
    )

    op.drop_constraint("applications_event_id_fkey", "applications", type_="foreignkey")
    op.create_foreign_key(
        "applications_event_id_fkey",
        "applications",
        "events",
        ["event_id"],
        ["id"],
    )

    op.drop_constraint("events_organizer_id_fkey", "events", type_="foreignkey")
    op.create_foreign_key(
        "events_organizer_id_fkey",
        "events",
        "users",
        ["organizer_id"],
        ["id"],
    )

    # ✅ Revert users.role to VARCHAR
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE VARCHAR;")

    # Drop enum type
    sa.Enum("vendor", "organizer", name="userrole").drop(op.get_bind(), checkfirst=True)


