// vendor-portal/src/api.ts
// NOTE: This file is imported all over the frontend. Keep exports stable.

export type Role = "vendor" | "organizer";
export type UserRole = "public" | "vendor" | "organizer";

/**
 * Primary base (you said you moved to 8002).
 * We'll fallback to 8001 automatically for 404/405/network errors.
 */
const PRIMARY_DEFAULT_BASE = "http://127.0.0.1:8002";
const FALLBACK_DEFAULT_BASES = ["http://127.0.0.1:8001"];

// You can override with VITE_API_BASE in .env
export const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE ||
  (window as any)?.__API_BASE__ ||
  PRIMARY_DEFAULT_BASE;

const TOKEN_KEY = "access_token";
const USER_ROLE_KEY = "vc_user_role";

// ----------------------------
// Errors
// ----------------------------
export class ApiError extends Error {
  status: number;
  body: any;
  url?: string;

  constructor(message: string, status: number, body: any, url?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// ----------------------------
// Token helpers
// ----------------------------
export function setAccessToken(token: string | null) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function setUserRole(role: UserRole) {
  localStorage.setItem(USER_ROLE_KEY, role);
}

export function getUserRole(): UserRole {
  return (localStorage.getItem(USER_ROLE_KEY) as UserRole) || "public";
}

// ----------------------------
// Internal request utils
// ----------------------------
type RequestOptions = {
  query?: Record<string, any>;
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
};

function buildUrlWithBase(base: string, path: string, query?: Record<string, any>) {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;

  if (!query || Object.keys(query).length === 0) return `${b}${p}`;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  return `${b}${p}?${usp.toString()}`;
}

async function parseJsonSafe(res: Response) {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

function basesToTry(): string[] {
  const primary = API_BASE;
  const rest = FALLBACK_DEFAULT_BASES.filter((b) => b !== primary);
  return [primary, ...rest];
}

/**
 * Make one fetch attempt against a specific base.
 */
async function requestOnce<T>(
  base: string,
  method: string,
  path: string,
  opts: RequestOptions,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers || {}),
  };

  const authToken = token ?? getAccessToken();
  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const hasBody = opts.body !== undefined;
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const url = buildUrlWithBase(base, path, opts.query);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: hasBody
        ? typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body)
        : undefined,
      signal: opts.signal,
    });
  } catch (e: any) {
    // network error (server down / wrong port)
    throw new ApiError(e?.message || "Network error", 0, null, url);
  }

  if (!res.ok) {
    const parsed = await parseJsonSafe(res);
    const msg =
      (parsed && typeof parsed === "object" && (parsed as any).detail) ||
      res.statusText ||
      `HTTP ${res.status}`;

    throw new ApiError(String(msg), res.status, parsed, url);
  }

  return (await parseJsonSafe(res)) as T;
}

/**
 * Request with safe fallback:
 * Only retries on: 0 (network), 404, 405.
 * Does NOT retry on 400/401/403/409/500 etc to avoid duplicate POSTs.
 */
async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions,
  token?: string | null
): Promise<T> {
  const bases = basesToTry();
  let lastErr: any = null;

  for (const base of bases) {
    try {
      return await requestOnce<T>(base, method, path, opts, token);
    } catch (e: any) {
      lastErr = e;

      // Retry only for "wrong server / wrong route / wrong port"
      if (e instanceof ApiError && (e.status === 0 || e.status === 404 || e.status === 405)) {
        continue;
      }

      // Anything else: stop immediately
      throw e;
    }
  }

  throw lastErr || new ApiError("Request failed.", 500, null);
}

// ----------------------------
// Public request helpers
// ----------------------------
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

// ============================================================================
// Exports expected by pages
// ============================================================================

// ----------------------------
// Public events
// ----------------------------
export type PublicEventListItem = {
  id: number;
  title: string;
  date: string;
  location?: string | null;
  city?: string | null;
};

export async function listPublicEvents(limit = 50, signal?: AbortSignal) {
  return apiGet<{ items: PublicEventListItem[] }>(
    `/public/events?limit=${encodeURIComponent(String(limit))}`,
    null,
    signal
  );
}

