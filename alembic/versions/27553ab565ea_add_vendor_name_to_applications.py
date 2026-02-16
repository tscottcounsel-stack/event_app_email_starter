"""add vendor_name to applications

Revision ID: 27553ab565ea
Revises: 234862e0c37f
Create Date: 2026-02-05 20:41:30.482104

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "27553ab565ea"
down_revision: Union[str, Sequence[str], None] = "234862e0c37f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add vendor_name column if it doesn't exist
    op.add_column("applications", sa.Column("vendor_name", sa.String(), nullable=True))


def downgrade() -> None:
    # Remove vendor_name column
    op.drop_column("applications", "vendor_name")
