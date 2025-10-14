from fastapi.testclient import TestClient

from main import app

c = TestClient(app)


def hit(method, path, **kw):
    r = c.request(method, path, **kw)
    ct = r.headers.get("content-type", "")
    body = r.json() if "application/json" in ct else r.text
    print(f"{method} {path} ->", r.status_code, body)


hit(
    "POST",
    "/auth/register",
    json={"email": "v@example.com", "password": "x", "role": "vendor"},
)
hit("POST", "/auth/login", json={"email": "v@example.com", "password": "x"})
hit(
    "POST",
    "/events",
    json={"title": "t", "date": "2025-12-01T00:00:00Z", "location": "x"},
    headers={"Authorization": "x"},
)
hit(
    "POST",
    "/events/",
    json={"title": "t", "date": "2025-12-01T00:00:00Z", "location": "x"},
    headers={"Authorization": "x"},
)
hit("POST", "/vendors", json={"name": "Test Vendor"}, headers={"Authorization": "x"})
hit("GET", "/vendors")
hit(
    "POST",
    "/applications",
    json={"event_id": 1, "vendor_id": 1},
    headers={"Authorization": "x"},
)
hit("GET", "/applications")
