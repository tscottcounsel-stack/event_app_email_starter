from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    func,
    Enum,
    Float,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import relationship
from database import Base
import enum

# ---- User Roles ----
class UserRole(str, enum.Enum):
    vendor = "vendor"
    organizer = "organizer"

# ---- Users ----
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.vendor)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    vendor_profile = relationship("VendorProfile", back_populates="user", uselist=False)
    organizer_profile = relationship("OrganizerProfile", back_populates="user", uselist=False)

# ---- Vendor Profile ----
class VendorProfile(Base):
    __tablename__ = "vendor_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    display_name = Column(String, nullable=False)
    company_name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    location = Column(String, nullable=True)

    services = Column(String, nullable=True)       # comma-separated
    categories = Column(String, nullable=True)     # comma-separated
    rate_min = Column(Float, nullable=True)
    rate_max = Column(Float, nullable=True)
    bio = Column(Text, nullable=True)
    availability_notes = Column(Text, nullable=True)

    user = relationship("User", back_populates="vendor_profile")

# ---- Organizer Profile ----
class OrganizerProfile(Base):
    __tablename__ = "organizer_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    organization_name = Column(String, nullable=True)
    display_name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    website = Column(String, nullable=True)
    location = Column(String, nullable=True)
    preferred_categories = Column(String, nullable=True)
    bio = Column(Text, nullable=True)

    user = relationship("User", back_populates="organizer_profile")

# ---- Events ----
class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    organizer_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    date = Column(DateTime, nullable=False)
    location = Column(String, nullable=False)

    diagram_url = Column(String, nullable=True)   # uploaded diagram (optional)
    layout_json = Column(Text, nullable=True)     # JSON grid/slots (optional)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    organizer = relationship("User")

# ---- Event Applications ----
class EventApplication(Base):
    __tablename__ = "event_applications"
    id = Column(Integer, primary_key=True, index=True)

    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    status = Column(String, default="pending")  # pending, approved, declined
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    event = relationship("Event")
    vendor = relationship("User")
