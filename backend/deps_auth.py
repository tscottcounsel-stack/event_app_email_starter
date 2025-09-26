from backend.deps import get_current_user

from backend.deps import current_user
from backend.deps import get_current_user
from fastapi import Depends, HTTPException, status
from .security.jwt import get_current_user  # uses your existing /auth flow
from .models import User

def require_role(*roles: str):
    def _dep(user: User = Depends(current_user)) -> User:
        if roles and user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: insufficient role"
            )
        return user
    return _dep


