import os
from datetime import datetime, timedelta

# auth.py
from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from passlib.context import CryptContext
from pydantic import EmailStr
from sqlalchemy.orm import Session

from backend.deps import current_user, get_current_user
from database import Base, engine, get_db
from models import User, UserRole
from schemas import LoginRequest, Token, UserCreate, UserOut  # ? import LoginRequest

# Create tables (SQLite file: app.db) on import
Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/auth", tags=["Auth"])

# ---- Security config ----
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET = os.getenv("JWT_SECRET", "change_me")  # set in .env
JWT_ALGO = "HS256"
JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", "60"))


def hash_pw(pw: str) -> str:
    return pwd_context.hash(pw)


def verify_pw(pw: str, hashed: str) -> bool:
    return pwd_context.verify(pw, hashed)


def create_token(user: User) -> str:
    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRES_MIN)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "exp": exp,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


# ---- Token extraction ----
security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    raw = None
    if (
        credentials
        and credentials.scheme.lower() == "bearer"
        and credentials.credentials
    ):
        raw = credentials.credentials.strip()
    if not raw and token:
        raw = token.strip()
    if not raw:
        raise HTTPException(
            status_code=401, detail="Missing authorization header or token"
        )

    try:
        data = jwt.decode(raw, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = int(data["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---- Register ----
@router.post("/register", response_model=UserOut)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=str(payload.email),
        hashed_password=hash_pw(payload.password),
        role=UserRole(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---- Login ----
@router.post("/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == str(payload.email)).first()
    if not user or not verify_pw(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user)
    return Token(access_token=token)


# ---- Me ----
@router.get("/me", response_model=UserOut)
def me(current: User = Depends(current_user)):
    return current
