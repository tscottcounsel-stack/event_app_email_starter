from database import SessionLocal
from models import User
from auth import hash_pw

db = SessionLocal()

organizer = db.query(User).filter(User.email == "organizer@example.com").first()
if organizer:
    organizer.hashed_password = hash_pw("testpass")
    db.commit()
    print("✅ Organizer password reset to 'testpass'")
else:
    print("❌ Organizer not found")

db.close()
