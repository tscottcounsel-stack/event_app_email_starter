from typing import Optional, Callable
from fastapi import Depends

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