// ----------------------------
// Event diagram
// ----------------------------
export type EventDiagramSlot = {
  id: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status: string;
  kind: string;
  price_cents: number;
  category_id: number | null;
};

export type EventDiagramResponse = {
  event_id: number;
  version: number;
  grid_px: number;
  slots: EventDiagramSlot[];
};

export async function getPublicEventDiagram(eventId: number, signal?: AbortSignal) {
  return apiGet<EventDiagramResponse>(`/public/events/${eventId}/diagram`, null, signal);
}

export async function vendorGetEventDiagram(eventId: number, token?: string | null, signal?: AbortSignal) {
  return apiGet<EventDiagramResponse>(`/vendor/events/${eventId}/diagram`, token, signal);
}

// ----------------------------
// Organizer contacts
// ----------------------------
export type OrganizerContact = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  tags?: string[] | null;
  created_at?: string;
  updated_at?: string;
};

export type OrganizerContactsList = {
  items: OrganizerContact[];
  total: number;
};

export async function fetchOrganizerContacts(token?: string | null, signal?: AbortSignal): Promise<OrganizerContactsList> {
  const res = await apiGet<any>(`/organizer/contacts`, token, signal);
  if (res && typeof res === "object" && Array.isArray(res.items)) {
    return { items: res.items, total: typeof res.total === "number" ? res.total : res.items.length };
  }
  if (Array.isArray(res)) return { items: res, total: res.length };
  return { items: [], total: 0 };
}

export async function createOrganizerContact(payload: Partial<OrganizerContact>, token?: string | null, signal?: AbortSignal) {
  return apiPost<any>(`/organizer/contacts`, payload, token, signal);
}

// ----------------------------
// Organizer profile
// ----------------------------
export type OrganizerProfile = {
  id?: number;
  user_id?: number;
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  about?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  license_proof_url?: string | null;
  permit_proof_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function fetchOrganizerProfile(token?: string | null, signal?: AbortSignal) {
  return apiGet<OrganizerProfile>(`/organizer/profile`, token, signal);
}

export async function saveOrganizerProfile(payload: Partial<OrganizerProfile>, token?: string | null, signal?: AbortSignal) {
  return apiPatch<OrganizerProfile>(`/organizer/profile`, payload, token, signal);
}

// ----------------------------
// Auth
// ----------------------------
export type LoginResponse = {
  access_token?: string;
  token?: string;
  token_type?: string;
  role?: string;
  user?: any;
  [k: string]: any;
};

export async function login(a: "organizer" | "vendor" | string, b?: string, c?: string): Promise<LoginResponse> {
  let role: string | null = null;
  let email: string;
  let password: string;

  // login(email, password) OR login(role, email, password)
  if (b !== undefined && c !== undefined) {
    role = a;
    email = b;
    password = c;
  } else {
    role = null;
    email = String(a);
    password = String(b ?? "");
  }

  const payload = { email, password, role };

  const endpoints = ["/auth/login/json", "/auth/login", "/login"];
  let lastErr: any = null;

  for (const ep of endpoints) {
    try {
      const res = await apiPost<LoginResponse>(ep, payload, null);
      const tok = res?.access_token || res?.token;
      if (tok) setAccessToken(tok);

      if (role) setUserRole(role === "organizer" ? "organizer" : role === "vendor" ? "vendor" : "public");

      return res;
    } catch (e: any) {
      lastErr = e;

      // stop if auth endpoint exists but creds are wrong
      if (e instanceof ApiError && (e.status === 400 || e.status === 401 || e.status === 403)) throw e;

      // try next endpoint if wrong server/route
      if (e instanceof ApiError && (e.status === 0 || e.status === 404 || e.status === 405)) continue;

      throw e;
    }
  }

  throw lastErr || new ApiError("Login failed (no auth endpoint matched).", 500, null);
}

export function logout() {
  clearAccessToken();
  setUserRole("public");
}
