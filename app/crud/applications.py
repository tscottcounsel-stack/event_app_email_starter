from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.event import Event
from app.models.vendor import Vendor
from app.schemas.application import ApplicationCreate


def create_application(
    db: Session, vendor_id: int, payload: ApplicationCreate
) -> Application:
    ev = db.query(Event).filter(Event.id == payload.event_id).first()
    if not ev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    v = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not v:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vendor profile required before applying",
        )

    existing = (
        db.query(Application)
        .filter(
            Application.event_id == payload.event_id, Application.vendor_id == vendor_id
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Application already exists"
        )

    app = Application(
        event_id=payload.event_id,
        vendor_id=vendor_id,
        note=payload.note,
        price_cents=payload.price_cents,
        status="submitted",
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def list_by_event(db: Session, event_id: int) -> List[Application]:
    return (
        db.query(Application)
        .filter(Application.event_id == event_id)
        .order_by(Application.created_at.asc())
        .all()
    )


def get_by_id(db: Session, app_id: int) -> Application | None:
    return db.query(Application).filter(Application.id == app_id).first()


def set_status(db: Session, app_id: int, status: str):
    app = get_by_id(db, app_id)
    if not app:
        from fastapi import HTTPException

        raise HTTPException(404, "Application not found")
    app.status = status
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def update_vendor_fields(db: Session, app: Application, body) -> Application:
    if getattr(body, "note", None) is not None:
        app.note = body.note
    if getattr(body, "price_cents", None) is not None:
        app.price_cents = body.price_cents
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


@router.patch("/{app_id}", response_model=ApplicationRead)
def vendor_update_app(
    app_id: int,
    body: ApplicationVendorUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("vendor")),
):
    app = get_by_id(db, app_id)
    if not app:
        raise HTTPException(404, "Application not found")
    if app.vendor_id != getattr(user, "vendor_id", None):
        raise HTTPException(403, "Forbidden")
    if app.status != "submitted":
        raise HTTPException(409, "Cannot edit after review started")
    return update_vendor_fields(db, app, body)


def update_vendor_fields(db: Session, app: Application, body):
    if body.note is not None:
        app.note = body.note
    if body.price_cents is not None:
        app.price_cents = body.price_cents
    db.add(app)
    db.commit()
    db.refresh(app)
    return app
