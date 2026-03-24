from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class EventCreate(BaseModel):
    name: str
    location: Optional[str] = None
    date: Optional[datetime] = None
    expected_attendance: Optional[int] = None


class EventUpdate(BaseModel):
    archived: Optional[bool] = None
    layout_published: Optional[bool] = None

    google_maps_url: Optional[str] = None
    organizer_name: Optional[str] = None
    organizer_email: Optional[str] = None
    organizer_phone: Optional[str] = None
    organizer_website: Optional[str] = None

    image_links: Optional[list[str]] = None
    video_links: Optional[list[str]] = None


class EventOut(BaseModel):
    id: int
    name: str

    location: Optional[str]
    date: Optional[datetime]
    expected_attendance: Optional[int]

    archived: bool
    layout_published: bool

    google_maps_url: Optional[str]
    organizer_name: Optional[str]
    organizer_email: Optional[str]
    organizer_phone: Optional[str]
    organizer_website: Optional[str]

    image_links: list[str] = []
    video_links: list[str] = []

    booth_count: int
    has_layout: bool

    class Config:
        orm_mode = True
