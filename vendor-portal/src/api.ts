// vendor-portal/src/api.ts
export type Role = "vendor" | "organizer";
export type UserRole = "public" | "vendor" | "organizer";

// some pages import these types
export type PublicEventListItem = any;
export type OrganizerEventListItem = any;
export type EventDiagramResponse = any;

const DEFAULT_API_BASE = "http://127.0.0.1:8002";
export const API_BASE: string = (import.meta as any)?.env?.VITE_API_BASE || DEFAULT_API_BASE;

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const ACCESS_TOKEN_KEY = "access_token";
const USER_ROLE_KEY = "user_role";

export function getUserRole(): UserRole {
  try {
    const v = localStorage.getItem(USER_ROLE_KEY);
    if (v === "vendor" || v === "organizer" || v === "public") return v;
  } catch {}
  return "public";
}
export function setUserRole(role: UserRole) {
  try { localStorage.setItem(USER_ROLE_KEY, role); } catch {}
}
export function clearUserRole() {
  try { localStorage.removeItem(USER_ROLE_KEY); } catch {}
}

export function getAccessToken(): string | null {
  try { return localStorage.getItem(ACCESS_TOKEN_KEY); } catch { return null; }
}
export function setAccessToken(token: string) {
  try { localStorage.setItem(ACCESS_TOKEN_KEY, token); } catch {}
}
export function clearAccessToken() {
  try { localStorage.removeItem(ACCESS_TOKEN_KEY); } catch {}
}

type RequestOptions = {
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
  contentType?: string | null;
};

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function buildErrorMessage(parsed: any, res: Response): string {
  const detail = parsed && typeof parsed === "object" ? (parsed as any).detail : null;
  if (typeof detail === "string") return detail;
  if (detail != null) return JSON.stringify(detail);
  if (typeof parsed === "string") return parsed;
  return res.statusText || `HTTP ${res.status}`;
}

async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers || {}),
  };

  const t = token ?? getAccessToken();
  if (t && !headers.Authorization) headers.Authorization = `Bearer ${t}`;

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    const ct = opts.contentType === undefined ? "application/json" : opts.contentType;
    if (ct) headers["Content-Type"] = ct;
    body = ct === "application/json" ? JSON.stringify(opts.body) : opts.body;
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { method, headers, body, signal: opts.signal });

  if (!res.ok) {
    const parsed = await parseJsonSafe(res);
    throw new ApiError(buildErrorMessage(parsed, res), res.status, parsed);
  }

  return (await parseJsonSafe(res)) as T;
}

export function apiGet<T>(path: string, token?: string | null, signal?: AbortSignal) {
  return request<T>("GET", path, { signal }, token);
}
export function apiPost<T>(path: string, body: any, token?: string | null, signal?: AbortSignal) {
  return request<T>("POST", path, { body, signal }, token);
}
export function apiPut<T>(path: string, body: any, token?: string | null, signal?: AbortSignal) {
  return request<T>("PUT", path, { body, signal }, token);
}
export function apiPatch<T>(path: string, body: any, token?: string | null, signal?: AbortSignal) {
  return request<T>("PATCH", path, { body, signal }, token);
}
export function apiDelete<T>(path: string, token?: string | null, signal?: AbortSignal) {
  return request<T>("DELETE", path, { signal }, token);
}

export async function apiFetch<T = any>(
  path: string,
  opts?: { method?: string; body?: any; token?: string | null; signal?: AbortSignal; headers?: Record<string, string> }
): Promise<T> {
  const method = (opts?.method || "GET").toUpperCase();
  if (method === "GET" || method === "DELETE") {
    return request<T>(method, path, { signal: opts?.signal, headers: opts?.headers }, opts?.token);
  }
  return request<T>(
    method,
    path,
    { body: opts?.body, signal: opts?.signal, headers: opts?.headers },
    opts?.token
  );
}

