# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import slots
import os

app = FastAPI(title="Event Organizer API", version="1.0.0")

# CORS (tweak origins as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health / Version / Root
@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}

@app.get("/version", tags=["health"])
def version():
    return {
        "version": app.version,
        "git_sha": os.environ.get("GIT_SHA"),
        "environment": os.environ.get("ENV", "dev"),
    }

@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "service": "event-organizer-api"}

# Routers
app.include_router(slots.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", reload=True)
