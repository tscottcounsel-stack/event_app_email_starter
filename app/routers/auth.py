from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

router = APIRouter()

_USERS: dict[int, dict] = {}
_USERS_BY_EMAIL: dict[str, int] = {}
_NEXT_ID = 1


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    email: str
    password: str
    role: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/register", status_code=200)
def register(payload: RegisterRequest):
    global _NEXT_ID
    uid = _USERS_BY_EMAIL.get(payload.email)
    if uid is None:
        uid = _NEXT_ID
        _NEXT_ID += 1
        user = {"id": uid, "email": payload.email, "role": payload.role or "vendor"}
        _USERS[uid] = user
        _USERS_BY_EMAIL[payload.email] = uid
    return _USERS[uid]


@router.post("/login", response_model=TokenResponse)
def login(payload: RegisterRequest):
    if payload.email not in _USERS_BY_EMAIL:
        register(payload)
    return TokenResponse(access_token="test-token")


@router.post("/refresh", response_model=TokenResponse)
def refresh():
    return TokenResponse(access_token="refreshed-token")
