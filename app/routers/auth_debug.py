# app/routers/auth_debug.py

from fastapi import APIRouter, Depends

# These come from your real auth helpers module,
# which defines AuthUser + get_current_user.
from app.auth import AuthUser, get_current_user

router = APIRouter(prefix="/auth_debug", tags=["auth_debug"])


@router.get("/whoami")
def who_am_i(current_user: AuthUser = Depends(get_current_user)):
    """
    Return the decoded JWT user payload from the current request.

    This relies entirely on AuthUser / get_current_user and does
    NOT touch the database directly.
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
    }
