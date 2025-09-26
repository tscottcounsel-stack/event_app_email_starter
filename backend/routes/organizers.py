from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.models import models, schemas
from backend.config.database import get_db
from typing import List

router = APIRouter(prefix="/organizers", tags=["organizers"])

# ✅ Create organizer profile
@router.post("/", response_model=schemas.OrganizerProfileOut)
def create_organizer(
    organizer: schemas.OrganizerProfileCreate, 
    db: Session = Depends(get_db)
):
    db_organizer = models.OrganizerProfile(**organizer.model_dump(), user_id=1)  # 🔧 placeholder user_id
    db.add(db_organizer)
    db.commit()
    db.refresh(db_organizer)
    return db_organizer

# ✅ Get all organizers
@router.get("/", response_model=List[schemas.OrganizerProfileOut])
def get_all_organizers(db: Session = Depends(get_db)):
    return db.query(models.OrganizerProfile).all()

# ✅ Get one organizer by ID
@router.get("/{organizer_id}", response_model=schemas.OrganizerProfileOut)
def get_organizer(organizer_id: int, db: Session = Depends(get_db)):
    organizer = db.query(models.OrganizerProfile).filter(models.OrganizerProfile.id == organizer_id).first()
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return organizer

# ✅ Update organizer profile
@router.put("/{organizer_id}", response_model=schemas.OrganizerProfileOut)
def update_organizer(
    organizer_id: int,
    update_data: schemas.OrganizerProfileCreate,
    db: Session = Depends(get_db)
):
    organizer = db.query(models.OrganizerProfile).filter(models.OrganizerProfile.id == organizer_id).first()
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")

    for key, value in update_data.model_dump().items():
        setattr(organizer, key, value)

    db.commit()
    db.refresh(organizer)
    return organizer

# ✅ Delete organizer profile
@router.delete("/{organizer_id}")
def delete_organizer(organizer_id: int, db: Session = Depends(get_db)):
    organizer = db.query(models.OrganizerProfile).filter(models.OrganizerProfile.id == organizer_id).first()
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")
    
    db.delete(organizer)
    db.commit()
    return {"message": f"Organizer {organizer_id} deleted successfully"}
