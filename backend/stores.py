# backend/stores.py
# Simple shared in-memory stores for tests

EVENTS: dict[int, dict] = {}
NEXT_EVENT_ID: int = 1

APPLICATIONS: dict[int, dict] = {}
NEXT_APPLICATION_ID: int = 1
