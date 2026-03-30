import importlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

# 🔥 CRITICAL FIX — USE RAILWAY PERSISTENT VOLUME
UPLOADS_DIR = Path("/data/uploads")

# Ensure directory exists (Railway-safe)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

logger.info("UPLOADS DIR: %s", UPLOADS_DIR)


def _safe_call(func, label: str) -> None:
    try:
        func()
        logger.info("%s initialized", label)
  except Exception as exc:
    raise RuntimeError(f"FAILED TO LOAD ROUTER: {module_name} → {exc}")


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


def _env_csv(name: str) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


app = FastAPI(title="Vendor Connect API")

frontend_origin = os.getenv("FRONTEND_URL", "").strip()

allowed_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://eventappemailstarter-production.up.railway.app",
    "https://event-app-frontend-xi.vercel.app",
]

allowed_origins.extend(_env_csv("CORS_ALLOWED_ORIGINS"))

if frontend_origin:
    allowed_origins.append(frontend_origin)

allowed_origins = list(dict.fromkeys([origin for origin in allowed_origins if origin]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.up\.railway\.app|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("CORS allowed origins: %s", allowed_origins)

_load_store_if_available()

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

_init_db_if_available()


@app.options("/{full_path:path}")
async def preflight_handler(request: Request, full_path: str):
    origin = request.headers.get("origin", "")
    allow_origin = origin if origin in allowed_origins else "*"
    request_headers = request.headers.get("access-control-request-headers", "*")

    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": allow_origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": request_headers,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        },
    )


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"ok": True}


for module_name in [
    "app.routers.admin",
    "app.routers.applications",
    "app.routers.auth",
    "app.routers.booths",
    "app.routers.diagrams",
    "app.routers.events",
    "app.routers.layout",
    "app.routers.organizer_applications",
    "app.routers.organizer_diagram",
    "app.routers.requirements",
    "app.routers.requirements_alias",
    "app.routers.requirement_templates",
    "app.routers.reviews",
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
