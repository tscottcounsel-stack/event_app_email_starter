# tests/test_health_inprocess.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_inprocess():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
