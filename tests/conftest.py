# tests/conftest.py  (new)
# tests/conftest.py  (example)
from backend.deps import get_current_user
from main import app


def override_user():
    return {"id": 123, "email": "vendor@example.com", "is_active": True}


def pytest_sessionstart(session):
    app.dependency_overrides[get_current_user] = override_user


import os
import threading
import time

import pytest
import requests
import uvicorn

PORT = int(os.getenv("TEST_PORT", "8010"))
HOST = "127.0.0.1"


def _run_server():
    uvicorn.run("backend.main:app", host=HOST, port=PORT, log_level="warning")


@pytest.fixture(scope="session", autouse=True)
def _api_server():
    # start server in background
    t = threading.Thread(target=_run_server, daemon=True)
    t.start()
    # wait until ready
    for _ in range(100):
        try:
            requests.get(f"http://{HOST}:{PORT}/ping", timeout=0.3)
            break
        except Exception:
            time.sleep(0.1)
    yield
    # daemon thread will exit after pytest ends


@pytest.fixture(scope="session")
def base_url():
    return f"http://{HOST}:{PORT}"


@pytest.fixture(scope="session")
def json_headers():
    return {"Content-Type": "application/json", "Accept": "application/json"}


# Ensure SQLite file locks are released so temp files can be deleted on Windows
@pytest.fixture(scope="session", autouse=True)
def _dispose_engine_on_exit():
    yield
    try:
        from backend.config.database import engine

        engine.dispose()
    except Exception:
        pass
