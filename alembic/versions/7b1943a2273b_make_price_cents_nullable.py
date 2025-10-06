"""make price_cents nullable

Revision ID: 7b1943a2273b
Revises: 724a5a9000e7
Create Date: 2025-09-28 12:35:54.945526
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# ---- Alembic identifiers ----
revision: str = "7b1943a2273b"
down_revision: Union[str, Sequence[str], None] = "724a5a9000e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Allow NULL price_cents so vendors can submit before approval."""
    with op.batch_alter_table("applications") as b:
        b.alter_column(
            "price_cents",
            existing_type=sa.Integer(),
            nullable=True,
        )


def downgrade() -> None:
    """Restore NOT NULL (fill any NULLs with 0 first to avoid failure)."""
    # If any rows have NULL, set to 0 to safely enforce NOT NULL again
    op.execute(
        "UPDATE public.applications SET price_cents = 0 WHERE price_cents IS NULL"
    )
    with op.batch_alter_table("applications") as b:
        b.alter_column(
            "price_cents",
            existing_type=sa.Integer(),
            nullable=False,
        )

