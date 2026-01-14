"""bulk_messages_queue

Revision ID: 76988d99401e
Revises: 9736ab645fa8
Create Date: 2026-01-13 18:27:00.175363

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "76988d99401e"
down_revision: Union[str, Sequence[str], None] = "9736ab645fa8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) bulk_messages (campaign header)
    op.create_table(
        "bulk_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organizer_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.Text(), nullable=False),  # "email" | "sms"
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        # Snapshot of selected contacts at time of queue
        sa.Column(
            "contact_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        # Flexible metadata for future (filters, segment notes, etc.)
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # queued now; later: sending/sent/failed/canceled
        sa.Column(
            "status", sa.Text(), nullable=False, server_default=sa.text("'queued'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_bulk_messages_organizer_id", "bulk_messages", ["organizer_id"])
    op.create_index("ix_bulk_messages_status", "bulk_messages", ["status"])

    # 2) bulk_message_recipients (per-contact snapshot + rendered text)
    op.create_table(
        "bulk_message_recipients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "bulk_message_id",
            sa.Integer(),
            sa.ForeignKey("bulk_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        # Snapshot fields (so future edits to contacts don't alter history)
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("company", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),  # queued | skipped
        sa.Column("reason_skipped", sa.Text(), nullable=True),
        sa.Column("rendered_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_bmr_bulk_message_id",
        "bulk_message_recipients",
        ["bulk_message_id"],
    )
    op.create_index(
        "ix_bmr_contact_id",
        "bulk_message_recipients",
        ["contact_id"],
    )
    op.create_index(
        "ix_bmr_status",
        "bulk_message_recipients",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_bmr_status", table_name="bulk_message_recipients")
    op.drop_index("ix_bmr_contact_id", table_name="bulk_message_recipients")
    op.drop_index("ix_bmr_bulk_message_id", table_name="bulk_message_recipients")
    op.drop_table("bulk_message_recipients")

    op.drop_index("ix_bulk_messages_status", table_name="bulk_messages")
    op.drop_index("ix_bulk_messages_organizer_id", table_name="bulk_messages")
    op.drop_table("bulk_messages")
