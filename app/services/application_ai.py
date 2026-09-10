from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any

from openai import OpenAI

MODEL = os.getenv("OPENAI_APPLICATION_MODEL") or os.getenv("OPENAI_FLYER_MODEL") or "gpt-4.1-mini"

CATEGORY_NAMES = [
    "Food & Beverage",
    "Art",
    "Clothing",
    "Beauty",
    "Services",
    "Tech",
    "Other",
]

APPLICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "global_compliance": {"type": "array", "items": {"type": "string"}},
        "global_documents": {"type": "array", "items": {"type": "string"}},
        "categories": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "category": {"type": "string", "enum": CATEGORY_NAMES},
                    "compliance": {"type": "array", "items": {"type": "string"}},
                    "documents": {"type": "array", "items": {"type": "string"}},
                    "default_price": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "sale_mode": {
                        "anyOf": [
                            {"type": "string", "enum": ["paid", "free", "hidden"]},
                            {"type": "null"},
                        ]
                    },
                    "tier_name": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
                "required": [
                    "category",
                    "compliance",
                    "documents",
                    "default_price",
                    "sale_mode",
                    "tier_name",
                ],
            },
        },
        "needs_review": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "summary",
        "global_compliance",
        "global_documents",
        "categories",
        "needs_review",
    ],
}

def _content_for_file(file_bytes: bytes, filename: str, content_type: str) -> list[dict[str, Any]]:
    encoded = base64.b64encode(file_bytes).decode("ascii")
    lower_name = str(filename or "").lower()
    mime = str(content_type or "").lower().strip()

    prompt = (
        "You are VendCore's application-import assistant. Read an organizer's existing vendor "
        "application and convert it into a clean VendCore requirements setup. Extract only rules, "
        "required documents/uploads, vendor-category-specific requirements, booth/application prices, "
        "and tier names that are actually supported by the uploaded application. Do not invent legal "
        "requirements, permits, insurance rules, fees, or deadlines. Put requirements that clearly apply "
        "to every applicant into global fields. Map category-specific language into one of these VendCore "
        f"categories: {', '.join(CATEGORY_NAMES)}. If a category is unclear, use Other or add a short "
        "needs_review note. If pricing is ambiguous, use null. Keep each rule and document name concise. "
        "This is autofill assistance only; the organizer will review before saving."
    )

    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]

    if mime == "application/pdf" or lower_name.endswith(".pdf"):
        content.append(
            {
                "type": "input_file",
                "filename": filename or "vendor-application.pdf",
                "file_data": encoded,
            }
        )
        return content

    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        if lower_name.endswith((".jpg", ".jpeg")):
            mime = "image/jpeg"
        elif lower_name.endswith(".png"):
            mime = "image/png"
        elif lower_name.endswith(".webp"):
            mime = "image/webp"
        else:
            raise ValueError("Unsupported application format.")

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
        input=[{"role": "user", "content": _content_for_file(file_bytes, filename, content_type)}],
        text={
            "format": {
                "type": "json_schema",
                "name": "vendcore_vendor_application_import",
                "description": "Requirements extracted from an organizer's existing vendor application.",
                "strict": True,
                "schema": APPLICATION_SCHEMA,
            }
        },
    )

    raw = getattr(response, "output_text", "") or ""
    if not raw:
        raise RuntimeError("The application could not be read.")

    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected application extraction response.")
    return data

async def extract_requirements_from_application(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    return await asyncio.to_thread(_extract_sync, file_bytes, filename, content_type)
