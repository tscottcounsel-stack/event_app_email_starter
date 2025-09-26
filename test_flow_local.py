import requests

BASE_URL = "http://127.0.0.1:8000"

# Organizer + Vendor test accounts (from seed_data.py)
organizer_email = "organizer@example.com"
password = "testpass"

# Multiple vendors
vendors = [
    "catering@example.com",
    "photography@example.com",
    "dj@example.com"
]

def login(email, password):
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    print(f"Login ({email}):", r.status_code, r.text)  # debug
    r.raise_for_status()
    return r.json()["access_token"]

def auth_header(token):
    return {"Authorization": f"Bearer {token}"}

def run_flow():
    # 1. Organizer login
    organizer_token = login(organizer_email, password)
    print("Organizer logged in.")

    # 2. Organizer creates an event
    event_data = {
        "title": "Multi-Vendor Test Event",
        "description": "Event for testing multiple vendor applications",
        "date": "2025-09-15T18:00:00",
        "location": "Atlanta, GA"
    }
    r = requests.post(f"{BASE_URL}/events/", json=event_data, headers=auth_header(organizer_token))
    r.raise_for_status()
    event = r.json()
    event_id = event["id"]
    print(f"Event created: {event['title']} (id={event_id})")

    # 3. Each vendor logs in and applies
    app_ids = []
    for v_email in vendors:
        vendor_token = login(v_email, password)
        print(f"Vendor {v_email} logged in.")
        app_data = {"event_id": event_id, "message": f"{v_email} would like to join!"}
        r = requests.post(f"{BASE_URL}/applications/", json=app_data, headers=auth_header(vendor_token))
        r.raise_for_status()
        application = r.json()
        app_ids.append(application["id"])
        print(f"Vendor {v_email} applied (application id={application['id']}, status={application['status']})")

    # 4. Organizer views all applications
    r = requests.get(f"{BASE_URL}/applications/event/{event_id}", headers=auth_header(organizer_token))
    r.raise_for_status()
    apps = r.json()
    print(f"Organizer sees {len(apps)} applications:")
    for a in apps:
        print(a)

    # 5. Organizer approves the first, declines the others
    for i, app_id in enumerate(app_ids):
        status = "approved" if i == 0 else "declined"
        r = requests.put(f"{BASE_URL}/applications/{app_id}?status={status}", headers=auth_header(organizer_token))
        r.raise_for_status()
        updated = r.json()
        print(f"Organizer set application {app_id} -> {updated['status']}")

    # 6. Each vendor checks their own applications
    for v_email in vendors:
        vendor_token = login(v_email, password)
        r = requests.get(f"{BASE_URL}/applications/mine", headers=auth_header(vendor_token))
        r.raise_for_status()
        vendor_apps = r.json()
        print(f"{v_email} sees their applications: {vendor_apps}")

if __name__ == "__main__":
    run_flow()
