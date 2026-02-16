# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    applications,
    auth,
    booths,
    diagrams,
    events,
    layout,
    requirements,
    requirements_alias,
    seed,
    slots,
    stats,
    templates,
    users,
    vendors,
    vendors_v2,
)

# ❌ DO NOT import:
# organizer_applications
# organizer_diagram


def create_app() -> FastAPI:
    app = FastAPI(title="VendorConnect API")

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

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok"}

    # ✅ Mount JSON-based routers only
    app.include_router(auth.router)
    app.include_router(events.router)
    app.include_router(vendors.router)
    app.include_router(vendors_v2.router)
    app.include_router(applications.router)
    app.include_router(diagrams.router)
    app.include_router(templates.router)
    app.include_router(booths.router)
    app.include_router(layout.router)
    app.include_router(requirements.router)
    app.include_router(requirements_alias.router)
    app.include_router(users.router)
    app.include_router(stats.router)
    app.include_router(slots.router)
    app.include_router(seed.router)

    return app


app = create_app()
