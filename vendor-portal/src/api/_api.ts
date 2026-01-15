// src/api/_api.ts
export const API_BASE: string = (() => {
  // Prefer the standard env var
  const fromEnv =
    (import.meta as any).env?.VITE_API_BASE ||
    // Back-compat if any older code used this name
    (import.meta as any).env?.VITE_API_BASE_URL ||
    "";

  const base = String(fromEnv || "http://127.0.0.1:8002").trim();

  // Normalize trailing slashes
  return base.replace(/\/+$/, "");
})();

export class ApiError extends Error {
  status: number;
  body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function getAccessToken(): string | null {
  try {
    return window.localStorage.getItem("access_token");
  } catch {
    return null;
  }
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function requestOnce<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers: Record<string, string> = {
    ...(init?.headers as any),
  };

  const resp = await fetch(url, {
    ...init,
    headers,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ApiError(`HTTP ${resp.status}`, resp.status, text);
  }

  // handle empty responses
  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return (undefined as unknown) as T;
  }

  return (await resp.json()) as T;
}

export function apiGet<T>(path: string) {
  return requestOnce<T>(path, {
    method: "GET",
    headers: authHeaders(),
  });
}

export function apiPost<T>(path: string, body: any) {
  return requestOnce<T>(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: any) {
  return requestOnce<T>(path, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: any) {
  return requestOnce<T>(path, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string) {
  return requestOnce<T>(path, {
    method: "DELETE",
    headers: authHeaders(),
  });
}
