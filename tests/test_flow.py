import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.config.database import Base
from backend.deps import get_db
from backend.main import app


@pytest.fixture(scope="session")
def tmp_db_url():
    fd, path = tempfile.mkstemp(prefix="app_test_", suffix=".db")
    os.close(fd)
    yield f"sqlite:///{path}"
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


@pytest.fixture(scope="session")
def test_client(tmp_db_url):
    engine = create_engine(tmp_db_url, connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def _get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_register_login_and_crud(test_client: TestClient):
    # Register vendor
    r = test_client.post(
        "/auth/register",
        json={"email": "v1@example.com", "password": "secret123", "role": "vendor"},
    )
    assert r.status_code == 200

    # Login vendor
    r = test_client.post(
        "/auth/login", json={"email": "v1@example.com", "password": "secret123"}
    )
    assert r.status_code == 200
    tok = r.json()
    headers = {"Authorization": f"Bearer {tok['access_token']}"}

    # Create/Upsert vendor profile
    r = test_client.post(
        "/vendors/", json={"display_name": "Vendor One", "bio": "hi"}, headers=headers
    )
    assert r.status_code == 201
    me_vendor = r.json()
    assert me_vendor["display_name"] == "Vendor One"

    # Register organizer
    r = test_client.post(
        "/auth/register",
        json={"email": "o1@example.com", "password": "secret123", "role": "organizer"},
    )
    assert r.status_code == 200

    # Login organizer
    r = test_client.post(
        "/auth/login", json={"email": "o1@example.com", "password": "secret123"}
    )
    org_tok = r.json()
    org_headers = {"Authorization": f"Bearer {org_tok['access_token']}"}

    # Create event
    now = datetime.now(timezone.utc)
    r = test_client.post(
        "/events/",
        json={
            "title": "Kickoff",
            "description": "demo",
            "start_time": (now + timedelta(hours=1)).isoformat(),
            "end_time": (now + timedelta(hours=2)).isoformat(),
        },
        headers=org_headers,
    )
    assert r.status_code == 201
    ev = r.json()
    assert ev["title"] == "Kickoff"

    # List events
    r = test_client.get("/events/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
