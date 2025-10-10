"""Bootstrap baseline schema (fresh DB)"""

revision = "0678be8d8c2b"
down_revision = None
branch_labels = None
depends_on = None

from alembic import op
from sqlalchemy.engine import Connection

def _import_models() -> None:
    # Import all model modules so their tables register on Base.metadata
    import importlib
    for mod in (
        "app.models.event",
        "app.models.vendor",
        "app.models.application",
        "app.models.slot",
        # "app.models.user",  # uncomment only if this module actually exists
    ):
        try:
            importlib.import_module(mod)
        except Exception as e:
            print(f"[baseline] optional import failed: {mod}: {e}")

def upgrade() -> None:
    _import_models()
    from app.db import Base
    bind: Connection = op.get_bind()
    Base.metadata.create_all(bind)

def downgrade() -> None:
    _import_models()
    from app.db import Base
    bind: Connection = op.get_bind()
    Base.metadata.drop_all(bind)
