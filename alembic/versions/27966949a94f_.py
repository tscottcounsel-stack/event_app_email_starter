"""empty message

Revision ID: 27966949a94f
Revises: e985f47fc85b
Create Date: 2025-12-19 12:12:59.005751

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "27966949a94f"
down_revision: Union[str, Sequence[str], None] = "e985f47fc85b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: add organizer_contacts table."""
    op.create_table(
        "organizer_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organizer_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("company", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_index(
        "ix_organizer_contacts_organizer_id",
        "organizer_contacts",
        ["organizer_id"],
    )
    op.create_index(
        "ix_organizer_contacts_email",
        "organizer_contacts",
        ["email"],
    )


def downgrade() -> None:
    """Downgrade schema: drop organizer_contacts table."""
    op.drop_index(
        "ix_organizer_contacts_email",
        table_name="organizer_contacts",
    )
    op.drop_index(
        "ix_organizer_contacts_organizer_id",
        table_name="organizer_contacts",
    )
    op.drop_table("organizer_contacts")
