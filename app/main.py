from __future__ import annotations

import importlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

# Use Railway persistent volume for uploads
UPLOADS_DIR = Path("/data/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

logger.info("UPLOADS DIR: %s", UPLOADS_DIR)


def _safe_call(func, label: str) -> None:
    try:
        func()
        logger.info("%s initialized", label)
    except Exception as exc:
        logger.warning("%s init skipped: %s", label, exc)


def _try_include(app: FastAPI, module_name: str, attr_name: str = "router") -> None:
    try:
        module = importlib.import_module(module_name)
        router = getattr(module, attr_name, None)
        if router is None:
            logger.warning("Module %s has no %s", module_name, attr_name)
            return
        app.include_router(router)
        logger.info("Included router from %s", module_name)
    except Exception as exc:
        raise RuntimeError(f"FAILED TO LOAD ROUTER: {module_name} -> {exc}")


def _load_store_if_available() -> None:
    try:
        from app.store import load_store
        from app.store import _DATA_PATH  # type: ignore

        logger.info("STORE DATA PATH: %s", _DATA_PATH)
        _safe_call(load_store, "store")
    except Exception as exc:
        logger.warning("Store loader unavailable: %s", exc)


def _init_db_if_available() -> None:
    try:
        from app.db import init_db
        _safe_call(init_db, "db")
    except Exception as exc:
        logger.warning("DB init unavailable: %s", exc)

    # TEMP: run migration once AFTER DB is ready
    try:
    from app.scripts.migrate_store_to_postgres import migrate
    migrate()
    print("✅ Migration executed")
except Exception as e:
    print("Migration skipped:", e)

def _env_csv(name: str) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return []
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


app = FastAPI(title="Vendor Connect API")

frontend_origin = os.getenv("FRONTEND_URL", "").strip().rstrip("/")

allowed_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://vendcore.co",
    "https://www.vendcore.co",
    "https://api.vendcore.co",
    "https://event-app-frontend.vercel.app",
    "https://event-app-frontend-xi.vercel.app",
    "https://event-app-frontend-7dhxwkwbm-tscottcounsel-stacks-projects.vercel.app",
    "https://event-app-frontend-1pju.vercel.app",
]

allowed_origins.extend(_env_csv("CORS_ALLOWED_ORIGINS"))

if frontend_origin:
    allowed_origins.append(frontend_origin)

allowed_origins = list(dict.fromkeys([o for o in allowed_origins if o]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

logger.info("CORS configured. allow_origins=%s", allowed_origins)

_load_store_if_available()

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Import models BEFORE DB init so SQLAlchemy registers tables before create_all().
from app.models.event import Event  # noqa: F401
from app.models.application import Application  # noqa: F401
from app.models.booth import Booth  # noqa: F401
from app.models.diagram import Diagram  # noqa: F401

_init_db_if_available()

# TEMP: run migration once AFTER DB is ready
print(">>> ABOUT TO RUN MIGRATION")

try:
    from app.scripts.migrate_store_to_postgres import migrate
    print(">>> MIGRATION IMPORTED")
    migrate()
    print(">>> MIGRATION EXECUTED")
except Exception as e:
    print(">>> MIGRATION FAILED:", repr(e))

@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    from app.store import _DATA_PATH

    return {
        "ok": True,
        "data_path": str(_DATA_PATH),
        "exists": _DATA_PATH.exists(),
    }


for module_name in [
    "app.routers.admin",
    "app.routers.applications",
    "app.routers.auth",
    "app.routers.billing",
    "app.routers.booths",
    "app.routers.diagrams",
    "app.routers.events",
    "app.routers.layout",
    "app.routers.organizer_applications",
   # "app.routers.organizer_diagram",
    "app.routers.requirements",
    "app.routers.requirements_alias",
    "app.routers.requirement_templates",
    # "app.routers.reviews",  # temporarily disabled while import issues are resolved
    "app.routers.seed",
    "app.routers.slots",
    "app.routers.stats",
    "app.routers.templates",
    "app.routers.users",
    "app.routers.vendors",
    "app.routers.vendors_v2",
    "app.routers.upload",
]:
    _try_include(app, module_name, "router")
