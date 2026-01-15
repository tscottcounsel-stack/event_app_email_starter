# app/main.py
from __future__ import annotations

import importlib

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import require_organizer

app = FastAPI(title="VendorConnect API", version="0.1.0")

DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _include(module_path: str) -> None:
    """
    Import module and include its `router` if present.
    Never crash the app if one router file is broken — just log and skip.
    """
    try:
        mod = importlib.import_module(module_path)
        router = getattr(mod, "router", None)
        if router is None:
            print(f"[ROUTER] SKIP {module_path} (no router)")
            return
        app.include_router(router)
        print(f"[ROUTER] OK   {module_path}")
    except Exception as e:
        print(f"[ROUTER] FAIL {module_path}: {repr(e)}")


# Core routers (add more as needed)
_include("app.routers.organizer_events")
_include("app.routers.organizer_diagram")
_include("app.routers.organizer_profile")
_include("app.routers.organizer_contacts")
_include("app.routers.organizer_messages")
_include("app.routers.organizer_applications")

_include("app.routers.vendor_profile")
_include("app.routers.vendor_diagram")
_include("app.routers.public_events")


@app.get("/organizer/whoami")
def organizer_whoami(organizer=Depends(require_organizer)):
    # safe debug endpoint
    return {
        "id": getattr(organizer, "id", None),
        "user_id": getattr(organizer, "user_id", None),
        "email": getattr(organizer, "email", None),
        "role": getattr(organizer, "role", None),
    }


@app.get("/health")
def health():
    return {"ok": True}
