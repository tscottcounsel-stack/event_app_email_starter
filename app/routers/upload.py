from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from app.routers.auth import get_current_user

router = APIRouter(prefix="/upload", tags=["Upload"])

UPLOAD_DIR = Path("/data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    ext = Path(file.filename).suffix.lower()

    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Invalid file type")

    # 🔥 PURE UUID (NO PREFIX)
    unique_name = f"{uuid.uuid4().hex}{ext}"

    file_path = UPLOAD_DIR / unique_name

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "ok": True,
        "url": f"/uploads/{unique_name}",
    }
return {
    "ok": True,
    "marker": "UPLOAD_ROUTE_TEST_123",
    "url": f"/uploads/{unique_name}",
}