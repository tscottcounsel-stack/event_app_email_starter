# Event App Email Starter

![DB Migrations](https://github.com/tscottcounsel-stack/event-app-api/actions/workflows/db-migrations.yml/badge.svg)

## Setup
1. Python 3.11 recommended
2. Install deps:
   ```bash
   pip install -r requirements.txt

3. Copy `.env.example` to `.env` and update with your Gmail + App Password.
   - You must enable **2FA on your Gmail** and create an **App Password**.
4. Run the server:
   ```bash
   uvicorn main:app --reload
   ```
5. Visit API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Example Email Sending

POST `/send-email/` with JSON body:
```json
{
  "to_email": "friend@example.com",
  "subject": "Hello",
  "body": "This is a test email!"
}
```
# Event Organizer–Vendor API

A minimal FastAPI app used for vendor/event flows with simple in-memory storage and auth stubs.

## Quickstart

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt -r dev-requirements.txt
uvicorn main:app --reload


Enjoy!
