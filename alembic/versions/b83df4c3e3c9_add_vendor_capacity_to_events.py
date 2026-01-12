"""Add vendor capacity fields to events

Revision ID: b83df4c3e3c9
Revises: aa535691f378
Create Date: 2025-12-18 12:00:00.000000

This migration implements the EVENT_VENDOR_CAPACITY_CONTRACT v1.0.

- Adds events.total_vendor_capacity (Integer, nullable)
- Adds events.category_vendor_capacity (JSONB, nullable)

No other schema changes.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "b83df4c3e3c9"
down_revision = "aa535691f378"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add total_vendor_capacity: integer, nullable
    op.add_column(
        "events",
        sa.Column("total_vendor_capacity", sa.Integer(), nullable=True),
    )

    # Add category_vendor_capacity: JSONB, nullable
    # Stored as a JSON array of objects:
    # [
    #   {"category": "Food", "target": 10},
    #   {"category": "Art", "target": 15}
    # ]
    op.add_column(
        "events",
        sa.Column(
            "category_vendor_capacity",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Remove capacity fields from events
    op.drop_column("events", "category_vendor_capacity")
    op.drop_column("events", "total_vendor_capacity")
