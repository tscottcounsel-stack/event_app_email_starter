from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.routers import auth as auth_router
from backend.routers import events as events_router
from backend.routers import vendors as vendors_router
from backend.routers import applications as applications_router
from backend.routers import cleanup as cleanup_router

app = FastAPI(title="Event App")

# Static files for uploads
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads")).resolve()
(UPLOAD_DIR / "events").mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")

# Routers
app.include_router(auth_router.router)
app.include_router(events_router.router)
app.include_router(vendors_router.router)
app.include_router(applications_router.router)
app.include_router(cleanup_router.router)

# Health
@app.get("/")
def root():
    return {"status": "ok", "message": "Event App API"}

@app.get("/ping")
def ping():
    return {"status": "ok"}
