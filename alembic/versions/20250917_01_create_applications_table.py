"""create applications table

Revision ID: a1b2c3d4e5f6
Revises: <put_previous_revision_id_here>
Create Date: 2025-09-17

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '5f965d041c4a'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'applications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
        sa.Column('vendor_id', sa.Integer(), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('note', sa.String(length=2000), nullable=True),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='submitted'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_check_constraint('ck_applications_price_nonneg', 'applications', 'price_cents >= 0')
    op.create_unique_constraint('uq_applications_event_vendor', 'applications', ['event_id', 'vendor_id'])

def downgrade():
    op.drop_constraint('uq_applications_event_vendor', 'applications', type_='unique')
    op.drop_constraint('ck_applications_price_nonneg', 'applications', type_='check')
    op.drop_table('applications')








