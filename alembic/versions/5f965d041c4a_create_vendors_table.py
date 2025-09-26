from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '5f965d041c4a'
down_revision = 'b9ea35497f09'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'vendors',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('phone', sa.String(length=50), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )

def downgrade():
    op.drop_table('vendors')





