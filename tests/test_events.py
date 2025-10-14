import json
import time
from datetime import datetime, timedelta

import requests


def test_event_creation_unauthorized(base_url, json_headers):
    # Try to create event without a token
    start = (datetime.utcnow() + timedelta(days=5)).isoformat() + "Z"
    res = requests.post(
        f"{base_url}/events/",
        headers=json_headers,  # no Authorization header here
        data=json.dumps(
            {
                "title": "Unauthorized Event",
                "description": "oops",
                "date": start,
                "location": "Nowhere",
            }
        ),
        timeout=10,
    )
    assert res.status_code == 401


def test_event_creation_invalid_payload(base_url, json_headers):
    # Register + login as organizer
    email = f"pytest_event_invalid_{int(time.time())}@example.com"
    requests.post(
        f"{base_url}/auth/register",
        headers=json_headers,
        data=json.dumps({"email": email, "password": "pass123", "role": "organizer"}),
        timeout=10,
    )
    login = requests.post(
        f"{base_url}/auth/login",
        headers=json_headers,
        data=json.dumps({"email": email, "password": "pass123"}),
        timeout=10,
    )
    token = login.json()["access_token"]
    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Send an invalid payload (missing required fields)
    bad_event = requests.post(
        f"{base_url}/events/",
        headers=auth_headers,
        data=json.dumps({"title": ""}),  # invalid
        timeout=10,
    )
    assert bad_event.status_code == 422


import pytest
from httpx import AsyncClient

from main import app


@pytest.mark.asyncio
async def test_event_flow():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        # ---- 1. Register + login as organizer ----
        org_email = "pytest_organizer@example.com"
        reg_res = await ac.post(
            "/auth/register",
            json={"email": org_email, "password": "testpass", "role": "organizer"},
        )
        assert reg_res.status_code in [200, 400]  # 400 if already exists

        login_res = await ac.post(
            "/auth/login", json={"email": org_email, "password": "testpass"}
        )
        assert login_res.status_code == 200
        org_token = login_res.json()["access_token"]

        # ---- 2. Organizer creates an event ----
        event_data = {
            "title": "Pytest Event",
            "description": "Event created during automated test",
            "date": "2025-09-15T18:00:00",
            "location": "Atlanta, GA",
        }
        ev_res = await ac.post(
            "/events/",
            json=event_data,
            headers={"Authorization": f"Bearer {org_token}"},
        )
        assert ev_res.status_code == 200
        event = ev_res.json()
        event_id = event["id"]

        # ---- 3. Register + login as vendor ----
        vendor_email = "pytest_vendor@example.com"
        reg_v = await ac.post(
            "/auth/register",
            json={"email": vendor_email, "password": "testpass", "role": "vendor"},
        )
        assert reg_v.status_code in [200, 400]

        login_v = await ac.post(
            "/auth/login", json={"email": vendor_email, "password": "testpass"}
        )
        assert login_v.status_code == 200
        vendor_token = login_v.json()["access_token"]

        # ---- 4. Vendor applies to the event ----
        app_res = await ac.post(
            "/applications/",
            json={"event_id": event_id, "message": "I would like to participate!"},
            headers={"Authorization": f"Bearer {vendor_token}"},
        )
        assert app_res.status_code == 200
        application = app_res.json()
        app_id = application["id"]
        assert application["status"] == "pending"

        # ---- 5. Organizer views applications ----
        list_res = await ac.get(
            f"/applications/event/{event_id}",
            headers={"Authorization": f"Bearer {org_token}"},
        )
        assert list_res.status_code == 200
        apps = list_res.json()
        assert any(app["id"] == app_id for app in apps)

        # ---- 6. Organizer approves the vendor ----
        upd_res = await ac.put(
            f"/applications/{app_id}?status=approved",
            headers={"Authorization": f"Bearer {org_token}"},
        )
        assert upd_res.status_code == 200
        updated = upd_res.json()
        assert updated["status"] == "approved"

        # ---- 7. Vendor checks their applications ----
        my_apps = await ac.get(
            "/applications/mine", headers={"Authorization": f"Bearer {vendor_token}"}
        )
        assert my_apps.status_code == 200
        vendor_apps = my_apps.json()
        assert any(app["status"] == "approved" for app in vendor_apps)
