from main import app

for r in app.routes:
    methods = ",".join(sorted(getattr(r, "methods", []) or []))
    path = getattr(r, "path", "")
    print(f"{methods:15} {path}")
