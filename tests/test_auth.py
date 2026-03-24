# tests/test_auth.py
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_register_vendor():
    payload = {"email": "vendor@example.com", "password": "secret123", "role": "vendor"}
    response = client.post("/auth/register", json=payload)
    assert response.status_code in [200, 201]
    data = response.json()
    assert "id" in data
    assert data["email"] == payload["email"]


def test_login_vendor():
    payload = {"email": "vendor@example.com", "password": "secret123"}
    response = client.post("/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

    # Save token for next test
    global access_token
    access_token = data["access_token"]


def test_refresh_token():
    # Get a fresh token for THIS test
    login_payload = {"email": "vendor@example.com", "password": "secret123"}
    login_resp = client.post("/auth/login", json=login_payload)
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post("/auth/refresh", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
