# utils/email_utils.py
import smtplib, ssl, os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")

def send_email(to_email: str, subject: str, body: str, html: bool = False) -> tuple[bool, str | None]:
    """
    Sends an email via Gmail.
    - If html=False: send plain text
    - If html=True: send multipart/alternative (plain + HTML)
    Returns (True, None) on success; (False, 'error') on failure.
    """
    try:
        if not EMAIL_USER or not EMAIL_PASS:
            return False, "Missing EMAIL_USER or EMAIL_PASS"

        if html:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = EMAIL_USER
            msg["To"] = to_email

            # Plain fallback
            plain = MIMEText("Your email client does not support HTML.", "plain", "utf-8")
            rich = MIMEText(body, "html", "utf-8")
            msg.attach(plain)
            msg.attach(rich)
        else:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = EMAIL_USER
            msg["To"] = to_email

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(EMAIL_USER, EMAIL_PASS)
            server.sendmail(EMAIL_USER, [to_email], msg.as_string())

        print(f"✅ Email sent to {to_email}")
        return True, None
    except Exception as e:
        err = str(e)
        print("❌ Error sending email:", err)
        return False, err

def render_template(headline: str, message: str, button_text: str | None = None, button_url: str | None = None) -> str:
    """
    Very simple, inline-CSS HTML template (brand-neutral).
    """
    button_html = ""
    if button_text and button_url:
        button_html = f"""
        <div style="text-align:center;margin-top:24px;">
          <a href="{button_url}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;
             text-decoration:none;display:inline-block;font-weight:600;">{button_text}</a>
        </div>
        """

    return f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;">
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;
                 box-shadow:0 4px 18px rgba(0,0,0,0.06);overflow:hidden;">
            <tr>
              <td style="background:#111827;color:#fff;padding:18px 24px;font-family:Segoe UI,Arial,sans-serif;
                         font-size:18px;font-weight:700;">
                Event App
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 8px;font-family:Segoe UI,Arial,sans-serif;">
                <h2 style="margin:0 0 8px 0;color:#111827;font-size:22px;">{headline}</h2>
                <p style="margin:0;color:#374151;line-height:1.6;font-size:16px;">{message}</p>
                {button_html}
                <p style="margin-top:28px;color:#6b7280;font-size:12px;">
                  If you weren’t expecting this email, you can safely ignore it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f3f4f6;padding:14px 24px;color:#6b7280;font-size:12px;font-family:Segoe UI,Arial,sans-serif;">
                © {datetime_now()} Event App — All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    """

def datetime_now():
    from datetime import datetime
    return datetime.now().strftime("%Y")