// --- auth (pages import login) ---
export async function login(email: string, password: string) {
  const candidates = [
    "/auth/login/json",
    "/auth/login",
    "/login",
    "/login/json",
  ];

  let lastErr: any = null;

  for (const path of candidates) {
    try {
      const res = await apiPost<any>(path, { email, password });
      if (res?.access_token) setAccessToken(res.access_token);
      return res;
    } catch (e: any) {
      lastErr = e;
      // If it's a 404, try the next candidate.
      if (e instanceof ApiError && e.status === 404) continue;
      // Otherwise it's a real failure (401/422/etc.)
      throw e;
    }
  }

  throw lastErr ?? new Error("No login endpoint matched");
}
export async function whoamiOrganizer(token?: string | null) {
  return apiGet<any>(`/organizer/_whoami`, token);
}
export async function whoamiVendor(token?: string | null) {
  return apiGet<any>(`/vendor/_whoami`, token);
}

// --- public ---
export async function fetchPublicEvents(limit = 50) {
  return apiGet<any>(`/public/events?limit=${encodeURIComponent(limit)}`);
}
export async function listPublicEvents(limit = 50) {
  return fetchPublicEvents(limit);
}
export async function fetchPublicEventDetail(eventId: number) {
  return apiGet<any>(`/public/events/${eventId}`);
}
export async function fetchPublicEventDiagram(eventId: number) {
  return apiGet<any>(`/public/events/${eventId}/diagram`);
}
export async function getPublicEventDiagram(eventId: number) {
  return fetchPublicEventDiagram(eventId);
}

// --- organizer events ---
export async function fetchOrganizerEvents(token?: string | null) {
  return apiGet<any>(`/organizer/events`, token);
}

// --- organizer applications (needed by OrganizerApplicationsPage.tsx) ---
export async function organizerListEventApplications(eventId: number, token?: string | null) {
  return apiGet<any>(`/organizer/events/${eventId}/applications`, token);
}

// --- organizer contacts ---
function normalizeTags(input: any): string[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input.map((x) => String(x).trim()).filter(Boolean);
  return String(input).split(",").map((s) => s.trim()).filter(Boolean);
}

export async function fetchOrganizerContacts(token?: string | null) {
  return apiGet<any>(`/organizer/contacts`, token);
}

export async function createOrganizerContact(payload: any, token?: string | null) {
  const safe = { ...(payload || {}) };
  safe.name = String(safe.name || "").trim();
  safe.email = safe.email ? String(safe.email).trim() : null;
  safe.phone = safe.phone ? String(safe.phone).trim() : null;
  safe.company = safe.company ? String(safe.company).trim() : null;
  safe.notes = safe.notes ? String(safe.notes).trim() : null;
  safe.tags = normalizeTags(safe.tags);
  return apiPost<any>(`/organizer/contacts`, safe, token);
}

// --- organizer profile (back-compat export for OrganizerProfilePage) ---
export async function fetchOrganizerProfile(token?: string | null) {
  return apiGet<any>(`/organizer/profile`, token);
}

export async function saveOrganizerProfile(payload: any, token?: string | null) {
  return apiPatch<any>(`/organizer/profile`, payload, token);
}

export async function updateOrganizerContact(
  contactId: number,
  payload: any,
  token?: string | null
) {
  const safe = { ...(payload || {}) };
  safe.name = String(safe.name || "").trim();
  safe.email = safe.email ? String(safe.email).trim() : null;
  safe.phone = safe.phone ? String(safe.phone).trim() : null;
  safe.company = safe.company ? String(safe.company).trim() : null;
  safe.notes = safe.notes ? String(safe.notes).trim() : null;

  // normalize tags the same way create does
  // if your file already has normalizeTags(), reuse it; if not, keep this inline:
  const normalizeTags = (input: any): string[] => {
    if (input == null) return [];
    if (Array.isArray(input)) return input.map((x) => String(x).trim()).filter(Boolean);
    return String(input).split(",").map((s) => s.trim()).filter(Boolean);
  };

  safe.tags = normalizeTags(safe.tags);

  // PATCH is safest for partial updates; switch to apiPut if backend demands PUT.
  return apiPatch<any>(`/organizer/contacts/${contactId}`, safe, token);
}

// --- vendor diagram helper ---
export async function vendorGetEventDiagram(eventId: number, token?: string | null) {
  try {
    return await apiGet<any>(`/vendor/events/${eventId}/diagram`, token);
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 404) {
      return apiGet<any>(`/public/events/${eventId}/diagram`, token);
    }
    throw e;
  }
}
