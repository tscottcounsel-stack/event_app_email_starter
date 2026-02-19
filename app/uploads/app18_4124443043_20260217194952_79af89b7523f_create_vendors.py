"""create_vendors

Revision ID: 79af89b7523f
Revises: 234862e0c37f
Create Date: ...
"""

import sqlalchemy as sa

from alembic import op

revision = "79af89b7523f"
down_revision = "234862e0c37f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if the "vendors" table already exists.
    # If it does, skip creating it (baseline migration already handled it).
    conn = op.get_bind()
    exists = conn.scalar(
        sa.text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'vendors'
            )
            """
        )
    )

    if not exists:
        op.create_table(
            "vendors",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("display_name", sa.String(length=160), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False),
            sa.Column("city", sa.String(length=120), nullable=True),
            sa.Column("bio", sa.Text(), nullable=True),
            sa.Column("starting_price_cents", sa.Integer(), nullable=True),
            sa.Column("instagram_url", sa.String(length=300), nullable=True),
            sa.Column("website_url", sa.String(length=300), nullable=True),
        )
    # else: table already exists (created by baseline); do nothing.


def downgrade() -> None:
    # Drop table only if it exists, for symmetry.
    conn = op.get_bind()
    exists = conn.scalar(
        sa.text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'vendors'
            )
            """
        )
    )
    if exists:
        op.drop_table("vendors")
