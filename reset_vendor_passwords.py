from auth import hash_pw
from database import SessionLocal
from models import User

db = SessionLocal()

vendors = ["catering@example.com", "photography@example.com", "dj@example.com"]

for email in vendors:
    vendor = db.query(User).filter(User.email == email).first()
    if vendor:
        vendor.hashed_password = hash_pw("testpass")
        db.commit()
        print(f"âœ… Reset {email} password to 'testpass'")
    else:
        print(f"âŒ Vendor {email} not found")

db.close()
