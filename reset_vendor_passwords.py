from database import SessionLocal
from models import User
from auth import hash_pw

db = SessionLocal()

vendors = [
    "catering@example.com",
    "photography@example.com",
    "dj@example.com"
]

for email in vendors:
    vendor = db.query(User).filter(User.email == email).first()
    if vendor:
        vendor.hashed_password = hash_pw("testpass")
        db.commit()
        print(f"✅ Reset {email} password to 'testpass'")
    else:
        print(f"❌ Vendor {email} not found")

db.close()
