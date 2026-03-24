# tests/test_health.py
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    # Adjust depending on your real response
    assert "message" in response.json()


def test_ping():
    response = client.get("/ping")
    assert response.status_code == 200
    assert "pong" in response.text.lower()
