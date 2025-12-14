# app/main.py
from __future__ import annotations

import importlib
import pkgutil

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def include_all_routers(app: FastAPI) -> None:
    """
    Auto-discovers app.routers.* modules and includes any that export `router`.

    IMPORTANT: If a router module fails to import, it is skipped (but server still boots).
    This keeps the app up while you fix one broken router at a time.
    """
    pkg = importlib.import_module("app.routers")

    for modinfo in pkgutil.iter_modules(pkg.__path__, pkg.__name__ + "."):
        name = modinfo.name
        try:
            m = importlib.import_module(name)
        except Exception as e:
            print(f"[main] Skipping router module {name} (import failed): {e}")
            continue

        router = getattr(m, "router", None)
        if router is None:
            continue

        try:
            app.include_router(router)
            print(f"[main] Included router from {name}")
        except Exception as e:
            print(f"[main] Skipping router module {name} (include failed): {e}")


app = FastAPI(title="Event App API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


include_all_routers(app)
