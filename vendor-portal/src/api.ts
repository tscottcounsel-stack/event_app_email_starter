// vendor-portal/src/api.ts
//
// Compatibility façade for the frontend.
// RULES:
// - NO JSX in this file.
// - Keep export names + signatures stable (pages depend on them).
// - Prefer token-arg helpers: apiPatch(url, body, token) etc.

export type Role = "vendor" | "organizer";
export type UserRole = "public" | "vendor" | "organizer";

const DEFAULT_API_BASE = "http://127.0.0.1:8002";

// Vite env: VITE_API_BASE="http://127.0.0.1:8002"
export const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE ||
  (window as any)?.__API_BASE__ ||
  DEFAULT_API_BASE;

const TOKEN_KEY = "access_token";
const USER_ROLE_KEY = "vc_user_role";

// ----------------------------
// Errors
// ----------------------------
export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ----------------------------
// Token + role storage (legacy-friendly)
// ----------------------------
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

export function clearAccessToken() {
  setAccessToken(null);
}

export function getUserRole(): UserRole {
  try {
    const v = localStorage.getItem(USER_ROLE_KEY);
    if (v === "vendor" || v === "organizer" || v === "public") return v;
    return "public";
  } catch {
    return "public";
  }
}

export function setUserRole(role: UserRole) {
  try {
    localStorage.setItem(USER_ROLE_KEY, role);
  } catch {
    // ignore
  }
}

// ----------------------------
// Low-level request helpers (token-style)
// ----------------------------
type RequestOptions = {
  query?: Record<string, any>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  body?: any;
};

function buildUrl(path: string, query?: Record<string, any>) {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;

  if (!query || Object.keys(query).length === 0) return `${base}${p}`;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  return `${base}${p}?${usp.toString()}`;
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

  const authToken = token ?? getAccessToken();
  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const hasBody = opts.body !== undefined;
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const url = buildUrl(path, opts.query);

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody
      ? typeof opts.body === "string"
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    const parsed = await parseJsonSafe(res);
    const msg =
      (parsed && typeof parsed === "object" && (parsed as any).detail) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status, parsed);
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

export async function tryGetFirst<T>(paths: string[], token?: string | null) {
  let lastErr: any = null;
  for (const p of paths) {
    try {
      return await apiGet<T>(p, token);
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 404) continue;
      throw e;
    }
  }
  throw lastErr || new ApiError("Not found", 404, null);
}

export async function tryPostFirst<T>(paths: string[], payload: any, token?: string | null) {
  let lastErr: any = null;
  for (const p of paths) {
    try {
      return await apiPost<T>(p, payload, token);
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 404) continue;
      throw e;
    }
  }
  throw lastErr || new ApiError("Not found", 404, null);
}

export async function tryPatchFirst<T>(paths: string[], payload: any, token?: string | null) {
  let lastErr: any = null;
  for (const p of paths) {
    try {
      return await apiPatch<T>(p, payload, token);
    } catch (e: any) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 404) continue;
      throw e;
    }
  }
  throw lastErr || new ApiError("Not found", 404, null);
}

// ----------------------------
// Public events + diagram
// ----------------------------
export type PublicEventListItem = {
  id: number;
  title: string;
  date: string;
  location: string;
  city: string;
};

export async function listPublicEvents(limit = 50, signal?: AbortSignal) {
  return apiGet<{ items: PublicEventListItem[] }>(
    `/public/events?limit=${encodeURIComponent(String(limit))}`,
    null,
    signal
  );
}

export async function getPublicEventDiagram(eventId: number, signal?: AbortSignal) {
  return tryGetFirst<any>(
    [`/public/events/${eventId}/diagram`, `/public/events/${eventId}/boothmap`],
    null
  );
}

export const getPublicEventDiagramLegacy = getPublicEventDiagram;

