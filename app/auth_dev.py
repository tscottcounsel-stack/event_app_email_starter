# app/auth_dev.py
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

bearer = HTTPBearer(auto_error=True)
DEV_TOKEN = os.environ.get("DEV_TOKEN", "devtoken123")

def get_current_user_dev(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    token = creds.credentials
    if token != DEV_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid dev token")
    # Return a minimal user with organizer role so writes are allowed
    return {"id": 0, "email": "dev@example.com", "role": "organizer"}
