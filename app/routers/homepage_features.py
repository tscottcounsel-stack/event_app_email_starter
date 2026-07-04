from __future__ import annotations

import logging
import os
from typing import Any, Dict, Generator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["homepage-features"])

PRIVATE_PUBLIC_URL_MARKERS = (
    "verification-documents",
    "verification_documents",
    "verification_document",
    "identity_verification",
    "government_id",
    "certificate_of_insurance",
    "insurance_certificate",
    "business_license",
    "w9_document",
    "sales_tax_permit",
    "health_permit",
    "food_handler_permit",
    "legacy-profile-doc:",
    "view-url",
    "signed_url",
    "signedurl",
    "presigned",
    "x-amz-",
    "s3.amazonaws.com",
    "amazonaws.com/",
    "storage_key",
    "file_url",
    "fileurl",
)


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


def _safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_lower(value: Any) -> str:
    return _safe_str(value).lower()


def _require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if _safe_lower(user.get("role")) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _is_private_public_url(value: Any) -> bool:
    raw = _safe_str(value)
    if not raw:
        return False
    lowered = raw.lower()
    return any(marker in lowered for marker in PRIVATE_PUBLIC_URL_MARKERS)


def _public_image_url(value: Any) -> str:
    url = _safe_str(value)
    if not url:
        return ""

    lowered = url.lower()
    if not lowered.startswith(("https://", "http://")):
        return ""
    if lowered.startswith(("javascript:", "data:", "blob:")):
        return ""
    if _is_private_public_url(url):
        return ""
    if len(url) > 1500:
        return ""

    return url


def _public_profile_url(value: Any) -> str:
    url = _safe_str(value)
    if not url:
        return ""

    lowered = url.lower()
    if lowered.startswith(("javascript:", "data:", "blob:", "//")):
        return ""
    if _is_private_public_url(url):
        return ""
    if len(url) > 1500:
        return ""

    # Public profile URLs may be internal relative links such as /vendors/:id
    # or absolute URLs to VendCore profiles.
    if url.startswith("/"):
        return url
    if lowered.startswith(("https://", "http://")):
        return url

    return ""


def _sanitize_text(value: Any, max_len: int) -> str:
    return _safe_str(value)[:max_len]


def _sanitize_feature_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    clean = dict(data or {})
    if "image_url" in clean:
        clean["image_url"] = _public_image_url(clean.get("image_url"))
    if "imageUrl" in clean:
        clean["imageUrl"] = _public_image_url(clean.get("imageUrl"))
    if "profile_url" in clean:
        clean["profile_url"] = _public_profile_url(clean.get("profile_url"))
    if "profileUrl" in clean:
        clean["profileUrl"] = _public_profile_url(clean.get("profileUrl"))

    if "name" in clean:
        clean["name"] = _sanitize_text(clean.get("name"), 160)
    if "headline" in clean:
        clean["headline"] = _sanitize_text(clean.get("headline"), 300)
    if "category" in clean:
        clean["category"] = _sanitize_text(clean.get("category"), 120)
    if "location" in clean:
        clean["location"] = _sanitize_text(clean.get("location"), 160)

    return clean


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
    data = _sanitize_feature_payload(dict(row._mapping))
    image_url = _public_image_url(data.get("image_url"))
    profile_url = _public_profile_url(data.get("profile_url"))

    return HomepageFeatureOut(
        id=int(data["id"]),
        type=_sanitize_text(data.get("type"), 30),
        name=_sanitize_text(data.get("name"), 160),
        headline=_sanitize_text(data.get("headline"), 300) or None,
        category=_sanitize_text(data.get("category"), 120) or None,
        location=_sanitize_text(data.get("location"), 160) or None,
        image_url=image_url or None,
        imageUrl=image_url or None,
        profile_url=profile_url or None,
        profileUrl=profile_url or None,
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
def admin_list_homepage_features(
    db: Session = Depends(get_db),
    user: Dict[str, Any] = Depends(_require_admin),
):
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
def admin_create_homepage_feature(
    payload: HomepageFeatureCreate,
    db: Session = Depends(get_db),
    user: Dict[str, Any] = Depends(_require_admin),
):
    _ensure_table(db)
    clean_payload = _sanitize_feature_payload(payload.model_dump())

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
        clean_payload,
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
    user: Dict[str, Any] = Depends(_require_admin),
):
    _ensure_table(db)
    updates = _sanitize_feature_payload(payload.model_dump(exclude_unset=True))

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

    allowed_update_keys = {
        "type",
        "name",
        "headline",
        "category",
        "location",
        "image_url",
        "profile_url",
        "verified",
        "is_active",
        "display_order",
    }
    updates = {key: value for key, value in updates.items() if key in allowed_update_keys}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

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
def admin_delete_homepage_feature(
    feature_id: int,
    db: Session = Depends(get_db),
    user: Dict[str, Any] = Depends(_require_admin),
):
    _ensure_table(db)
    result = db.execute(
        text("DELETE FROM homepage_features WHERE id = :feature_id"),
        {"feature_id": feature_id},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Homepage feature not found")

    return {"ok": True}
