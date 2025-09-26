# backend/app.py
from fastapi import FastAPI
from fastapi.routing import APIRoute

# Import routers
from backend.routes import users, events, vendors, organizers, applications, auth

# Create FastAPI app
app = FastAPI(
    title="Event Organizer-Vendor App",
    description="API backend for managing users, events, vendors, organizers, and applications",
    version="0.2.0"
)

# Register routers
app.include_router(users.router)
app.include_router(events.router)
app.include_router(vendors.router)
app.include_router(organizers.router)
app.include_router(applications.router)
app.include_router(auth.router)  # ✅ make sure auth is mounted

# Root endpoint
@app.get("/")
def root():
    return {"message": "Welcome to the Event Organizer-Vendor App API 🚀"}

# Debug print of routes (helps confirm in logs)
print("=== FINAL ROUTES ===")
for route in app.routes:
    if isinstance(route, APIRoute):
        print(route.path, route.methods)
