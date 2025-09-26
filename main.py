from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import configure_mappers

from app.db import engine

app = FastAPI(title="Event App API")

# --- Load models first so relationships exist, then configure mappers ---
from app.models import event as _event   # noqa: F401
from app.models import vendor as _vendor  # noqa: F401
from app.models import application as _application  # noqa: F401
configure_mappers()

# --- Routers (import after mappers are configured) ---
import app.routers.vendors as vendors
import app.routers.events as events
import app.routers.applications as applications

# Return DB errors as JSON during development
@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request, exc: SQLAlchemyError):
    return JSONResponse(status_code=400, content={"error": exc.__class__.__name__, "detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

app.include_router(vendors.router)
app.include_router(events.router)
app.include_router(applications.router)
