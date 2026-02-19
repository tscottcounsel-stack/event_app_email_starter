// src/components/api/applications.ts

/**
 * Backward-compatible Applications API.
 *
 * Fixes:
 * - Vendor pages calling listVendorApplications() without args
 * - Missing vendor identity by automatically attaching auth headers
 *
 * Uses readSession() from localStorage:
 *   accessToken, role, email
 */

import { readSession } from "../../auth/authStorage";

export const API_BASE_DEFAULT =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

export type UploadedDocMeta = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
};

export type ServerApplication = {
  id: number;
  event_id: number;

  booth_id?: string | null;
  app_ref?: string | null;

  vendor_email?: string | null;
  vendor_id?: string | null;

  status?: "draft" | "submitted" | string | null;

  checked?: Record<string, boolean> | null;
  docs?: Record<string, UploadedDocMeta | null> | null;

  notes?: string | null;

  submitted_at?: string | null;
  updated_at?: string | null;
};

export type ListVendorApplicationsResponse = {
  applications: ServerApplication[];
};

export type SubmitApplicationBody = {
  booth_id?: string | null;
  checked?: Record<string, boolean>;
  docs?: Record<string, UploadedDocMeta | null>;
  notes?: string;
  status?: "draft" | "submitted";
};

export type UpdateApplicationBody = SubmitApplicationBody;

/* ---------------- Internals ---------------- */

type Authish = {
  accessToken?: string;
  role?: string;
  email?: string;
};

function getSessionFallback(explicit?: Authish): Authish {
  // If caller passed an accessToken explicitly, prefer it.
  if (explicit?.accessToken) return explicit;

  const s = readSession();
  if (!s) return explicit ?? {};
  return {
    accessToken: s.accessToken,
    role: s.role,
    email: s.email,
  };
}

function buildAuthHeaders(explicit?: Authish): Record<string, string> {
  const s = getSessionFallback(explicit);

  const h: Record<string, string> = { Accept: "application/json" };

  if (s.accessToken) h["Authorization"] = `Bearer ${s.accessToken}`;

  // Fallback identity headers (some backend paths require these)
  if (s.email) h["x-user-email"] = s.email;
  if (s.role) h["x-user-role"] = s.role;

  return h;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function unwrapApplication(data: any): ServerApplication {
  return (data?.application ?? data) as ServerApplication;
}

function unwrapApplications(data: any): ServerApplication[] {
  const list = (data?.applications ?? data) as any;
  return Array.isArray(list) ? (list as ServerApplication[]) : [];
}

async function fetchJsonOrThrow(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const data = await readJson(res);
  if (!res.ok) {
    const msg = String(data?.detail || data?.message || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

/* =========================================================
   Vendor endpoints (draft + update)
   ========================================================= */

export async function vendorGetOrCreateDraftApplication(args: {
  apiBase?: string;
  eventId: string | number;
  accessToken?: string;
}): Promise<ServerApplication> {
  const apiBase = args.apiBase || API_BASE_DEFAULT;
  const url = `${apiBase}/vendor/events/${encodeURIComponent(
    String(args.eventId)
  )}/applications/draft`;

  const data = await fetchJsonOrThrow(url, {
    method: "POST",
    headers: {
      ...buildAuthHeaders({ accessToken: args.accessToken }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return unwrapApplication(data);
}

export async function vendorGetOrCreateDraftApplicationLegacy(args: {
  apiBase?: string;
  eventId: string | number;
  accessToken?: string;
}): Promise<ServerApplication> {
  const apiBase = args.apiBase || API_BASE_DEFAULT;
  const url = `${apiBase}/vendor/applications/draft`;

  const data = await fetchJsonOrThrow(url, {
    method: "POST",
    headers: {
      ...buildAuthHeaders({ accessToken: args.accessToken }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_id: Number(args.eventId) }),
  });

  return unwrapApplication(data);
}

export async function vendorGetApplication(args: {
  apiBase?: string;
  appId: string | number;
  accessToken?: string;
}): Promise<ServerApplication> {
  const apiBase = args.apiBase || API_BASE_DEFAULT;
  const url = `${apiBase}/vendor/applications/${encodeURIComponent(
    String(args.appId)
  )}`;

  const data = await fetchJsonOrThrow(url, {
    method: "GET",
    headers: { ...buildAuthHeaders({ accessToken: args.accessToken }) },
  });

  return unwrapApplication(data);
}

export async function vendorUpdateApplication(args: {
  apiBase?: string;
  appId: string | number;
  accessToken?: string;
  body: UpdateApplicationBody;
}): Promise<ServerApplication> {
  const apiBase = args.apiBase || API_BASE_DEFAULT;
  const url = `${apiBase}/vendor/applications/${encodeURIComponent(
    String(args.appId)
  )}`;

  const data = await fetchJsonOrThrow(url, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders({ accessToken: args.accessToken }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args.body ?? {}),
  });

  return unwrapApplication(data);
}

/* =========================================================
   Organizer endpoints
   ========================================================= */

export async function organizerListEventApplications(args: {
  apiBase?: string;
  eventId: string | number;
  accessToken?: string;
}): Promise<ServerApplication[]> {
  const apiBase = args.apiBase || API_BASE_DEFAULT;
  const url = `${apiBase}/organizer/events/${encodeURIComponent(
    String(args.eventId)
  )}/applications`;

  const data = await fetchJsonOrThrow(url, {
    method: "GET",
    headers: { ...buildAuthHeaders({ accessToken: args.accessToken }) },
  });

  return unwrapApplications(data);
}

/* =========================================================
   Legacy exports (key compatibility)
   ========================================================= */

export async function listVendorApplications(
  args?:
    | {
        apiBase?: string;
        accessToken?: string;
        eventId?: string | number;
      }
    | undefined
): Promise<ListVendorApplicationsResponse> {
  const apiBase = args?.apiBase || API_BASE_DEFAULT;

  // If eventId is provided, treat as organizer list for that event.
  if (args?.eventId !== undefined && args?.eventId !== null) {
    const applications = await organizerListEventApplications({
      apiBase,
      eventId: args.eventId,
      accessToken: args.accessToken,
    });
    return { applications };
  }

  // Otherwise: vendor "my applications"
  const url = `${apiBase}/vendor/applications`;
  const data = await fetchJsonOrThrow(url, {
    method: "GET",
    headers: { ...buildAuthHeaders({ accessToken: args?.accessToken }) },
  });

  return { applications: unwrapApplications(data) };
}

export async function organizerListVendorApplications(args: {
  apiBase?: string;
  eventId: string | number;
  accessToken?: string;
}): Promise<ListVendorApplicationsResponse> {
  return listVendorApplications(args);
}

export async function submitApplication(args: {
  apiBase?: string;
  appId: string | number;
  accessToken?: string;
  body: SubmitApplicationBody;
}): Promise<ServerApplication> {
  return vendorUpdateApplication({
    apiBase: args.apiBase,
    appId: args.appId,
    accessToken: args.accessToken,
    body: args.body,
  });
}

/* =========================================================
   Default export (supports default-import style)
   ========================================================= */

export const ApplicationsAPI = {
  vendorGetOrCreateDraftApplication,
  vendorGetOrCreateDraftApplicationLegacy,
  vendorGetApplication,
  vendorUpdateApplication,

  organizerListEventApplications,

  listVendorApplications,
  organizerListVendorApplications,
  submitApplication,

  API_BASE_DEFAULT,
};

export default ApplicationsAPI;
