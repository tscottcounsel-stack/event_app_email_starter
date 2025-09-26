from backend.deps import get_current_user
from fastapi import APIRouter, Depends
from core.deps import get_current_user  # <<< add this import

from fastapi import APIRouter

router = APIRouter(prefix="/organizers", tags=["organizers"])

@router.get("/me/profile", summary="Organizer profile (stub)")
def my_profile():
    return {"id": 1, "email": "organizer@example.com", "name": "Demo Organizer"}

