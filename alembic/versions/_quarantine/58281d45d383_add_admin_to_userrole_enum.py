"""Add 'admin' to userrole enum"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "7b4f1f5c2d90"
down_revision = "58281d45d383"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Safe no-op if 'admin' already exists
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'admin'")


def downgrade() -> None:
    # Removing values from a Postgres ENUM requires recreation of the type.
    # Skipping for safety.
    raise NotImplementedError("Downgrade not supported for enum value removal.")
