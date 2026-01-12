# app/routers/public_vendor_categories.py
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

router = APIRouter(
    prefix="/public",
    tags=["public-vendor-categories"],
)


class PublicVendorCategory(BaseModel):
    """
    Public shape for vendor categories used by the frontend.

    NOTE: We only require id, slug, and name here. The slug is
    synthesized from the DB name; it does *not* require a DB column.
    """

    id: int
    slug: str
    name: str

    class Config:
        orm_mode = True


def _slugify(name: str) -> str:
    """
    Very small, safe slug generator so we don't need a DB column.
    """
    s = (name or "").strip().lower()
    for ch in ["&", "/", "\\"]:
        s = s.replace(ch, " ")
    parts = [p for p in s.replace("_", " ").split(" ") if p]
    return "-".join(parts) or "category"


@router.get(
    "/vendor-categories",
    response_model=List[PublicVendorCategory],
    status_code=status.HTTP_200_OK,
)
def list_public_vendor_categories(
    db: Session = Depends(get_db),
) -> List[PublicVendorCategory]:
    """
    Read-only list of vendor categories for UI (map editor ribbons, filters, etc).

    - No auth required.
    - Uses the existing vendor_categories table.
    - Does *not* assume any columns beyond (id, name).
    """
    VendorCategory = getattr(models, "VendorCategory", None)
    if VendorCategory is None:
        # Defensive guard so startup failures are obvious.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="VendorCategory model is not available on the server.",
        )

    rows = db.query(VendorCategory).order_by(VendorCategory.name.asc()).all()

    return [
        PublicVendorCategory(
            id=row.id,
            name=row.name,
            slug=_slugify(row.name),
        )
        for row in rows
    ]
