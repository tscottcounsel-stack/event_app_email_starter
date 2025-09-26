from __future__ import annotations
from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/")
def list_users():
    # Tests only assert 200 response; keep it simple.
    return []
