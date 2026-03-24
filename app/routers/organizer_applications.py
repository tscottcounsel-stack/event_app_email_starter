# app/routers/organizer_applications.py
"""
DEPRECATED (file-store only)

This project now uses file-based persistence via app/store.py.

Organizer application endpoints are served by app/routers/applications.py:

- GET  /organizer/events/{event_id}/applications
- POST /organizer/applications/{application_id}/status

This module intentionally defines NO routes to avoid:
- DB usage (SQLAlchemy)
- duplicate/overlapping organizer endpoints
- bypassing _data_store.json
"""

from fastapi import APIRouter

router = APIRouter(tags=["Organizer Applications (deprecated)"])