// ----------------------------
// Login
// ----------------------------
export async function login(
  a: any,
  b: any,
  c?: any
): Promise<{ access_token: string } | any> {
  let role: Role = "organizer";
  let email: string;
  let password: string;

  if (a === "vendor" || a === "organizer") {
    role = a;
    email = String(b);
    password = String(c ?? "");
  } else {
    email = String(a);
    password = String(b);
    if (c === "vendor" || c === "organizer") role = c;
  }

  const data = await tryPostFirst<any>(
    ["/auth/login/json", "/login", `/${role}/auth/login/json`],
    { email, password, role },
    null
  );

  const token: string | undefined = data?.access_token || data?.token;
  if (token) {
    setAccessToken(token);
    setUserRole(role);
  }

  return data;
}

// ----------------------------
// Organizer: Events
// ----------------------------
export async function fetchOrganizerEvents(
  limit = 50,
  token?: string | null,
  signal?: AbortSignal
) {
  return apiGet<any>(
    `/organizer/events?limit=${encodeURIComponent(String(limit))}`,
    token,
    signal
  );
}

export const listOrganizerEvents = fetchOrganizerEvents;

// ----------------------------
// Organizer: Applications
// ----------------------------
export async function organizerListEventApplications(
  eventId: number,
  limit = 200,
  token?: string | null
) {
  return apiGet<any>(
    `/organizer/events/${eventId}/applications?limit=${encodeURIComponent(String(limit))}`,
    token
  );
}

export const fetchOrganizerEventApplications = organizerListEventApplications;

export async function patchOrganizerApplication(
  applicationId: number,
  patch: any,
  token?: string | null
) {
  return apiPatch<any>(`/organizer/applications/${applicationId}`, patch, token);
}

// ----------------------------
// Organizer: Profile
// ----------------------------
export type OrganizerProfileShape = {
  user_id?: number;
  business_name?: string | null;
  contact_name?: string | null;
  public_email?: string | null;
  phone?: string | null;
  website?: string | null;
  about?: string | null;
  city?: string | null;
  state?: string | null;
  [k: string]: any;
};

export async function fetchOrganizerProfile(token?: string | null): Promise<OrganizerProfileShape | null> {
  try {
    const data = await tryGetFirst<OrganizerProfileShape>(
      ["/organizer/profile", "/organizer/me/profile", "/organizer/_whoami"],
      token
    );
    return data ?? null;
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function saveOrganizerProfile(
  payload: OrganizerProfileShape,
  token?: string | null
): Promise<OrganizerProfileShape | null> {
  try {
    try {
      return await tryPatchFirst<OrganizerProfileShape>(
        ["/organizer/profile", "/organizer/me/profile"],
        payload,
        token
      );
    } catch (e: any) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    return await tryPostFirst<OrganizerProfileShape>(
      ["/organizer/profile", "/organizer/me/profile"],
      payload,
      token
    );
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// ----------------------------
// Organizer: Contacts
// ----------------------------
export type OrganizerContact = {
  id: number;
  organizer_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  tags?: string[] | string | null;
};

export type OrganizerContactsList = {
  items: OrganizerContact[];
  count: number;
  // legacy keys can still exist
  value?: OrganizerContact[];
  Count?: number;
};

export async function createOrganizerContact(payload: any, token?: string | null): Promise<any> {
  return apiPost<any>(`/organizer/contacts`, payload, token);
}

export async function fetchOrganizerContacts(token?: string | null): Promise<OrganizerContactsList> {
  const res = await apiGet<any>(`/organizer/contacts`, token);

  // normalize to standard contract
  const items =
    (Array.isArray(res?.items) && res.items) ||
    (Array.isArray(res?.value) && res.value) ||
    (Array.isArray(res) && res) ||
    [];

  const count =
    (typeof res?.count === "number" && res.count) ||
    (typeof res?.Count === "number" && res.Count) ||
    items.length;

  return { items, count, value: res?.value, Count: res?.Count };
}

// ----------------------------
// Vendor diagram helper
// ----------------------------
export async function vendorGetEventDiagram(eventId: number, token?: string | null) {
  return tryGetFirst<any>(
    [
      `/vendor/events/${eventId}/diagram`,
      `/vendor/events/${eventId}/boothmap`,
      `/public/events/${eventId}/diagram`,
    ],
    token
  );
}
