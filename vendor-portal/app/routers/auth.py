from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password
from app.db import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Auth"])


# ---------------- LOGIN ----------------


@router.post("/login")
def login(payload: dict, db: Session = Depends(get_db)):
    email = payload.get("email")
    password = payload.get("password")
    requested_role = (payload.get("role") or "").lower()

    if not email or not password or not requested_role:
        raise HTTPException(status_code=400, detail="Missing login fields")

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # 🔥 Ensure role matches user
    if requested_role != user.role:
        raise HTTPException(status_code=403, detail="Role not allowed")

    # 🔥 TOKEN CLAIMS
    token_data = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,  # ⭐ CRITICAL FOR FRONTEND
        "is_active": user.is_active,
    }

    access_token = create_access_token(
        data=token_data,
        expires_delta=timedelta(hours=12),
    )

    return {"access_token": access_token, "token_type": "bearer", "role": user.role}


# ---------------- ME ----------------


@router.get("/me")
def get_me(current_user: User = Depends(...)):
    return current_user

