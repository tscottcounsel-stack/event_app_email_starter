from __future__ import annotations

import importlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

# Use Railway persistent volume for uploads
UPLOADS_DIR = Path("/data/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

logger.info("UPLOADS DIR: %s", UPLOADS_DIR)


def _safe_call(func, label: str) -> None:
    try:
        func()
        logger.info("%s initialized", label)
    except Exception as exc:
        logger.warning("%s init skipped: %s", label, exc)


def _try_include(app: FastAPI, module_name: str, attr_name: str = "router") -> None:
    try:
        module = importlib.import_module(module_name)
        router = getattr(module, attr_name, None)
        if router is None:
            logger.warning("Module %s has no %s", module_name, attr_name)
            return
        app.include_router(router)
        logger.info("Included router from %s", module_name)
    except Exception as exc:
        raise RuntimeError(f"FAILED TO LOAD ROUTER: {module_name} -> {exc}")


def _load_store_if_available() -> None:
    try:
        from app.store import load_store
        from app.store import _DATA_PATH  # type: ignore

        logger.info("STORE DATA PATH: %s", _DATA_PATH)
        _safe_call(load_store, "store")
    except Exception as exc:
        logger.warning("Store loader unavailable: %s", exc)


def _init_db_if_available() -> None:
    try:
        from app.db import init_db
        _safe_call(init_db, "db")
    except Exception as exc:
        logger.warning("DB init unavailable: %s", exc)

def _sync_events_store_from_db_if_available() -> None:
    try:
        from app.db import SessionLocal  # type: ignore
        from app.models.event import Event  # type: ignore
        from app.store import _EVENTS, save_store  # type: ignore

        db = SessionLocal()
        try:
            rows = db.query(Event).all()
            synced = 0
            for ev in rows:
                organizer_name = (
                    getattr(ev, "organizer_name", None)
                    or getattr(ev, "company_name", None)
                    or getattr(ev, "host_name", None)
                    or getattr(ev, "title", None)
                    or getattr(ev, "organizer_email", None)
                    or getattr(ev, "owner_email", None)
                    or "Organizer"
                )
                title = (
                    getattr(ev, "title", None)
                    or getattr(ev, "name", None)
                    or getattr(ev, "event_title", None)
                    or f"Event #{getattr(ev, 'id', '')}"
                )

                _EVENTS[int(ev.id)] = {
                    **(_EVENTS.get(int(ev.id), {}) if isinstance(_EVENTS.get(int(ev.id)), dict) else {}),
                    "id": ev.id,
                    "title": title,
                    "name": title,
                    "event_title": title,
                    "description": getattr(ev, "description", None),
                    "start_date": getattr(ev, "start_date", None).isoformat() if getattr(ev, "start_date", None) else None,
                    "end_date": getattr(ev, "end_date", None).isoformat() if getattr(ev, "end_date", None) else None,
                    "venue_name": getattr(ev, "venue_name", None),
                    "street_address": getattr(ev, "street_address", None),
                    "city": getattr(ev, "city", None),
                    "state": getattr(ev, "state", None),
                    "zip_code": getattr(ev, "zip_code", None),
                    "ticket_sales_url": getattr(ev, "ticket_sales_url", None),
                    "google_maps_url": getattr(ev, "google_maps_url", None),
                    "category": getattr(ev, "category", None),
                    "heroImageUrl": getattr(ev, "hero_image_url", None),
                    "imageUrls": list(getattr(ev, "image_urls", None) or []),
                    "videoUrls": list(getattr(ev, "video_urls", None) or []),
                    "published": bool(getattr(ev, "published", False)),
                    "archived": bool(getattr(ev, "archived", False)),
                    "requirements_published": bool(getattr(ev, "requirements_published", False)),
                    "layout_published": bool(getattr(ev, "layout_published", False)),
                    "organizer_name": organizer_name,
                    "company_name": organizer_name,
                    "host_name": organizer_name,
                    "organizer_email": getattr(ev, "organizer_email", None),
                    "owner_email": getattr(ev, "owner_email", None),
                    "email": getattr(ev, "organizer_email", None) or getattr(ev, "owner_email", None),
                    "organizer_id": getattr(ev, "organizer_id", None),
                    "owner_id": getattr(ev, "owner_id", None),
                    "created_by": getattr(ev, "created_by", None),
                    "created_at": getattr(ev, "created_at", None).isoformat() if getattr(ev, "created_at", None) else None,
                    "updated_at": getattr(ev, "updated_at", None).isoformat() if getattr(ev, "updated_at", None) else None,
                }
                synced += 1

            save_store()
            logger.info("Synced %s events from DB into JSON store", synced)
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Event store sync unavailable: %s", exc)

def _env_csv(name: str) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return []
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


app = FastAPI(title="Vendor Connect API")

frontend_origin = os.getenv("FRONTEND_URL", "").strip().rstrip("/")

allowed_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://vendcore.co",
    "https://www.vendcore.co",
    "https://api.vendcore.co",
    "https://event-app-frontend.vercel.app",
    "https://event-app-frontend-xi.vercel.app",
    "https://event-app-frontend-7dhxwkwbm-tscottcounsel-stacks-projects.vercel.app",
    "https://event-app-frontend-1pju.vercel.app",
]

