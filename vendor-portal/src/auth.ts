// vendor-portal/src/auth.ts
const TOKEN_KEY = "access_token";

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  setAccessToken(null);
}

// Some pages expect these helpers (safe minimal versions)
export function getVendorUserId(): number | null {
  // If you later store this in localStorage or decode JWT, wire it up.
  return null;
}
export function getOrganizerUserId(): number | null {
  return null;
}
