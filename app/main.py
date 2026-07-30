import importlib
import logging
import os
from pathlib import Path
from typing import Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


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
        logger.warning("Skipping router %s: %s", module_name, exc)


def _load_store_if_available() -> None:
    try:
        from app.store import load_store

        _safe_call(load_store, "store")
    except Exception as exc:
        logger.warning("Store loader unavailable: %s", exc)


def _init_db_if_available() -> None:
    try:
        from app.db import init_db

        _safe_call(init_db, "db")
    except Exception as exc:
        logger.warning("DB init unavailable: %s", exc)


def _split_origins(value: str) -> list[str]:
    origins: list[str] = []
    for raw in (value or "").replace("\n", ",").split(","):
        origin = raw.strip().rstrip("/")
        if origin:
            origins.append(origin)
    return origins


def _allowed_origins_from_env() -> list[str]:
    """Return exact CORS origins only.

    Security note: do not use a broad regex like https://*.up.railway.app with
    credentials enabled. Any browser origin that receives Access-Control-Allow-
    Origin and Access-Control-Allow-Credentials can read credentialed API
    responses. Keep production origins explicit and add preview/staging origins
    through CORS_ALLOWED_ORIGINS when needed.
    """
    default_origins = [
        # Local frontend development.
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:4173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:5173",
        # Capacitor native WebView origins.
        "capacitor://localhost",
        "ionic://localhost",
        # Production web app.
        "https://vendcore.co",
        "https://www.vendcore.co",
    ]

    configured: list[str] = []
    configured.extend(_split_origins(os.getenv("FRONTEND_URL", "")))
    configured.extend(_split_origins(os.getenv("CORS_ALLOWED_ORIGINS", "")))
    configured.extend(_split_origins(os.getenv("VENDCORE_CORS_ORIGINS", "")))

    # Vercel exposes these without scheme in many deployments. Only add exact
    # values when explicitly present. This avoids allowing every vercel.app site.
    for key in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        value = os.getenv(key, "").strip().rstrip("/")
        if value:
            configured.append(value if value.startswith(("http://", "https://")) else f"https://{value}")

    origins: list[str] = []
    for origin in [*default_origins, *configured]:
        clean = origin.strip().rstrip("/")
        if clean and clean not in origins:
            origins.append(clean)
    return origins


def _origin_is_allowed(origin: str, allowed: Iterable[str]) -> bool:
    normalized = (origin or "").strip().rstrip("/")
    return bool(normalized and normalized in set(allowed))


app = FastAPI(title="Vendor Connect API")

allowed_origins = _allowed_origins_from_env()
logger.info("CORS exact origins enabled: %s", allowed_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        # Legacy VendCore admin/frontend headers. Keep origins strict, but allow
        # older deployed screens that still send these custom headers so browser
        # preflight does not fail with "Failed to fetch".
        "X-User-Email",
        "X-User-Role",
        "X-Admin-Email",
        "X-Role",
        "x-user-email",
        "x-user-role",
        "x-admin-email",
        "x-role",
    ],
    expose_headers=["Content-Disposition"],
    max_age=600,
)

_load_store_if_available()

# Public static upload serving remains available for public marketing/profile
# images. Private verification documents must live behind protected S3/signed URL
# routes, not this directory.
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

_init_db_if_available()


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/cors-debug")
def cors_debug():
    """Small operational helper for verifying exact CORS origins.

    This does not return secrets. It lets you confirm which origins the deployed
    API is willing to echo in Access-Control-Allow-Origin.
    """
    return {
        "ok": True,
        "allowed_origins": allowed_origins,
        "uses_regex": False,
        "credentials_enabled": True,
    }


for module_name in [
    "app.routers.admin",
    "app.routers.applications",
    "app.routers.auth",
    "app.routers.billing",
    "app.routers.presence",
    "app.routers.contact",
    "app.routers.checkins",
    "app.routers.homepage_features",
    "app.routers.booths",
    "app.routers.diagrams",
    "app.routers.events",
    "app.routers.event_wall",
    "app.routers.layout",
    "app.routers.organizer_applications",
    "app.routers.organizer_diagram",
    "app.routers.organizer_profiles",
    "app.routers.vendor_notifications",
    "app.routers.vendor_ai_assist",
    "app.routers.vendor_profiles",
    # Keep the safe public vendor router before legacy vendor routers so public
    # directory/profile routes use whitelist serializers.
    "app.routers.public_vendor_safe",
    "app.routers.verification_documents",
    "app.routers.verifications",
    "app.routers.requirements",
    "app.routers.requirements_alias",
    "app.routers.requirement_templates",
    "app.routers.reviews",
    "app.routers.safety",
    "app.routers.seed",
    "app.routers.slots",
    "app.routers.stats",
    "app.routers.templates",
    "app.routers.users",
    "app.routers.vendors",
    "app.routers.vendors_v2",
    "app.routers._init_",
]:
    _try_include(app, module_name, "router")
