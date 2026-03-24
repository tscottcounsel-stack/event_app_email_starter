// src/auth/authHeaders.ts
type HeaderMap = Record<string, string>;

function safeTrim(v: any): string {
  return String(v ?? "").trim();
}

/**
 * buildAuthHeaders()
 * Source of truth: JWT accessToken stored in localStorage under "accessToken".
 *
 * IMPORTANT:
 * - Do NOT send x-user-email / x-user-id headers.
 * - Backend should derive identity from the Bearer token.
 * - This prevents "stale localStorage identity" bugs (e.g. showing sammys while logged in as new1).
 */
export function buildAuthHeaders(extra?: HeaderMap): HeaderMap {
  const headers: HeaderMap = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };

  const token = safeTrim(localStorage.getItem("accessToken"));

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    // If you want to debug missing auth, uncomment:
    // console.warn("buildAuthHeaders: missing accessToken in localStorage");
  }

  return headers;
}
