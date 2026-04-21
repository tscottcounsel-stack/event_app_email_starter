from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.db import engine, init_db
from app.models.application import Application  # noqa: F401
from app.models.booth import Booth  # noqa: F401
from app.models.diagram import Diagram
from app.models.event import Event

DATA_PATH = Path("/data/vendorconnect/_data_store.json")


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _coerce_json_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    return []


def _read_store() -> Dict[str, Any]:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Store file not found: {DATA_PATH}")
    raw = DATA_PATH.read_text(encoding="utf-8")
    data = json.loads(raw or "{}")
    if not isinstance(data, dict):
        raise ValueError("Store root is not a JSON object")
    return data


def _parse_event_id(key: Any, event_obj: Dict[str, Any]) -> int:
    if isinstance(event_obj.get("id"), int):
        return int(event_obj["id"])
    return int(key)


def _event_payload(src: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": src.get("title") or src.get("name") or f"Event {src.get('id')}",
        "description": src.get("description"),
        "start_date": src.get("start_date"),
        "end_date": src.get("end_date"),
        "venue_name": src.get("venue_name"),
        "street_address": src.get("street_address"),
        "city": src.get("city"),
        "state": src.get("state"),
        "zip_code": src.get("zip_code"),
        "ticket_sales_url": src.get("ticket_sales_url"),
        "google_maps_url": src.get("google_maps_url"),
        "category": src.get("category"),
        "hero_image_url": src.get("heroImageUrl") or src.get("hero_image_url"),
        "image_urls": _coerce_json_list(src.get("imageUrls") or src.get("image_urls")),
        "video_urls": _coerce_json_list(src.get("videoUrls") or src.get("video_urls")),
        "organizer_email": src.get("organizer_email"),
        "owner_email": src.get("owner_email"),
        "organizer_id": None if src.get("organizer_id") is None else str(src.get("organizer_id")),
        "owner_id": None if src.get("owner_id") is None else str(src.get("owner_id")),
        "created_by": None if src.get("created_by") is None else str(src.get("created_by")),
        "published": _coerce_bool(src.get("published")),
        "archived": _coerce_bool(src.get("archived")),
        "requirements_published": _coerce_bool(src.get("requirements_published")),
        "layout_published": _coerce_bool(src.get("layout_published")),
    }


def _diagram_payload(src: Any) -> tuple[dict, int]:
    if isinstance(src, dict):
        diagram = src.get("diagram")
        if not isinstance(diagram, dict):
            diagram = src if any(
                k in src for k in ("levels", "booths", "floors", "elements", "meta")
            ) else {}
        version = src.get("version", 0)
        try:
            version = int(version or 0)
        except Exception:
            version = 0
        return diagram or {"elements": [], "meta": {}}, version
    return {"elements": [], "meta": {}}, 0


def migrate() -> None:
    print(f"Reading store from: {DATA_PATH}")
    store = _read_store() 

print("STORE KEYS:", list(store.keys()))

events = store.get("events", {}) or {}
diagrams = store.get("diagrams", {}) or {}

print("EVENTS TYPE:", type(events).__name__)
print("DIAGRAMS TYPE:", type(diagrams).__name__)

if isinstance(events, dict):
    print("EVENT COUNT:", len(events))
    print("EVENT SAMPLE KEYS:", list(events.keys())[:10])

if isinstance(diagrams, dict):
    print("DIAGRAM COUNT:", len(diagrams))
    print("DIAGRAM SAMPLE KEYS:", list(diagrams.keys())[:10])

    events = store.get("events", {}) or {}
    diagrams = store.get("diagrams", {}) or {}

    if not isinstance(events, dict):
        raise ValueError("'events' in store is not an object")
    if not isinstance(diagrams, dict):
        raise ValueError("'diagrams' in store is not an object")

    init_db()
    SessionLocal = sessionmaker(bind=engine)

    created_events = 0
    updated_events = 0
    created_diagrams = 0
    updated_diagrams = 0

    with SessionLocal() as db:
        for raw_key, raw_event in events.items():
            if not isinstance(raw_event, dict):
                continue

            event_id = _parse_event_id(raw_key, raw_event)
            payload = _event_payload(raw_event)

            event_row = db.query(Event).filter(Event.id == event_id).first()
            if event_row is None:
                event_row = Event(id=event_id, **payload)
                db.add(event_row)
                created_events += 1
            else:
                for field, value in payload.items():
                    setattr(event_row, field, value)
                updated_events += 1

        db.flush()

        try:
            max_event_id = db.query(sa.func.max(Event.id)).scalar() or 1
            db.execute(
                sa.text(
                    "SELECT setval(pg_get_serial_sequence('events', 'id'), :max_id, true)"
                ),
                {"max_id": int(max_event_id)},
            )
        except Exception as exc:
            print(f"Warning: could not update events sequence: {exc}")

        for raw_key, raw_diagram in diagrams.items():
            try:
                event_id = int(raw_key)
            except Exception:
                continue

            if db.query(Event).filter(Event.id == event_id).first() is None:
                print(f"Skipping diagram for missing event {event_id}")
                continue

            diagram_doc, version = _diagram_payload(raw_diagram)

            diagram_row = (
                db.query(Diagram)
                .filter(Diagram.event_id == event_id)
                .order_by(Diagram.id.desc())
                .first()
            )

            if diagram_row is None:
                diagram_row = Diagram(
                    event_id=event_id,
                    diagram=diagram_doc,
                    version=version,
                )
                db.add(diagram_row)
                created_diagrams += 1
            else:
                diagram_row.diagram = diagram_doc
                diagram_row.version = version
                updated_diagrams += 1

        db.commit()

        try:
            max_diagram_id = db.query(sa.func.max(Diagram.id)).scalar() or 1
            db.execute(
                sa.text(
                    "SELECT setval(pg_get_serial_sequence('diagrams', 'id'), :max_id, true)"
                ),
                {"max_id": int(max_diagram_id)},
            )
            db.commit()
        except Exception as exc:
            print(f"Warning: could not update diagrams sequence: {exc}")

    print("Migration complete.")
    print(f"Events created: {created_events}")
    print(f"Events updated: {updated_events}")
    print(f"Diagrams created: {created_diagrams}")
    print(f"Diagrams updated: {updated_diagrams}")


if __name__ == "__main__":
    migrate()
