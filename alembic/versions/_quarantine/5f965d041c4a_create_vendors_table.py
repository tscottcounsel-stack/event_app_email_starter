from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '5f965d041c4a'
down_revision = 'b9ea35497f09'
branch_labels = None
depends_on = None

def upgrade():
    # no-op: vendors table created in b9ea35497f09_init_tables
    pass

def downgrade():
    # no-op to match upgrade()
    pass
