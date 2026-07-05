#!/usr/bin/env python3
"""VendCore public API leak audit.

Run before backend pushes and after Railway deploys:

    python scripts/public_leak_audit.py

Optional environment variables:
    VENDCORE_API_BASE=https://api.vendcore.co
    VENDCORE_AUDIT_EVENT_ID=21
    VENDCORE_AUDIT_VENDOR_EMAILS=vendor1@example.com,vendor2@example.com
    VENDCORE_ALLOWED_ORIGIN=https://vendcore.co
    VENDCORE_BLOCKED_ORIGIN=https://evil.example
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Iterable


API_BASE = os.getenv("VENDCORE_API_BASE", "https://api.vendcore.co").rstrip("/")
EVENT_ID = os.getenv("VENDCORE_AUDIT_EVENT_ID", "21").strip() or "21"
VENDOR_EMAILS = [
    item.strip().lower()
    for item in os.getenv(
        "VENDCORE_AUDIT_VENDOR_EMAILS",
        "adongima@icloud.com,info@joinbubblenation.com",
    ).split(",")
    if item.strip()
]
ALLOWED_ORIGIN = os.getenv("VENDCORE_ALLOWED_ORIGIN", "https://vendcore.co").rstrip("/")
BLOCKED_ORIGIN = os.getenv("VENDCORE_BLOCKED_ORIGIN", "https://evil.example").rstrip("/")

# Exact/private markers. Do not include bare `file_url` without quotes because it
# false-positives on profile_url. Do not fail on a safe public `documents` key by
# itself; fail on URLs, IDs, date metadata, storage references, and private state.
SENSITIVE_PATTERNS = [
    "vendcore/verification-documents",
    "verification-documents",
    "verification_documents",
    "legacy-profile-doc:",
    "view-url",
    "s3.amazonaws.com",
    "amazonaws.com/",
    "x-amz-",
    '"expiration_date"',
    '"expirationDate"',
    '"expires_at"',
    '"expiresAt"',
    '"uploaded_at"',
    '"uploadedAt"',
    '"signed_url"',
    '"signedUrl"',
    '"file_url"',
    '"fileUrl"',
    '"s3_key"',
    '"s3Key"',
    '"storage_key"',
    '"storageKey"',
    '"verification_id"',
    '"verificationId"',
    '"subscription_plan"',
    '"subscriptionPlan"',
    '"subscription_status"',
    '"subscriptionStatus"',
    '"review_status"',
    '"reviewStatus"',
    '"fee_paid"',
    '"feePaid"',
    "stripe",
    '"author_email"',
    '"authorEmail"',
    '"reaction_users"',
    '"reactionUsers"',
    '"pinned_by"',
    '"pinnedBy"',
]


@dataclass
class AuditResult:
    label: str
    ok: bool
    detail: str


def _request(method: str, url: str, headers: dict[str, str] | None = None) -> tuple[int, str, dict[str, str]]:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read().decode("utf-8", errors="replace")
            return res.status, body, {k.lower(): v for k, v in res.headers.items()}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, body, {k.lower(): v for k, v in exc.headers.items()}


def _find_sensitive(body: str, patterns: Iterable[str]) -> list[str]:
    lowered = body.lower()
    found: list[str] = []
    for pattern in patterns:
        if pattern.lower() in lowered:
            found.append(pattern)
    return found


def _public_check(path: str) -> AuditResult:
    url = f"{API_BASE}{path}"
    status, body, _headers = _request("GET", url)
    if status >= 400:
        return AuditResult(path, False, f"HTTP {status}: {body[:220]}")

    matches = _find_sensitive(body, SENSITIVE_PATTERNS)
    if matches:
        return AuditResult(path, False, f"Sensitive markers found: {', '.join(matches)}")

    return AuditResult(path, True, "no sensitive markers found")


def _protected_check(path: str, expected_statuses: set[int]) -> AuditResult:
    status, body, _headers = _request("GET", f"{API_BASE}{path}")
    if status in expected_statuses:
        return AuditResult(path, True, f"blocked with HTTP {status}")
    return AuditResult(path, False, f"expected {sorted(expected_statuses)}, got HTTP {status}: {body[:220]}")


def _cors_preflight(origin: str) -> tuple[int, dict[str, str]]:
    status, _body, headers = _request(
        "OPTIONS",
        f"{API_BASE}/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    return status, headers


def _cors_check_allowed() -> AuditResult:
    status, headers = _cors_preflight(ALLOWED_ORIGIN)
    allow_origin = headers.get("access-control-allow-origin", "")
    allow_credentials = headers.get("access-control-allow-credentials", "")
    if 200 <= status < 300 and allow_origin == ALLOWED_ORIGIN and allow_credentials.lower() == "true":
        return AuditResult("CORS allowed origin", True, f"{ALLOWED_ORIGIN} accepted")
    return AuditResult(
        "CORS allowed origin",
        False,
        f"expected {ALLOWED_ORIGIN}; got HTTP {status}, allow-origin={allow_origin!r}, credentials={allow_credentials!r}",
    )


def _cors_check_blocked() -> AuditResult:
    status, headers = _cors_preflight(BLOCKED_ORIGIN)
    allow_origin = headers.get("access-control-allow-origin", "")
    if allow_origin != BLOCKED_ORIGIN:
        return AuditResult("CORS blocked origin", True, f"{BLOCKED_ORIGIN} not echoed")
    return AuditResult("CORS blocked origin", False, f"blocked origin was allowed with HTTP {status}")


def _cors_check_admin_headers() -> AuditResult:
    status, headers = _request(
        "OPTIONS",
        f"{API_BASE}/health",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type,X-User-Email,X-User-Role,X-Admin-Email,X-Role",
        },
    )
    allow_origin = headers.get("access-control-allow-origin", "")
    allow_headers = headers.get("access-control-allow-headers", "").lower()
    required = ["authorization", "content-type", "x-user-email", "x-user-role", "x-admin-email", "x-role"]
    missing = [name for name in required if name not in allow_headers]
    if 200 <= status < 300 and allow_origin == ALLOWED_ORIGIN and not missing:
        return AuditResult("CORS admin legacy headers", True, "legacy admin headers accepted")
    return AuditResult(
        "CORS admin legacy headers",
        False,
        f"HTTP {status}, allow-origin={allow_origin!r}, missing={missing}, allow-headers={allow_headers!r}",
    )


def main() -> int:
    public_paths = [
        "/vendors/public?limit=100",
        f"/events/{EVENT_ID}/wall",
        "/api/public/featured-homepage",
        "/public/homepage-features",
    ]
    for email in VENDOR_EMAILS:
        public_paths.append(f"/verification/public/vendor/{email}")

    results: list[AuditResult] = []
    results.extend(_public_check(path) for path in public_paths)
    results.append(_protected_check("/shared-documents/1", {404}))
    results.append(_protected_check("/verification-documents/1/view-url", {401, 403, 404}))
    results.append(_cors_check_allowed())
    results.append(_cors_check_admin_headers())
    results.append(_cors_check_blocked())

    print(f"VendCore public leak audit against {API_BASE}\n")
    failed = False
    for result in results:
        prefix = "PASS" if result.ok else "FAIL"
        print(f"{prefix}: {result.label} — {result.detail}")
        failed = failed or not result.ok

    print("")
    if failed:
        print("Audit failed. Do not deploy/tag stable until failures are resolved.")
        return 1

    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
