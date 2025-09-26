from __future__ import annotations
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["health"])

@router.get("/")
def root():
    return {"message": "ok"}  # tests check for key "message"

@router.get("/ping", response_class=PlainTextResponse)
def ping():
    return "pong"  # tests look for substring "pong"
