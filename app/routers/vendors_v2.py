from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session
import sqlalchemy as sa
from app.db import get_db
from app.deps import role_required

router = APIRouter(prefix="/vendors2", tags=["vendors"])  # <- vendors2

try:
    from pydantic import ConfigDict
    class VendorCreateV2(BaseModel):
        model_config = ConfigDict(extra="ignore", title="VendorCreateV2")
        name: str
        category: str | None = None
        phone: str | None = None
        description: str | None = None
        user_id: int | None = None  # optional/ignored
except Exception:
    class VendorCreateV2(BaseModel):
        class Config:
            extra = "ignore"
            title = "VendorCreateV2"
        name: str
        category: str | None = None
        phone: str | None = None
        description: str | None = None
        user_id: int | None = None

@router.post("", status_code=201, dependencies=[Depends(role_required("organizer","admin"))])
def create_vendor(p: VendorCreateV2, db: Session = Depends(get_db)):
    row = db.execute(sa.text("""
        INSERT INTO public.vendors (name, category, phone, description)
        VALUES (:name, :category, :phone, :description)
        RETURNING id
    """), {"name": p.name, "category": p.category, "phone": p.phone, "description": p.description}).fetchone()
    db.commit()
    return {"id": row.id}

@router.get("/_ping")
def vendors2_ping():
    return {"ok": True}