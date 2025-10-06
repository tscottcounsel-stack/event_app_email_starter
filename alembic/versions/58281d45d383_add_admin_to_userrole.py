"""Add 'admin' to userrole enum (idempotent)

Revision ID: 58281d45d383
Revises: 7b1943a2273b
Create Date: 2025-09-28
"""
from alembic import op

revision = "58281d45d383"
down_revision = "7b1943a2273b"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'admin'")

def downgrade() -> None:
    pass
