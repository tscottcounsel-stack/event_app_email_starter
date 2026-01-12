"""Add status, kind, category_id to event_slots

Revision ID: fb569e4c4b8a
Revises: 937c1004f6cc
Create Date: 2025-12-20 20:18:05.553414
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fb569e4c4b8a"
down_revision: Union[str, Sequence[str], None] = "937c1004f6cc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    This makes event_slots capable of storing:
      - status      (available / pending / approved / assigned / blocked / etc.)
      - kind        (standard / premium / corner / etc.)
      - category_id (FK to vendor_categories.id, nullable)
    """

    # Status: simple string enum, default "available"
    op.add_column(
        "event_slots",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="available",
        ),
    )

    # Kind: simple string enum, default "standard"
    op.add_column(
        "event_slots",
        sa.Column(
            "kind",
            sa.String(length=32),
            nullable=False,
            server_default="standard",
        ),
    )

    # Optional category link → vendor_categories.id
    op.add_column(
        "event_slots",
        sa.Column("category_id", sa.Integer(), nullable=True),
    )

    # Best-effort FK; adjust table name if your categories table is different.
    op.create_foreign_key(
        "event_slots_category_id_fkey",
        "event_slots",
        "vendor_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema (undo upgrade)."""

    # Drop FK first, then columns.
    op.drop_constraint(
        "event_slots_category_id_fkey",
        "event_slots",
        type_="foreignkey",
    )

    op.drop_column("event_slots", "category_id")
    op.drop_column("event_slots", "kind")
    op.drop_column("event_slots", "status")
