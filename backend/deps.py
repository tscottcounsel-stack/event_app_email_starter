# backend/deps.py
from importlib import import_module

for _name in ["app.deps", "app.api.deps", "deps"]:
    try:
        _m = import_module(_name)
        if hasattr(_m, "get_db"):
            get_db = getattr(_m, "get_db")
        if hasattr(_m, "get_current_user"):
            get_current_user = getattr(_m, "get_current_user")
        if "get_db" in globals() or "get_current_user" in globals():
            break
    except Exception:
        pass
else:
    from fastapi import HTTPException, status

    from backend.config.database import SessionLocal

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def get_current_user(*args, **kwargs):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
