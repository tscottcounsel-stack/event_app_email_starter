# alembic/versions/b9ea35497f09_init_tables.py
"""init tables (events, vendors)

Revision ID: b9ea35497f09
Revises: <PUT_YOUR_PARENT_REVISION_HERE>
Create Date: 2025-09-XX

This migration intentionally does NOT create the 'applications' table.
That table is created in a later migration (e.g., 20250917_01_create_applications_table.py).
"""

from alembic import op
import sqlalchemy as sa


# ---- Alembic identifiers ----
revision = 'b9ea35497f09'
down_revision = None  # <- set to whatever your original file had (or None if it was the first)
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- events ----
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        # Keep organizer_id nullable unless you have a users table FK
        sa.Column("organizer_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("diagram_url", sa.String(length=2048), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # Optional indexes (uncomment if you want them)
    # op.create_index("ix_events_title", "events", ["title"])
    # op.create_index("ix_events_start_time", "events", ["start_time"])

    # NOTE: If you have a users table and want a real FK, you can add it later in a separate migration:
    # op.create_foreign_key(
    #     "events_organizer_id_fkey", "events", "users", ["organizer_id"], ["id"], ondelete="CASCADE"
    # )

    # ---- vendors ----
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # Optional index
    # op.create_index("ix_vendors_name", "vendors", ["name"])


def downgrade() -> None:
    # Drop in reverse order of creation
    op.drop_table("vendors")
    op.drop_table("events")



