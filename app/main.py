# app/main.py
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


def _try_include(app: FastAPI, module_path: str, attr: str = "router") -> None:
    """
    Include routers that are truly optional.
    If missing/broken, we skip (but we DO NOT use this for core routes).
    """
    try:
        mod = __import__(module_path, fromlist=[attr])
        r = getattr(mod, attr, None)
        if r is not None:
            app.include_router(r)
    except Exception:
        # optional: skip silently
        pass


def create_app() -> FastAPI:
    app = FastAPI(title="VendorConnect API")

    # ----------------------------
    # Static uploads (/uploads/*)
    # ----------------------------
    base_dir = os.path.dirname(os.path.abspath(__file__))
    upload_dir = os.path.abspath(os.path.join(base_dir, "..", "uploads"))
    os.makedirs(upload_dir, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")

    # ----------------------------
    # CORS (dev)
    # ----------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ----------------------------
    # Core Routers (DO NOT swallow failures)
    # ----------------------------
    # If these fail to import, we WANT the server to error so you see the real cause.
    from app.routers import applications, events, requirement_templates

    app.include_router(events.router)
    app.include_router(applications.router)
    app.include_router(requirement_templates.router)
    # ----------------------------
    # Optional Routers (safe include)
    # ----------------------------
    _try_include(app, "app.routers.auth")
    _try_include(app, "app.routers.vendors")
    _try_include(app, "app.routers.vendors_v2")
    _try_include(app, "app.routers.stats")
    _try_include(app, "app.routers.check_fk")

    # ----------------------------
    # Health check
    # ----------------------------
    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
