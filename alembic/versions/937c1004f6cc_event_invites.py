"""event_invites

Revision ID: 937c1004f6cc
Revises: 27966949a94f
Create Date: 2025-12-19 14:35:30.689730
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "937c1004f6cc"
down_revision: Union[str, Sequence[str], None] = "27966949a94f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create event_invites table."""
    op.create_table(
        "event_invites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Integer(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organizer_contact_id",
            sa.Integer(),
            sa.ForeignKey("organizer_contacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # basic lifecycle/status tracking – we’ll keep it simple for now
        sa.Column(
            "status",
            sa.String(length=50),
            nullable=False,
            server_default="invited",
        ),
        # copy of organizer_contact tags at the time of invite
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
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
        "ix_event_invites_event_id",
        "event_invites",
        ["event_id"],
    )
    op.create_index(
        "ix_event_invites_contact_id",
        "event_invites",
        ["organizer_contact_id"],
    )


def downgrade() -> None:
    """Drop event_invites table."""
    op.drop_index("ix_event_invites_contact_id", table_name="event_invites")
    op.drop_index("ix_event_invites_event_id", table_name="event_invites")
    op.drop_table("event_invites")
