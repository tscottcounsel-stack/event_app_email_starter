from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from jose import jwt
import os

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, stored: str) -> bool:
    # Works if stored is bcrypt; gracefully tolerates legacy plaintext
    try:
        return pwd_context.verify(plain, stored)
    except Exception:
        return plain == (stored or "")

def create_access_token(data: dict, secret: str, algorithm: str = "HS256", minutes: int = 60) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode(to_encode, secret, algorithm=algorithm)
