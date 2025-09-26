from __future__ import annotations

# ── Env (.env beside this file) ────────────────────────────────────────────────
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(dotenv_path=ROOT / ".env")  # explicit path avoids stdin/stack quirks

# ── FastAPI / SQLAlchemy setup ─────────────────────────────────────────────────
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import configure_mappers

from app.db import engine  # DB engine (and get_db used by routers)

# App instance
app = FastAPI(title="Event App API")

# ── Models FIRST (so relationships exist), then configure mappers ─────────────
# Importing registers tables/relationships on the shared Base.metadata
from app.models import event as _event  # noqa: F401
from app.models import vendor as _vendor  # noqa: F401
from app.models import application as _application  # noqa: F401

configure_mappers()  # finalize mappings before including routers

# ── Routers (after mappers are configured) ────────────────────────────────────
import app.routers.vendors as vendors
import app.routers.events as events
import app.routers.applications as applications
import app.routers.seed as seed

app.include_router(vendors.router)
app.include_router(events.router)
app.include_router(applications.router)
app.include_router(seed.router)


# ── Global error handling (dev-friendly JSON) ─────────────────────────────────
@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request, exc: SQLAlchemyError):
    return JSONResponse(
        status_code=400,
        content={"error": exc.__class__.__name__, "detail": str(exc)},
    )

# ── CORS (tighten allow_origins for prod) ─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health checks ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/health/db")
def health_db():
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        return {"db": "ok"}
    except Exception as e:
        return {"db": "error", "detail": str(e)}
