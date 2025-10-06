from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
import sqlalchemy as sa

from app.db import get_db
from app.auth_utils import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    role: str = "vendor"   # "vendor" | "organizer" | "admin"

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"

class LoginIn(BaseModel):
    email: EmailStr
    password: str

@router.post("/login", response_model=TokenOut)
def login(p: LoginIn, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
        SELECT id, password, role::text AS role
        FROM public.users
        WHERE email = :e
        LIMIT 1
    """), {"e": p.email}).mappings().first()

    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    stored = row["password"] or ""
    role   = row["role"]
    uid    = row["id"]

    from app.auth_utils import verify_password, hash_password

    ok = False
    looks_hashed = stored.startswith("$")  # works for bcrypt/argon2/passlib styles

    try:
        if looks_hashed:
            ok = verify_password(p.password, stored)
        else:
            # stored is plaintext or unknown format — try direct compare
            if p.password == stored:
                # upgrade to hash
                new_hash = hash_password(p.password)
                db.execute(sa.text(
                    "UPDATE public.users SET password = :h WHERE id = :id"
                ), {"h": new_hash, "id": uid})
                db.commit()
                ok = True
            else:
                # as a last try, in case it's a hash without a leading marker
                ok = verify_password(p.password, stored)
    except Exception:
        # If verify threw on odd formats, do one last plaintext compare
        ok = (p.password == stored)
        if ok and not looks_hashed:
            # upgrade to hash
            new_hash = hash_password(p.password)
            db.execute(sa.text(
                "UPDATE public.users SET password = :h WHERE id = :id"
            ), {"h": new_hash, "id": uid})
            db.commit()

    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    return TokenOut(access_token=create_access_token(str(uid), role))
