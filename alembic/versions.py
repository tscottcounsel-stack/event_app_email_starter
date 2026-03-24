import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "flow_fields_001"
down_revision = "<PUT_PREVIOUS_REVISION_HERE>"  # keep whatever Alembic generated
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("applications") as b:
        b.add_column(
            sa.Column("desired_location", sa.String(length=200), nullable=True)
        )
        b.add_column(sa.Column("payment_ref", sa.String(length=100), nullable=True))
        b.add_column(sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("applications") as b:
        b.drop_column("paid_at")
        b.drop_column("payment_ref")
        b.drop_column("desired_location")
