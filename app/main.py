# app/main.py
import importlib
import os
print("MAIN LOADED FROM:", __file__)
print("CWD:", os.getcwd())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth

app = FastAPI(title="Event App API", version="0.1.0")

# ✅ GLOBAL CORS (dev-safe)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTER_MODULES = [
    "app.routers.applications",
    "app.routers.auth",
    "app.routers.events",  # ✅ ADD THIS
    "app.routers.organizer_applications",
    "app.routers.organizer_diagram",
    "app.routers.public_diagram",
    "app.routers.seed",
    "app.routers.slots",
    "app.routers.stats",
    "app.routers.users",
    "app.routers.vendor_diagram",
    "app.routers.vendors",
    "app.routers.vendors_v2",
]

for module_str in ROUTER_MODULES:
    try:
        mod = importlib.import_module(module_str)
        router = getattr(mod, "router", None)
        if router is None:
            print(f"[main] Skipping router module {module_str} (no router attr)")
            continue
        app.include_router(router)
        print(f"[main] Included router from {module_str}")
    except Exception as e:
        print(f"[main] Skipping router module {module_str} (import failed): {e}")
        # Force OpenAPI schema regeneration (prevents stale schema when routers are added later)
        app.openapi_schema = None

@app.get("/health")
def health():
    return {"ok": True}
