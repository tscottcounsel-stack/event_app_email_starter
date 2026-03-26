import os
from datetime import timedelta

# Keep secrets in env for prod; .env works in dev if you load it in main.py
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-prod")
JWT_ALG = "HS256"
ACCESS_EXPIRES = timedelta(hours=8)