allowed_origins.extend(_env_csv("CORS_ALLOWED_ORIGINS"))

if frontend_origin:
    allowed_origins.append(frontend_origin)

allowed_origins = list(dict.fromkeys([o for o in allowed_origins if o]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

logger.info("CORS configured. allow_origins=%s", allowed_origins)

_load_store_if_available()

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Import models BEFORE DB init so SQLAlchemy registers tables before create_all().
from app.models.event import Event  # noqa: F401
from app.models.application import Application  # noqa: F401
from app.models.booth import Booth  # noqa: F401
from app.models.diagram import Diagram  # noqa: F401

_init_db_if_available()
_sync_events_store_from_db_if_available()


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    from app.store import _DATA_PATH

    return {
        "ok": True,
        "data_path": str(_DATA_PATH),
        "exists": _DATA_PATH.exists(),
    }


@app.get("/organizers/public/{email}")
def public_organizer_profile(email: str):
    """Public organizer profile derived from the organizer's event records."""
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Organizer email is required")

    try:
        from app.db import SessionLocal
        from app.models.event import Event
    except Exception as exc:
        logger.warning("Organizer profile dependencies unavailable: %s", exc)
        raise HTTPException(status_code=500, detail="Organizer profile service unavailable")

    db = SessionLocal()
    try:
        rows = (
            db.query(Event)
            .filter(
                (Event.organizer_email == normalized_email)
                | (Event.owner_email == normalized_email)
            )
            .order_by(Event.id.desc())
            .all()
        )

        if not rows:
            raise HTTPException(status_code=404, detail="Organizer not found")

        latest = rows[0]
        public_events = [
            ev for ev in rows
            if bool(getattr(ev, "published", False)) and not bool(getattr(ev, "archived", False))
        ]

        display_name = (
            getattr(latest, "organizer_name", None)
            or getattr(latest, "company_name", None)
            or getattr(latest, "host_name", None)
            or normalized_email.split("@")[0].replace(".", " ").replace("_", " ").title()
            or "Organizer"
        )
        description = (
            f"{display_name} hosts vendor-ready events on VendCore. "
            "View this organizer's public profile, verification status, and current event activity."
        )

        return {
            "organizer": {
                "email": normalized_email,
                "business_name": display_name,
                "name": display_name,
                "description": description,
                "business_description": description,
                "city": getattr(latest, "city", None) or "",
                "state": getattr(latest, "state", None) or "",
                "country": "United States",
                "verified": True,
                "verification_status": "verified",
                "events_count": len(rows),
                "public_events_count": len(public_events),
                "rating": 0,
                "review_count": 0,
            },
            "events": [
                {
                    "id": ev.id,
                    "title": ev.title,
                    "description": ev.description,
                    "start_date": ev.start_date.isoformat() if getattr(ev, "start_date", None) else None,
                    "end_date": ev.end_date.isoformat() if getattr(ev, "end_date", None) else None,
                    "venue_name": ev.venue_name,
                    "city": ev.city,
                    "state": ev.state,
                    "published": bool(ev.published),
                }
                for ev in public_events
            ],
        }
    finally:
        db.close()


for module_name in [
    "app.routers.admin",
    "app.routers.applications",
    "app.routers.auth",
    "app.routers.billing",
    "app.routers.booths",
    "app.routers.diagrams",
    "app.routers.events",
    "app.routers.layout",
    "app.routers.organizer_applications",
   # "app.routers.organizer_diagram",
    "app.routers.requirements",
    "app.routers.requirements_alias",
    "app.routers.requirement_templates",
    # "app.routers.reviews",  # temporarily disabled while import issues are resolved
    "app.routers.seed",
    "app.routers.slots",
    "app.routers.stats",
    "app.routers.templates",
    "app.routers.users",
    "app.routers.vendors",
    "app.routers.vendors_v2",
    "app.routers.upload",
]:
    _try_include(app, module_name, "router")
