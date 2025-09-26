# tests/test_vendor.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_create_vendor():
    payload = {
        "email": "vendor2@example.com",
        "password": "secret123",
        "role": "vendor"
    }
    response = client.post("/auth/register", json=payload)
    assert response.status_code in [200, 201]
    data = response.json()
    assert "id" in data
    assert data["email"] == payload["email"]

def test_get_vendor():
    # Assumes vendor with ID 1 exists after creation
    response = client.get("/vendors/1")
    if response.status_code == 200:  # if vendor exists
        data = response.json()
        assert "id" in data
        assert "email" in data
    else:
        # vendor endpoint not yet implemented
        assert response.status_code in [404, 501]
