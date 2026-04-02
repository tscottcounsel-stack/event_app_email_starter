from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/upload", tags=["upload"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/data/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _save_upload(file: UploadFile) -> dict:
    original_name = file.filename or "upload.bin"
    file_ext = Path(original_name).suffix
    file_name = f"{uuid.uuid4()}{file_ext}"
    file_path = UPLOAD_DIR / file_name

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "success": True,
        "filename": file_name,
        "url": f"/uploads/{file_name}",
    }


@router.post("")
@router.post("/")
@router.post("/image")
async def upload_file(file: UploadFile = File(...)):
    try:
        return _save_upload(file)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
            },
        )