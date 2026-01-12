# app/auth.py
#
# Minimal auth stubs JUST for the vendor/organizer profile APIs.
# They pretend you're always logged in as a known dev user so that
# we can satisfy the users(id) foreign key constraints.

from typing import Optional

# ✅ MISSING IMPORTS (this is what was breaking router loading)
from fastapi import Depends, HTTPException, status


class AuthUser:
    def __init__(self, id: int, role: str, vendor_id: Optional[int] = None):
        self.id = id
        self.role = role
        self.vendor_id = vendor_id


def get_current_user() -> AuthUser:
    """
    Default "current user" – organizer.
    This should match an actual row in the `users` table.
    We’re using organizer@example.com -> id=13.
    """
    return AuthUser(id=13, role="organizer")


def require_role(required: str):
    """
    Dependency factory that returns a fake user with the given role.
    We point at real seeded users so FK(user_id -> users.id) succeeds.
    """

    def dep() -> AuthUser:
        if required == "vendor":
            # pytest_vendor@example.com -> id=5 (role = 'vendor')
            return AuthUser(id=5, role="vendor", vendor_id=1)

        # Fallback: organizer
        return AuthUser(id=13, role="organizer")

    return dep


# ✅ Organizer-only dependency used by organizer routers
def require_organizer(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if getattr(user, "role", None) != "organizer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer access required",
        )
    return user
