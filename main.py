# main.py
from __future__ import annotations

import os, time
from threading import Lock
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Dict

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.routers import slots
from app.routers import applications
from app.security import require_api_key

APP_NAME = os.environ.get("APP_NAME", "Event Organizer-Vendor API")
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")

_frontend = os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS: List[str] = [o.strip() for o in _frontend.split(",") if o.strip()]

# Rate limit config
RL_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "120"))
RL_BURST   = int(os.getenv("RATE_LIMIT_BURST", "200"))
RL_HEADER  = os.getenv("RATE_LIMIT_HEADER", "x-api-key").lower()
REDIS_URL  = os.getenv("REDIS_URL", "").strip()

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize shared state
    app.state.redis = None
    app.state.rl_buckets: Dict[str, Dict[str, float | int]] = {}
    app.state.rl_lock = Lock()

    # Try Redis first; fall back to in-memory
    if REDIS_URL:
        try:
            import redis.asyncio as redis  # pip install "redis>=5"
            app.state.redis = redis.from_url(
                REDIS_URL, encoding="utf-8", decode_responses=True
            )
            await app.state.redis.ping()
            print(f"[rate_limit] Using Redis at {REDIS_URL}")
        except Exception as e:
            print(f"[rate_limit] Redis unavailable ({e!r}); falling back to in-memory")

    yield

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Backend API for events, slots, and vendor applications.",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "x-api-key"],
    expose_headers=[
        "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After",
        "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after",
    ],
)

# ---- Single inline rate limit middleware (Redis-backed with in-memory fallback) ----
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Identify client by API key or IP
    api_key = request.headers.get(RL_HEADER)
    ident = f"api:{api_key}" if api_key else f"ip:{(request.client.host if request.client else 'unknown')}"

    now = time.time()
    window = int(now // 60)  # fixed window per minute
    limit = RL_PER_MIN
    burst = max(RL_BURST, limit)
    key = f"rl:{ident}:{window}"
    ttl = 60 - int(now - (window * 60)) or 1  # seconds until next window

    # Increment counter using Redis if available; else in-memory
    if app.state.redis:
        r = app.state.redis
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, ttl)
    else:
        with app.state.rl_lock:
            bucket = app.state.rl_buckets.get(key)
            if not bucket:
                bucket = {"count": 0, "exp": now + ttl}
                app.state.rl_buckets[key] = bucket
            count = int(bucket["count"]) + 1
            bucket["count"] = count
            # Opportunistic cleanup of expired windows
            dead = [k for k, v in app.state.rl_buckets.items() if v.get("exp", 0) < now]
            for k in dead:
                app.state.rl_buckets.pop(k, None)

    remaining = max(0, limit - count)
    allowed = (count <= limit) or (count <= burst)
    if not allowed:
        resp = JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Try again later."},
        )
        resp.headers["Retry-After"] = str(ttl)
        resp.headers["X-RateLimit-Limit"] = str(limit)
        resp.headers["X-RateLimit-Remaining"] = "0"
        resp.headers["x-ratelimit-limit"] = str(limit)
        resp.headers["x-ratelimit-remaining"] = "0"
        return resp

    response: Response = await call_next(request)
    try:
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["x-ratelimit-limit"] = str(limit)
        response.headers["x-ratelimit-remaining"] = str(remaining)
    except Exception:
        pass
    return response

# Meta
@app.get("/", tags=["meta"])
def root():
    return {"name": APP_NAME, "version": APP_VERSION, "time": datetime.now(timezone.utc).isoformat(), "docs": "/docs"}

@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}

@app.get("/version", tags=["meta"])
def version():
    return {"version": APP_VERSION}

# Feature routers (API key protected)
app.include_router(slots.router, dependencies=[Depends(require_api_key)])
app.include_router(applications.router, dependencies=[Depends(require_api_key)])

# Dev exception echo
import traceback
@app.exception_handler(Exception)
async def _echo_exc(request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error",
            "type": exc.__class__.__name__,
            "message": str(exc),
            "path": str(request.url.path),
            "trace": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).splitlines()[-10:],
        },
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8002")), reload=True)
