from typing import Callable, Optional

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False)


def _decode_token_or_401(token: str) -> dict:
    if jwt is None:
        raise HTTPException(
            status_code=500,
            detail="Missing dependency for JWT. Install: python-jose[cryptography]",
        )

    try:
        return jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            audience=JWT_AUD,
            issuer=JWT_ISS,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return _decode_token_or_401(creds.credentials)


def get_current_vendor(user: dict = Depends(get_current_user)) -> dict:
    role = str(user.get("role") or "")
    if role != "vendor":
        raise HTTPException(status_code=403, detail="Vendor role required")
    return user


def get_current_organizer(user: dict = Depends(get_current_user)) -> dict:
    role = str(user.get("role") or "")
    if role != "organizer":
        raise HTTPException(status_code=403, detail="Organizer role required")
    return user


# Minimal user object for dependency return values
class AuthUser:
    def __init__(self, id: int, role: str, vendor_id: Optional[int] = None):
        self.id = id
        self.role = role
        self.vendor_id = vendor_id


# Stub: current user (organizer by default)
def get_current_user() -> AuthUser:
    return AuthUser(id=1, role="organizer")


# Stub: require a role; returns a user with that role (and vendor_id for vendors)
def require_role(required: str):
    def dep() -> AuthUser:
        if required == "vendor":
            return AuthUser(id=2, role="vendor", vendor_id=1)
        return AuthUser(id=1, role="organizer")

    return dep
