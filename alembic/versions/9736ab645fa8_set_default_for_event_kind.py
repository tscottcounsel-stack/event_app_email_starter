"""set default for event kind

Revision ID: 9736ab645fa8
Revises: fb569e4c4b8a
Create Date: 2025-12-22 11:47:40.070773

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9736ab645fa8"
down_revision: Union[str, Sequence[str], None] = "fb569e4c4b8a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    - Backfill any existing NULL kinds to 'general'
    - Set DEFAULT 'general' on events.kind
    - Keep NOT NULL constraint intact
    """
    # Safety: backfill existing NULL values so NOT NULL remains valid
    op.execute("UPDATE events SET kind = 'general' WHERE kind IS NULL")

    # Add a server-side default so future inserts without kind use 'general'
    op.execute("ALTER TABLE events ALTER COLUMN kind SET DEFAULT 'general'")


def downgrade() -> None:
    """Downgrade schema.

    - Remove DEFAULT from events.kind
    - Leave existing data as-is
    """
    op.execute("ALTER TABLE events ALTER COLUMN kind DROP DEFAULT")
