from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db

router = APIRouter(prefix="/applications", tags=["applications"])


_APPLICATIONS: Dict[int, Dict[str, Any]] = {}
_NEXT_ID: int = 1


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: Optional[int] = None
    vendor_id: Optional[int] = None
    price_cents: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None


class ApplicationPatch(BaseModel):
    model_config = ConfigDict(extra="allow")
    event_id: Optional[int] = None
    vendor_id: Optional[int] = None
    price_cents: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None
    status: Optional[str] = None


@router.get("/diag/ping")
def applications_diag_ping():
    return {"ping": "pong"}


@router.get("")
def list_applications(
    event_id: Optional[int] = Query(None), vendor_id: Optional[int] = Query(None)
):
    items = list(_APPLICATIONS.values())
    if event_id is not None:
        items = [a for a in items if a.get("event_id") == event_id]
    if vendor_id is not None:
        items = [a for a in items if a.get("vendor_id") == vendor_id]
    return items


@router.post(
    "",  # or "/"
    response_model=schemas.ApplicationOut,  # whatever your output schema is
    status_code=status.HTTP_201_CREATED,  # <-- key line
)
def create_application(
    payload: schemas.ApplicationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_vendor),
):
    # ... create the application ...
    app_obj = models.Application(
        vendor_id=current_user.id,
        event_id=payload.event_id,
        slot_id=payload.slot_id,
        price_cents=payload.price_cents,
        notes=payload.notes,
    )
    db.add(app_obj)
    db.commit()
    db.refresh(app_obj)
    return app_obj


def _get_or_404(application_id: int) -> Dict[str, Any]:
    app = _APPLICATIONS.get(application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.get("/id/{application_id:int}")
def get_application(application_id: int):
    return _get_or_404(application_id)


@router.patch("/id/{application_id:int}")
def update_application(application_id: int, patch: ApplicationPatch):
    app = _get_or_404(application_id)
    updates = {k: v for k, v in patch.__dict__.items() if v is not None}
    app.update(updates)
    return app


@router.get("/{application_id}")
def get_application_alias(application_id: int):
    return get_application(application_id)


@router.patch("/{application_id:int}")
def update_application_alias(application_id: int, patch: ApplicationPatch):
    return update_application(application_id, patch)
