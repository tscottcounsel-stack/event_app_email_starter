# app/models/__init__.py
"""
Central registry for SQLAlchemy models.

Goal:
- Make `import app.models as models` work reliably (models.User, models.VendorProfile, etc.)
- Ensure all tables are registered in Base.metadata so FKs can resolve
  (ex: Slot.category_id -> vendor_categories.id)
"""

from __future__ import annotations

# Base is defined in app/db.py in your project (per your other files)
from app.db import Base  # noqa: F401


def _import_first(*module_names: str):
    """
    Try importing models from a list of possible module paths.
    This makes the registry resilient if filenames vary slightly (user.py vs users.py, etc).
    """
    last_exc: Exception | None = None
    for mod in module_names:
        try:
            module = __import__(mod, fromlist=["*"])
            return module
        except Exception as e:
            last_exc = e
    if last_exc:
        raise last_exc
    raise ImportError("No modules provided")


# ---- Import order matters (dependencies first) ----
# 1) User / VendorProfile / VendorCategory are referenced by others via relationships/FKs.
_user_mod = _import_first("app.models.user", "app.models.users")
VendorProfile_mod = _import_first(
    "app.models.vendor_profile", "app.models.vendor_profiles"
)
VendorCategory_mod = _import_first(
    "app.models.vendor_category", "app.models.vendor_categories"
)

# 2) Event and Slot (Slot may FK to vendor_categories; Event referenced by many)
event_mod = _import_first("app.models.event", "app.models.events")
slot_mod = _import_first(
    "app.models.slot",
    "app.models.slots",
    "app.models.event_slot",
    "app.models.event_slots",
)

# 3) Application and any remaining models that refer to the above
application_mod = _import_first("app.models.application", "app.models.applications")

# Optional: diagram/history models if present (safe if you don’t have them)
try:
    diagram_mod = _import_first(
        "app.models.event_diagram", "app.models.diagram", "app.models.event_diagrams"
    )
except Exception:
    diagram_mod = None

try:
    history_mod = _import_first(
        "app.models.event_diagram_history",
        "app.models.diagram_history",
        "app.models.event_diagrams_history",
    )
except Exception:
    history_mod = None


# ---- Re-export canonical class names (what routers expect) ----
# Update these attribute names if your class names differ.
User = getattr(_user_mod, "User")
VendorProfile = getattr(VendorProfile_mod, "VendorProfile")
VendorCategory = getattr(VendorCategory_mod, "VendorCategory")

Event = getattr(event_mod, "Event")
Slot = getattr(slot_mod, "Slot")

Application = getattr(application_mod, "Application")

# Optional exports
EventDiagram = getattr(diagram_mod, "EventDiagram", None) if diagram_mod else None
EventDiagramHistory = (
    getattr(history_mod, "EventDiagramHistory", None) if history_mod else None
)

__all__ = [
    "Base",
    "User",
    "VendorProfile",
    "VendorCategory",
    "Event",
    "Slot",
    "Application",
    "EventDiagram",
    "EventDiagramHistory",
]
