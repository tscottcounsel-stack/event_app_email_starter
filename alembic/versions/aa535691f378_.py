"""Add story + checklist + categories to vendor and organizer profiles
(defensive: only alters tables that actually exist)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aa535691f378"
down_revision: Union[str, Sequence[str], None] = "234862e0c37f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema by adding story + checklist + categories fields
    where the corresponding tables exist.
    """
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    # --- vendor_profiles additions ---
    if "vendor_profiles" in tables:
        op.add_column(
            "vendor_profiles",
            sa.Column("vendor_story", sa.Text(), nullable=True),
        )
        op.add_column(
            "vendor_profiles",
            sa.Column(
                "checklist_tags",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
        op.add_column(
            "vendor_profiles",
            sa.Column(
                "vendor_categories",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )

    # --- organizer_profiles additions (only if table exists) ---
    if "organizer_profiles" in tables:
        op.add_column(
            "organizer_profiles",
            sa.Column("organizer_story", sa.Text(), nullable=True),
        )
        op.add_column(
            "organizer_profiles",
            sa.Column(
                "checklist_tags",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )


def downgrade() -> None:
    """Downgrade schema by removing added fields, if present."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "organizer_profiles" in tables:
        with op.batch_alter_table("organizer_profiles") as batch_op:
            # Use batch_op to be safer across backends
            batch_op.drop_column("checklist_tags")
            batch_op.drop_column("organizer_story")

    if "vendor_profiles" in tables:
        with op.batch_alter_table("vendor_profiles") as batch_op:
            batch_op.drop_column("vendor_categories")
            batch_op.drop_column("checklist_tags")
            batch_op.drop_column("vendor_story")
