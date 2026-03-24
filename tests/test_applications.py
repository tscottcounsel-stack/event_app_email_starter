import json
import time
from datetime import datetime, timedelta

import requests


def _auth(base_url, json_headers, email, role):
    # register or reuse
    requests.post(
        f"{base_url}/auth/register",
        headers=json_headers,
        data=json.dumps({"email": email, "password": "pass123", "role": role}),
        timeout=10,
    )
    login = requests.post(
        f"{base_url}/auth/login",
        headers=json_headers,
        data=json.dumps({"email": email, "password": "pass123"}),
        timeout=10,
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def test_vendor_can_apply_to_event(base_url, json_headers):
    vendor_email = f"pytest_vendor_{int(time.time())}@example.com"
    org_email = f"pytest_org_{int(time.time())}@example.com"

    v_headers = _auth(base_url, json_headers, vendor_email, "vendor")
    o_headers = _auth(base_url, json_headers, org_email, "organizer")

    # Create event
    start = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
    ev = requests.post(
        f"{base_url}/events/",
        headers=o_headers,
        data=json.dumps(
            {
                "title": "Pytest Event",
                "description": "x",
                "date": start,
                "location": "Test City",
            }
        ),
        timeout=10,
    )
    assert ev.status_code == 200
    event_id = ev.json()["id"]

    # Vendor profile
    vp = requests.post(
        f"{base_url}/vendors/",
        headers=v_headers,
        data=json.dumps({"display_name": "Py Vendor"}),
        timeout=10,
    )
    assert vp.status_code == 200
    vendor_id = vp.json()["id"]

    # Apply
    app = requests.post(
        f"{base_url}/applications/",
        headers=v_headers,
        data=json.dumps(
            {"event_id": event_id, "vendor_id": vendor_id, "message": "hello"}
        ),
        timeout=10,
    )
    assert app.status_code in (200, 201)
