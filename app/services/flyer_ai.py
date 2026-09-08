# app/services/flyer_ai.py
from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any

from openai import OpenAI


MODEL = os.getenv("OPENAI_FLYER_MODEL", "gpt-5.6-luna")

EVENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "event_kind": {
            "type": ["string", "null"],
            "enum": ["marketplace", "private_service", "live_entertainment", "custom", None],
        },
        "custom_event_kind": {"type": ["string", "null"]},
        "title": {"type": ["string", "null"]},
        "description": {"type": ["string", "null"]},
        "host_name": {"type": ["string", "null"]},
        "venue_name": {"type": ["string", "null"]},
        "street_address": {"type": ["string", "null"]},
        "city": {"type": ["string", "null"]},
        "state": {"type": ["string", "null"]},
        "start_date": {"type": ["string", "null"]},
        "start_time": {"type": ["string", "null"]},
        "end_date": {"type": ["string", "null"]},
        "end_time": {"type": ["string", "null"]},
        "website_url": {"type": ["string", "null"]},
        "ticket_sales_url": {"type": ["string", "null"]},
        "instagram_url": {"type": ["string", "null"]},
        "facebook_url": {"type": ["string", "null"]},
        "tiktok_url": {"type": ["string", "null"]},
        "desired_vendor_categories": {
            "type": "array",
            "items": {"type": "string"},
        },
        "confidence": {
            "type": "object",
            "additionalProperties": {"type": "number"},
        },
        "needs_review": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "event_kind",
        "custom_event_kind",
        "title",
        "description",
        "host_name",
        "venue_name",
        "street_address",
        "city",
        "state",
        "start_date",
        "start_time",
        "end_date",
        "end_time",
        "website_url",
        "ticket_sales_url",
        "instagram_url",
        "facebook_url",
        "tiktok_url",
        "desired_vendor_categories",
        "confidence",
        "needs_review",
    ],
}


def _prompt() -> str:
    return """
You extract event information from promotional flyers for VendCore.

Return only information that is visible or strongly supported by the flyer.
Do not invent missing details.

Event kind mapping:
- marketplace: vendor markets, festivals, expos, pop-ups, fairs, events recruiting vendors/booths
- private_service: weddings, reunions, private parties, corporate celebrations, private service events
- live_entertainment: concerts, showcases, performances, live music, stage events
- custom: anything else

Formatting:
- Dates: YYYY-MM-DD when the year is actually shown or unambiguous from the flyer. Otherwise null.
- Times: 24-hour HH:MM. Convert AM/PM when present.
- State: two-letter US abbreviation when clear.
- URLs/social fields: include only when shown or clearly encoded in readable flyer text.
- desired_vendor_categories: include vendor/service categories explicitly requested or clearly advertised.
- description: a short, useful summary based only on flyer content. Do not add marketing claims not shown.
- confidence: provide 0.0 to 1.0 values only for fields you populated.
- needs_review: field names that are uncertain, ambiguous, partially obscured, or inferred.

If multiple dates/times appear and it is unclear which belongs to the main event, put the most likely value only if confidence is reasonable and include that field in needs_review. Otherwise return null.
""".strip()


def _make_content(file_bytes: bytes, filename: str, content_type: str) -> list[dict[str, Any]]:
    encoded = base64.b64encode(file_bytes).decode("ascii")
    lower_name = filename.lower()
    mime = (content_type or "").lower()

    content: list[dict[str, Any]] = [
        {"type": "input_text", "text": _prompt()},
    ]

    if mime == "application/pdf" or lower_name.endswith(".pdf"):
        content.append(
            {
                "type": "input_file",
                "filename": filename or "event-flyer.pdf",
                "file_data": encoded,
            }
        )
    else:
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            if lower_name.endswith((".jpg", ".jpeg")):
                mime = "image/jpeg"
            elif lower_name.endswith(".png"):
                mime = "image/png"
            elif lower_name.endswith(".webp"):
                mime = "image/webp"
            else:
                raise ValueError("Unsupported flyer format.")

        content.append(
            {
                "type": "input_image",
                "image_url": f"data:{mime};base64,{encoded}",
                "detail": "high",
            }
        )

    return content


def _extract_sync(file_bytes: bytes, filename: str, content_type: str) -> dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    client = OpenAI()

    response = client.responses.create(
        model=MODEL,
        input=[
            {
                "role": "user",
                "content": _make_content(file_bytes, filename, content_type),
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "vendcore_event_flyer",
                "description": "Structured event information extracted from an organizer flyer.",
                "strict": True,
                "schema": EVENT_SCHEMA,
            }
        },
    )

    raw = response.output_text
    if not raw:
        raise RuntimeError("The flyer could not be read.")

    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected flyer extraction response.")

    return data


async def extract_event_from_flyer(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    return await asyncio.to_thread(
        _extract_sync,
        file_bytes,
        filename,
        content_type,
    )
