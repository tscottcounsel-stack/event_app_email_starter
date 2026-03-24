from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Review

router = APIRouter(tags=["Reviews"])


def _normalize_rating(value: float) -> float:
    rating = float(value)
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5.")
    return round(rating, 1)


@router.post("/reviews")
def create_review(
    vendor_id: int,
    rating: float,
    comment: str = "",
    event_id: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    rating = _normalize_rating(rating)
    clean_comment = comment.strip()

    review = Review(
        vendor_id=vendor_id,
        reviewer_id=current_user.id,
        rating=rating,
        comment=clean_comment,
        event_id=event_id,
    )

    db.add(review)
    db.commit()
    db.refresh(review)

    return {"success": True, "review": review}


@router.get("/vendors/{vendor_id}/reviews")
def get_vendor_reviews(vendor_id: int, db: Session = Depends(get_db)):
    reviews = (
        db.query(Review)
        .filter(Review.vendor_id == vendor_id)
        .order_by(Review.created_at.desc())
        .all()
    )

    avg = (
        db.query(func.avg(Review.rating)).filter(Review.vendor_id == vendor_id).scalar()
        or 0
    )

    return {
        "reviews": reviews,
        "rating": round(float(avg), 2) if avg else 0,
        "review_count": len(reviews),
    }
