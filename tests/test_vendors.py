import os

from fastapi.testclient import TestClient

os.environ.setdefault("RATE_LIMIT_PER_MIN", "1000")  # avoid flakiness locally

from main import app  # after env tweaks

client = TestClient(app)

HEADERS = {"x-api-key": "dev-123", "x-user-role": "organizer"}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_vendors_crud_smoke():
    # list (empty or not; should be 200)
    r = client.get("/vendors?limit=1", headers=HEADERS)
    assert r.status_code == 200

    # create one
    payload = {
        "name": "Test Vendor",
        "category": "Demo",
        "phone": "555-0000",
        "description": "Smoke test",
    }
    r = client.post("/vendors", headers=HEADERS, json=payload)
    assert r.status_code == 201
    vid = r.json()["id"]

    # fetch it
    r = client.get(f"/vendors/{vid}", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Vendor"
