import logging
import os
from typing import Any, Generator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["homepage-features"])


class HomepageFeatureOut(BaseModel):
    id: int
    type: str
    name: str
    headline: str | None = None
    category: str | None = None
    location: str | None = None
    image_url: str | None = None
    imageUrl: str | None = None
    profile_url: str | None = None
    profileUrl: str | None = None
    verified: bool = False
    is_active: bool = True
    display_order: int = 0


class HomepageFeatureCreate(BaseModel):
    type: str = Field(..., pattern="^(vendor|organizer)$")
    name: str
    headline: str | None = None
    category: str | None = None
    location: str | None = None
    image_url: str | None = None
    profile_url: str | None = None
    verified: bool = False
    is_active: bool = True
    display_order: int = 0


class HomepageFeatureUpdate(BaseModel):
    type: str | None = Field(None, pattern="^(vendor|organizer)$")
    name: str | None = None
    headline: str | None = None
    category: str | None = None
    location: str | None = None
    image_url: str | None = None
    profile_url: str | None = None
    verified: bool | None = None
    is_active: bool | None = None
    display_order: int | None = None


_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return url


def _get_engine() -> Engine:
    global _engine, _SessionLocal

    if _engine is not None:
        return _engine

    try:
        from app.db import engine as app_engine  # type: ignore

        _engine = app_engine
    except Exception:
        _engine = create_engine(_database_url(), pool_pre_ping=True)

    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine


def get_db() -> Generator[Session, None, None]:
    _get_engine()

    if _SessionLocal is None:
        raise RuntimeError("Database session is unavailable")

    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS homepage_features (
                id SERIAL PRIMARY KEY,
                type VARCHAR(30) NOT NULL CHECK (type IN ('vendor', 'organizer')),
                name VARCHAR(255) NOT NULL,
                headline VARCHAR(500),
                category VARCHAR(255),
                location VARCHAR(255),
                image_url TEXT,
                profile_url TEXT,
                verified BOOLEAN NOT NULL DEFAULT FALSE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
    )
    db.commit()


def _row_to_feature(row: Any) -> HomepageFeatureOut:
    data = dict(row._mapping)
    image_url = data.get("image_url")
    profile_url = data.get("profile_url")

    return HomepageFeatureOut(
        id=data["id"],
        type=data["type"],
        name=data["name"],
        headline=data.get("headline"),
        category=data.get("category"),
        location=data.get("location"),
        image_url=image_url,
        imageUrl=image_url,
        profile_url=profile_url,
        profileUrl=profile_url,
        verified=bool(data.get("verified")),
        is_active=bool(data.get("is_active")),
        display_order=int(data.get("display_order") or 0),
    )


def _public_features(db: Session) -> list[HomepageFeatureOut]:
    _ensure_table(db)
    rows = db.execute(
        text(
            """
            SELECT
                id,
                type,
                name,
                headline,
                category,
                location,
                image_url,
                profile_url,
                verified,
                is_active,
                display_order
            FROM homepage_features
            WHERE is_active = TRUE
            ORDER BY display_order ASC, id ASC
            LIMIT 12
            """
        )
    ).fetchall()
    return [_row_to_feature(row) for row in rows]


@router.get("/api/public/featured-homepage")
def get_featured_homepage(db: Session = Depends(get_db)):
    return {"items": _public_features(db)}


@router.get("/public/homepage-features", response_model=list[HomepageFeatureOut])
def get_homepage_features(db: Session = Depends(get_db)):
    return _public_features(db)


@router.get("/api/admin/homepage-features", response_model=list[HomepageFeatureOut])
def admin_list_homepage_features(db: Session = Depends(get_db)):
    _ensure_table(db)
    rows = db.execute(
        text(
            """
            SELECT
                id,
                type,
                name,
                headline,
                category,
                location,
                image_url,
                profile_url,
                verified,
                is_active,
                display_order
            FROM homepage_features
            ORDER BY display_order ASC, id ASC
            """
        )
    ).fetchall()
    return [_row_to_feature(row) for row in rows]


@router.post("/api/admin/homepage-features", response_model=HomepageFeatureOut)
def admin_create_homepage_feature(payload: HomepageFeatureCreate, db: Session = Depends(get_db)):
    _ensure_table(db)
    row = db.execute(
        text(
            """
            INSERT INTO homepage_features (
                type,
                name,
                headline,
                category,
                location,
                image_url,
                profile_url,
                verified,
                is_active,
                display_order,
                updated_at
            )
            VALUES (
                :type,
                :name,
                :headline,
                :category,
                :location,
                :image_url,
                :profile_url,
                :verified,
                :is_active,
                :display_order,
                NOW()
            )
            RETURNING
                id,
                type,
                name,
                headline,
                category,
                location,
                image_url,
                profile_url,
                verified,
                is_active,
                display_order
            """
        ),
        payload.model_dump(),
    ).fetchone()
    db.commit()

    if row is None:
        raise HTTPException(status_code=500, detail="Could not create homepage feature")

    return _row_to_feature(row)


@router.patch("/api/admin/homepage-features/{feature_id}", response_model=HomepageFeatureOut)
def admin_update_homepage_feature(
    feature_id: int,
    payload: HomepageFeatureUpdate,
    db: Session = Depends(get_db),
):
    _ensure_table(db)
    updates = payload.model_dump(exclude_unset=True)

    if not updates:
        row = db.execute(
            text(
                """
                SELECT
                    id,
                    type,
                    name,
                    headline,
                    category,
                    location,
                    image_url,
                    profile_url,
                    verified,
                    is_active,
                    display_order
                FROM homepage_features
                WHERE id = :feature_id
                """
            ),
            {"feature_id": feature_id},
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Homepage feature not found")
        return _row_to_feature(row)

    set_clause = ", ".join([f"{key} = :{key}" for key in updates.keys()])
    updates["feature_id"] = feature_id

    row = db.execute(
        text(
            f"""
            UPDATE homepage_features
            SET {set_clause}, updated_at = NOW()
            WHERE id = :feature_id
            RETURNING
                id,
                type,
                name,
                headline,
                category,
                location,
                image_url,
                profile_url,
                verified,
                is_active,
                display_order
            """
        ),
        updates,
    ).fetchone()
    db.commit()

    if row is None:
        raise HTTPException(status_code=404, detail="Homepage feature not found")

    return _row_to_feature(row)


@router.delete("/api/admin/homepage-features/{feature_id}")
def admin_delete_homepage_feature(feature_id: int, db: Session = Depends(get_db)):
    _ensure_table(db)
    result = db.execute(
        text("DELETE FROM homepage_features WHERE id = :feature_id"),
        {"feature_id": feature_id},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Homepage feature not found")

    return {"ok": True}
