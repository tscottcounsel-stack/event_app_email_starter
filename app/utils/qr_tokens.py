import os
import jwt
from datetime import datetime, timedelta

SECRET = os.getenv("QR_SECRET", "dev-secret-change-this")
ALGO = "HS256"


def generate_qr_token(event_id: int, vendor_id: int, application_id: int):
    payload = {
        "event_id": event_id,
        "vendor_id": vendor_id,
        "application_id": application_id,
        "exp": datetime.utcnow() + timedelta(hours=24),
        "type": "event_checkin",
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


def verify_qr_token(token: str):
    return jwt.decode(token, SECRET, algorithms=[ALGO])