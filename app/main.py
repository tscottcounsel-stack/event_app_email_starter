# app/main.py
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import (
    applications,
    auth,
    booths,
    diagrams,
    events,
    layout,
    requirements,
    requirements_alias,
    seed,
    slots,
    stats,
    templates,
    users,
    vendors,
    vendors_v2,
)

# ❌ DO NOT import:
# organizer_applications
# organizer_diagram


def create_app() -> FastAPI:
    app = FastAPI(title="VendorConnect API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -------------------------------------------------------------------
    # Uploads (static file hosting)
    # Files are saved to: app/uploads/
    # Served at: http://127.0.0.1:8002/uploads/<filename>
    # -------------------------------------------------------------------
    upload_dir = Path(__file__).resolve().parent / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")

    @app.get("/health", tags=["Health"])
    def health():
        return {"status": "ok"}

    # ✅ Mount JSON-based routers only
    app.include_router(auth.router)
    app.include_router(events.router)
    app.include_router(vendors.router)
    app.include_router(vendors_v2.router)
    app.include_router(applications.router)
    app.include_router(diagrams.router)
    app.include_router(templates.router)
    app.include_router(booths.router)
    app.include_router(layout.router)
    app.include_router(requirements.router)
    app.include_router(requirements_alias.router)
    app.include_router(users.router)
    app.include_router(stats.router)
    app.include_router(slots.router)
    app.include_router(seed.router)

    # -------------------------------------------------------------------
    # Stripe Webhook (basic plumbing)
    # -------------------------------------------------------------------
    @app.post("/stripe/webhook", tags=["Stripe"])
    async def stripe_webhook(
        request: Request,
        stripe_signature: str = Header(default="", alias="Stripe-Signature"),
    ):
        try:
            import stripe  # type: ignore
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Stripe SDK not installed. Run: pip install stripe",
            )

        secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        if not secret:
            raise HTTPException(
                status_code=500,
                detail="Missing STRIPE_WEBHOOK_SECRET env var",
            )

        payload = await request.body()

        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=stripe_signature,
                secret=secret,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Webhook signature error: {e}")

        # We only need checkout.session.completed for basic checkout
        if event.get("type") == "checkout.session.completed":
            session = (event.get("data") or {}).get("object") or {}
            metadata = session.get("metadata") or {}

            app_id = metadata.get("application_id")
            if app_id is None:
                return {
                    "ok": True,
                    "ignored": True,
                    "reason": "missing metadata.application_id",
                }

            try:
                app_id_int = int(app_id)
            except Exception:
                return {"ok": True, "ignored": True, "reason": "bad application_id"}

            # Update dev store
            from app.store import (  # local import to avoid cycles
                _APPLICATIONS,
                save_store,
            )

            app = _APPLICATIONS.get(app_id_int)
            if app:
                app["payment_status"] = "paid"
                app["stripe_checkout_session_id"] = session.get("id")
                if session.get("payment_intent"):
                    app["stripe_payment_intent_id"] = session.get("payment_intent")
                app["paid_at"] = session.get("created")
                app["updated_at"] = datetime_now_iso()
                save_store()

        return {"ok": True}

    return app


def datetime_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


app = create_app()
