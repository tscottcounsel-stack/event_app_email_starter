// src/api.ts
// Centralized fetch + auth helpers for the vendor/organizer portal.

export const API_BASE = "http://127.0.0.1:8001";

export type UserRole = "organizer" | "vendor" | "admin" | string;

export type AuthTokens = {
  accessToken: string;
  role?: UserRole | null;
};

/**
 * Store auth info after login.
 * Call this from Organizer/Vendor login pages.
 */
export function setAuthTokens(accessToken: string, role?: UserRole | null) {
  if (accessToken) {
    localStorage.setItem("access_token", accessToken);
  } else {
    localStorage.removeItem("access_token");
  }

  if (role) {
    localStorage.setItem("user_role", role);
  } else {
    localStorage.removeItem("user_role");
  }
}

/**
 * Read auth info for the current session.
 * Used by App.tsx (getAuthTokens) and by the request helpers below.
 */
export function getAuthTokens(): AuthTokens | null {
  const accessToken = localStorage.getItem("access_token");
  if (!accessToken) return null;

  const role = (localStorage.getItem("user_role") as UserRole | null) ?? null;
  return { accessToken, role };
}

/**
 * Remove all stored auth info. Used on logout.
 */
export function clearAuthTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user_role");
}

function getAccessToken(): string | null {
  return getAuthTokens()?.accessToken ?? null;
}

function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path}`;
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAccessToken();

  const base: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    base["Authorization"] = `Bearer ${token}`;
  }

  return {
    ...base,
    ...(extra ?? {}),
  };
}

async function handleResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `API error ${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.detail) {
        message = Array.isArray(body.detail)
          ? body.detail.map((d: any) => d.msg ?? d.detail ?? "").join("; ")
          : body.detail;
      }
    } catch {
      // ignore JSON parse failures, keep generic message
    }
    throw new Error(message);
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  return (await resp.json()) as T;
}

// ---------- Public request helpers ----------

export async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
  });
  return handleResponse<T>(resp);
}

export async function apiPost<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: "POST",
    headers: buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handleResponse<T>(resp);
}

export async function apiPut<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: "PUT",
    headers: buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  return handleResponse<T>(resp);
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: "DELETE",
    headers: buildHeaders(),
    credentials: "include",
  });
  return handleResponse<T>(resp);
}
