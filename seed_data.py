# seed_data.py
from database import SessionLocal, Base, engine
from models import User, UserRole, VendorProfile
from auth import hash_pw

# Ensure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Sample vendors
sample_vendors = [
    {
        "email": "catering@example.com",
        "password": "testpass",
        "role": UserRole.vendor,
        "profile": {
            "display_name": "Atlanta Catering",
            "company_name": "Atlanta Fine Foods",
            "phone": "404-111-2222",
            "location": "Atlanta, GA",
            "services": "catering,staffing",
            "categories": "food,beverage",
            "rate_min": 500,
            "rate_max": 5000,
            "bio": "We provide gourmet catering for weddings and corporate events.",
            "availability_notes": "Available all weekdays and weekends"
        },
    },
    {
        "email": "photography@example.com",
        "password": "testpass",
        "role": UserRole.vendor,
        "profile": {
            "display_name": "Peach State Photography",
            "company_name": "Peach State Photos LLC",
            "phone": "404-333-4444",
            "location": "Marietta, GA",
            "services": "photography,videography",
            "categories": "media,photo",
            "rate_min": 300,
            "rate_max": 2000,
            "bio": "Event and wedding photography with 10+ years experience.",
            "availability_notes": "Weekends preferred"
        },
    },
    {
        "email": "dj@example.com",
        "password": "testpass",
        "role": UserRole.vendor,
        "profile": {
            "display_name": "DJ Smooth",
            "company_name": "Smooth Entertainment",
            "phone": "404-555-6666",
            "location": "Atlanta, GA",
            "services": "dj,music",
            "categories": "music,entertainment",
            "rate_min": 200,
            "rate_max": 1500,
            "bio": "Professional DJ specializing in weddings and parties.",
            "availability_notes": "Evenings and weekends"
        },
    },
]

for vendor in sample_vendors:
    existing = db.query(User).filter(User.email == vendor["email"]).first()
    if existing:
        print(f"Skipping {vendor['email']} (already exists)")
        continue

    # Create user
    user = User(
        email=vendor["email"],
        hashed_password=hash_pw(vendor["password"]),
        role=vendor["role"],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Create vendor profile
    profile = VendorProfile(user_id=user.id, **vendor["profile"])
    db.add(profile)
    db.commit()

    print(f"Added vendor {vendor['profile']['display_name']} ({vendor['email']})")

db.close()
print("✅ Seeding complete!")

# Sample organizer
organizer_email = "organizer@example.com"
organizer_pw = "testpass"

existing_org = db.query(User).filter(User.email == organizer_email).first()
if not existing_org:
    organizer = User(
        email=organizer_email,
        hashed_password=hash_pw(organizer_pw),
        role=UserRole.organizer,
    )
    db.add(organizer)
    db.commit()
    db.refresh(organizer)

    org_profile = OrganizerProfile(
        user_id=organizer.id,
        display_name="Troy Organizer",
        organization_name="Event Masters",
        phone="404-777-8888",
        website="https://eventmasters.com",
        location="Atlanta, GA",
        preferred_categories="music,food",
        bio="We specialize in community and corporate events.",
    )
    db.add(org_profile)
    db.commit()

    print(f"✅ Added organizer {organizer_email} (password: {organizer_pw})")
else:
    print(f"Skipping organizer {organizer_email} (already exists)")


