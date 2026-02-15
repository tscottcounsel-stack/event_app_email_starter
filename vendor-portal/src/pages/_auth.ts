// src/pages/_auth.ts
export type SessionLike = { accessToken?: string };

/**
 * Very tolerant reader so the UI doesn't crash if the session shape changes.
 * Update the KEY list to match whatever you actually store in localStorage.
 */
export function readSession(): SessionLike | null {
  // Common keys across this project style
  const keys = ["session", "auth_session", "vendorconnect_session", "authStorage", "vc_session"];

  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;

    try {
      const obj: any = JSON.parse(raw);

      // Standard
      if (obj?.accessToken) return { accessToken: obj.accessToken };

      // Common variants
      if (obj?.access_token) return { accessToken: obj.access_token };
      if (obj?.token) return { accessToken: obj.token };

      // Nested variants
      if (obj?.session?.accessToken) return { accessToken: obj.session.accessToken };
      if (obj?.session?.access_token) return { accessToken: obj.session.access_token };
    } catch {
      // ignore invalid JSON
    }
  }

  // Fallback: token stored directly
  const direct =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("access_token");

  if (direct) return { accessToken: direct };

  return null;
}
