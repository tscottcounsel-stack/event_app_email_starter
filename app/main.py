# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="VendorConnect API", version="0.1.0")

# CORS (adjust origins as needed)
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


# Import + include routers.
# If one import fails, we still want the server to boot so you can see what broke.
def _include(path: str):
    try:
        mod = __import__(path, fromlist=["router"])
        router = getattr(mod, "router", None)
        if router is not None:
            app.include_router(router)
            print(f"[main] Included router from {path}")
        else:
            print(f"[main] Skipping {path} (no router attr)")
    except Exception as e:
        print(f"[main] Skipping {path} (import failed): {e}")


# Core routers (based on your repo screenshots)
_include("app.routers.auth")
_include("app.routers.auth_debug")
_include("app.routers.public_events")
_include("app.routers.public_diagram")
_include("app.routers.public_organizers")
_include("app.routers.public_vendors")
_include("app.routers.public_vendor_categories")

_include("app.routers.events")
_include("app.routers.applications")
_include("app.routers.event_invites")

_include("app.routers.organizer_events")
_include("app.routers.organizer_event_update")
_include("app.routers.organizer_applications")
_include("app.routers.organizer_contacts")
_include("app.routers.organizer_profile")
_include("app.routers.organizer_diagram")
_include("app.routers.organizer_event_invites")

_include("app.routers.vendor_diagram")
_include("app.routers.vendor_profile")
_include("app.routers.vendors")
_include("app.routers.vendors_v2")

_include("app.routers.users")
_include("app.routers.slots")
_include("app.routers.stats")
_include("app.routers.seed")
