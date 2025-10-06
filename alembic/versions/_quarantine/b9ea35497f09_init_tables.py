"""noop: placeholder to keep linear history

Revision ID: b9ea35497f09
Revises: f2e49c4d9b94
Create Date: 2025-09-XX
"""
from alembic import op

revision = "b9ea35497f09"
down_revision = "f2e49c4d9b94"   # ← make it linear
branch_labels = None
depends_on = None

def upgrade() -> None:
    pass

def downgrade() -> None:
    pass
