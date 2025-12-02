import { getToken, clearToken } from "./auth";

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(`/api${path}`, { ...options, headers });
  if (resp.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!resp.ok) {
    let msg = `Request failed (${resp.status})`;
    try {
      const data = await resp.json();
      msg = (data?.detail as string) || msg;
    } catch {}
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}
