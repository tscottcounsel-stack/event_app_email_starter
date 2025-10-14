@"
# Event Organizer–Vendor API

FastAPI app for organizer/vendor flows. Defaults to in-memory storage (fast tests). Optional SQLite persistence behind a flag.

## Quickstart
```bash
pip install -r requirements.txt -r dev-requirements.txt
uvicorn main:app --reload
