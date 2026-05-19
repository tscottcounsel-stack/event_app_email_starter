from __future__ import annotations

import html
import os
import re
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

router = APIRouter(tags=["Contact"])

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ContactRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    email: str
    message: str
    company: Optional[str] = None
    reason: Optional[str] = None


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


def _validate_email(value: str) -> str:
    email = _clean(value).lower()
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    return email


def _send_resend_email(*, to_email: str, subject: str, html_body: str, text_body: str, reply_to: str) -> None:
    api_key = _clean(os.getenv("RESEND_API_KEY"))
    from_email = _clean(os.getenv("FROM_EMAIL")) or "VendCore Support <support@vendcore.co>"

    if not api_key:
        raise HTTPException(status_code=500, detail="Contact email is not configured.")

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
        "text": text_body,
        "reply_to": reply_to,
    }

    try:
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
    except requests.RequestException as exc:
        print(f"Contact email failed: {exc}")
        raise HTTPException(status_code=502, detail="Could not send your message right now.")

    if response.status_code >= 400:
        print(f"Contact email failed: {response.status_code} {response.text}")
        raise HTTPException(status_code=502, detail="Could not send your message right now.")


@router.post("/contact")
def send_contact_message(payload: ContactRequest):
    name = _clean(payload.name)
    email_address = _validate_email(payload.email)
    message = _clean(payload.message)
    company = _clean(payload.company)
    reason = _clean(payload.reason) or "General Support"

    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")

    to_email = _clean(os.getenv("CONTACT_TO_EMAIL")) or "support@vendcore.co"

    safe_name = html.escape(name)
    safe_email = html.escape(email_address)
    safe_company = html.escape(company or "Not provided")
    safe_reason = html.escape(reason)
    safe_message = html.escape(message).replace("\n", "<br />")

    subject = f"VendCore contact form: {reason}"
    html_body = f"""
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 680px; margin: 0 auto;">
      <h1 style="color: #111827;">New VendCore contact message</h1>
      <p><strong>Reason:</strong> {safe_reason}</p>
      <p><strong>Name:</strong> {safe_name}</p>
      <p><strong>Email:</strong> {safe_email}</p>
      <p><strong>Company / Organization:</strong> {safe_company}</p>
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p><strong>Message:</strong></p>
      <p>{safe_message}</p>
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="font-size: 13px; color: #6b7280;">Reply directly to this email to respond to {safe_name}.</p>
    </div>
    """

    text_body = (
        "New VendCore contact message\n\n"
        f"Reason: {reason}\n"
        f"Name: {name}\n"
        f"Email: {email_address}\n"
        f"Company / Organization: {company or 'Not provided'}\n\n"
        f"Message:\n{message}\n"
    )

    _send_resend_email(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        reply_to=email_address,
    )

    return {"ok": True, "message": "Message sent successfully."}
