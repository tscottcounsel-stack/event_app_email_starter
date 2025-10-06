"""merge heads: register_slots + guardrails

Revision ID: 7b66a9443a32
Revises: 9bf4b560fe2e, 234862e0c37f
Create Date: 2025-10-06 16:52:31.042581

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b66a9443a32'
down_revision: Union[str, Sequence[str], None] = ('9bf4b560fe2e', '234862e0c37f')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
