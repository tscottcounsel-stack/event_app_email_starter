# Event App Email Starter

This is a simple FastAPI project with Gmail email-sending support.

## Setup

1. Install Python (>=3.9 recommended)
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
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

Enjoy!
