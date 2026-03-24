# app/rate_limit.py
from __future__ import annotations

import os
import threading
import time
from typing import Dict

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "120"))
RATE_LIMIT_BURST = int(os.getenv("RATE_LIMIT_BURST", "200"))
RATE_LIMIT_HEADER = os.getenv("RATE_LIMIT_HEADER", "x-api-key").lower()

print("[rate_limit] module imported")


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._state: Dict[str, Dict[str, float | int]] = {}
        self._lock = threading.Lock()
        print("[rate_limit] RateLimitMiddleware __init__ called")

    def _key_for(self, request: Request) -> str:
        api_key = request.headers.get(RATE_LIMIT_HEADER)
        if api_key:
            return f"api:{api_key}"
        ip = request.client.host if request.client else "unknown"
        return f"ip:{ip}"

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # PROOF the middleware is running:
        # we'll always add X-RL-MW: on to responses.
        now = time.time()
        key = self._key_for(request)

        with self._lock:
            b = self._state.get(key)
            if not b:
                b = {"window_start": now, "count": 0}
                self._state[key] = b

            window_start = float(b["window_start"])
            count = int(b["count"])

            if now - window_start >= 60.0:
                window_start, count = now, 0

            limit = RATE_LIMIT_PER_MIN
            burst = max(RATE_LIMIT_BURST, limit)
            allowed = count < limit or count < burst

            if not allowed:
                resp = JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Try again later."},
                )
                resp.headers["Retry-After"] = str(max(1, 60 - int(now - window_start)))
                resp.headers["X-RateLimit-Limit"] = str(limit)
                resp.headers["X-RateLimit-Remaining"] = "0"
                resp.headers["X-RL-MW"] = "on"
                return resp

            count += 1
            b["window_start"] = window_start
            b["count"] = count
            remaining = max(0, limit - count)

        resp = await call_next(request)
        # Always tag the response so we can see it from clients
        try:
            resp.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_PER_MIN)
            resp.headers["X-RateLimit-Remaining"] = str(remaining)
            resp.headers["X-RL-MW"] = "on"
        except Exception:
            pass
        return resp
