// src/auth/authHeaders.ts
type HeaderMap = Record<string, string>;

function safeTrim(v: any): string {
  return String(v ?? "").trim();
}

function safeLower(v: any): string {
  return safeTrim(v).toLowerCase();
}

/**
 * buildAuthHeaders()
 * - Unifies auth/identity headers across the app.
 * - Supports both:
 *   (a) flat localStorage keys: accessToken/token, userEmail/email, userId/id
 *   (b) JSON session object in localStorage/sessionStorage: { accessToken, email, id, user: { email, id }, sub }
 */
export function buildAuthHeaders(extra?: HeaderMap): HeaderMap {
  const headers: HeaderMap = {
    Accept: "application/json",
    ...(extra ?? {}),
  };

  // ----- Flat keys -----
  const token =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    "";

  const email =
    localStorage.getItem("userEmail") ||
    localStorage.getItem("email") ||
    "";

  const userId =
    localStorage.getItem("userId") ||
    localStorage.getItem("id") ||
    "";

  if (token) headers.Authorization = `Bearer ${safeTrim(token)}`;
  if (email) headers["x-user-email"] = safeLower(email);
  if (userId) headers["x-user-id"] = safeTrim(userId);

  // ----- Session JSON (back-compat) -----
  const raw =
    sessionStorage.getItem("session") ||
    localStorage.getItem("session") ||
    "";

  if (raw) {
    try {
      const s: any = JSON.parse(raw);

      // token
      const st = s?.accessToken || s?.token;
      if (!headers.Authorization && st) {
        headers.Authorization = `Bearer ${safeTrim(st)}`;
      }

      // email (multiple shapes)
      const se = s?.email || s?.userEmail || s?.user?.email;
      if (!headers["x-user-email"] && se) {
        headers["x-user-email"] = safeLower(se);
      }

      // id (multiple shapes)
      const sid = s?.id ?? s?.userId ?? s?.user?.id ?? s?.sub;
      if (!headers["x-user-id"] && sid !== undefined && sid !== null) {
        headers["x-user-id"] = safeTrim(sid);
      }
    } catch {
      // ignore bad session JSON
    }
  }

  return headers;
}
