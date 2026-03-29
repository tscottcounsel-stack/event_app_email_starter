from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from pathlib import Path
import shutil
import uuid

from app.routers.auth import get_current_user

router = APIRouter(prefix="/upload", tags=["Upload"])

UPLOAD_DIR = Path("/data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")

    filename = file.filename or "file"
    ext = filename.split(".")[-1].lower()

    allowed = {"jpg", "jpeg", "png", "webp"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Invalid file type")

    unique_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = UPLOAD_DIR / unique_name

    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save file")

    return {
        "ok": True,
        "url": f"/uploads/{unique_name}"
    }