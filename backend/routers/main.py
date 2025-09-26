from __future__ import annotations
from __future__ import annotations


from fastapi import FastAPI

from backend.config.database import init_db
from backend.routers import auth as auth_router
from backend.routers import vendor as vendor_router
from backend.routers import events as events_router
from backend.routers import cleanup as cleanup_router
from backend.routers import health as health_router
from backend.config.database import dispose_engine

app = FastAPI(title="Event App (Tests)")

@app.on_event("startup")
def _startup():
    init_db()

@app.on_event("shutdown")
def _shutdown_dispose_engine():
    dispose_engine()

# routes
app.include_router(health_router.router)
app.include_router(auth_router.router)
app.include_router(vendor_router.router)
app.include_router(events_router.router)
app.include_router(cleanup_router.router)

