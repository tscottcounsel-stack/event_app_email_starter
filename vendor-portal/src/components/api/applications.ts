// src/components/api/applications.ts
import { readSession } from "../../auth/authStorage";

const API_BASE =
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

  status?: string | null; // "draft" | "submitted" | "approved" | "rejected"
  payment_status?: string | null; // "unpaid" | "paid"

  checked?: Record<string, boolean> | null;

  /**
   * BACKEND SHAPE:
   * apps may include documents and/or docs. We'll support both.
   */
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;

  notes?: string | null;

  submitted_at?: string | null;
  updated_at?: string | null;
};

export type ListVendorApplicationsResponse = {
  applications: ServerApplication[];
};

export type ApplyBody = {
  booth_id?: string | null;
  booth_category_id?: string | null;
  checked?: Record<string, boolean>;
  notes?: string;
};

export type ProgressBody = {
  checked?: Record<string, boolean>;
  notes?: string;

  /**
   * We want to persist doc metadata now.
   * Backend accepts either "documents" or "docs" and normalizes.
   * We'll send BOTH to avoid regressions.
   */
  documents?: Record<string, UploadedDocMeta | null>;
  docs?: Record<string, UploadedDocMeta | null>;
};

/* ---------------- Internals ---------------- */

function mustHaveSession() {
  const s = readSession();
  if (!s?.accessToken) throw new Error("Missing auth session (accessToken).");
  return s;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const s = mustHaveSession();
  return {
    Accept: "application/json",
    Authorization: `Bearer ${s.accessToken}`,
    ...(extra || {}),
  };
}

function buildVendorHeaders(extra?: Record<string, string>): Record<string, string> {
  const s = mustHaveSession();

  // Backend identity checks require x-user-email OR x-user-id on vendor endpoints
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${s.accessToken}`,
  };

  if (s.email) headers["x-user-email"] = s.email;

  return { ...headers, ...(extra || {}) };
}

async function fetchJsonOrThrow(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();

  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data as any)?.detail
          ? String((data as any).detail)
          : `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

/**
 * Hard guard to prevent URLs like /undefined/
 */
function mustInt(name: string, v: any): number {
  const n = typeof v === "string" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number. Got: ${String(v)}`);
  }
  return n;
}

function idPath(name: string, v: any): string {
  return String(mustInt(name, v));
}

function unwrapApplication(data: any): ServerApplication {
  return (data as any)?.application
    ? ((data as any).application as ServerApplication)
    : (data as ServerApplication);
}

/** Accept both calling styles safely */
function isObj(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pickAppIdFromUnknownShape(v: any): any {
  return (
    v?.applicationId ??
    v?.appId ??
    v?.application_id ??
    v?.id ??
    v?.application?.id ??
    v?.application?.appId ??
    v?.data?.id ??
    v?.data?.appId
  );
}

/* ---------------- Optional URL helpers ---------------- */

export function vendorPutProgressUrl(appId: any) {
  return `${API_BASE}/vendor/applications/${idPath("appId", appId)}/progress`;
}

export function vendorGetProgressUrl(appId: any) {
  return `${API_BASE}/vendor/applications/${idPath("appId", appId)}/progress`;
}

/* ---------------- Vendor: list applications ---------------- */

export async function listVendorApplications(): Promise<ServerApplication[]> {
  const data = await fetchJsonOrThrow(`${API_BASE}/vendor/applications`, {
    method: "GET",
    headers: buildVendorHeaders(),
  });

  if (Array.isArray((data as any)?.applications)) return (data as any).applications;
  if (Array.isArray(data)) return data as any;
  return [];
}

/* ---------------- Vendor: get application ---------------- */
/**
 * Supports BOTH:
 *  - vendorGetApplication({ applicationId })
 *  - vendorGetApplication(eventId, appId)  // eventId ignored, kept for compatibility
 *  - vendorGetApplication(appId)          // also supported
 */
export async function vendorGetApplication(
  a1: any,
  a2?: any
): Promise<ServerApplication> {
  let applicationId: any;

  if (isObj(a1)) {
    applicationId = a1.applicationId;
  } else if (a2 != null) {
    applicationId = a2; // called as (eventId, appId)
  } else {
    applicationId = a1; // called as (appId)
  }

  const appId = idPath("applicationId", applicationId);

  const data = await fetchJsonOrThrow(`${API_BASE}/vendor/applications/${appId}`, {
    method: "GET",
    headers: buildVendorHeaders(),
  });

  return unwrapApplication(data);
}

/* ---------------- Vendor: create application (apply) ---------------- */

export async function vendorApplyToEvent(args: {
  eventId: string | number;
  body: ApplyBody;
}): Promise<ServerApplication> {
  const eventId = idPath("eventId", args.eventId);

  const data = await fetchJsonOrThrow(`${API_BASE}/applications/events/${eventId}/apply`, {
    method: "POST",
    headers: buildVendorHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(args.body || {}),
  });

  return unwrapApplication(data);
}

/* ---------------- Vendor: get or create draft (compat) ---------------- */
/**
 * Supports BOTH:
 *  - vendorGetOrCreateDraftApplication({ eventId })
 *  - vendorGetOrCreateDraftApplication(eventId)
 */
export async function vendorGetOrCreateDraftApplication(
  a1: any
): Promise<ServerApplication> {
  const eventId = isObj(a1) ? a1.eventId : a1;
  return vendorApplyToEvent({ eventId, body: {} });
}

export async function vendorGetOrCreateDraftApplicationLegacy(
  a1: any
): Promise<ServerApplication> {
  return vendorGetOrCreateDraftApplication(a1);
}

/* ---------------- Vendor: save progress (checked/docs/notes) ---------------- */
/**
 * Supports BOTH:
 *  - vendorSaveProgress({ applicationId, body })
 *  - vendorSaveProgress(eventId, { appId, checked, docs, documents, notes })
 *
 * NOTE: vendor endpoints are keyed by applicationId, not eventId,
 * but some callers pass eventId as the first arg. We ignore it safely.
 */
export async function vendorSaveProgress(
  a1: any,
  a2?: any
): Promise<ServerApplication> {
  let applicationId: any;
  let body: any;

  if (isObj(a1)) {
    // { applicationId, body }
    applicationId = a1.applicationId;
    body = a1.body || {};
  } else {
    // (eventId, payload) OR (payload)
    const payload = a2 != null ? a2 : a1;
    applicationId = payload?.applicationId ?? payload?.appId ?? pickAppIdFromUnknownShape(payload);
    body = payload || {};
  }

  const applicationIdPath = idPath("applicationId", applicationId);

  const documents = body.documents ?? body.docs;

  const payload: any = {
    checked: body.checked,
    notes: body.notes,
  };

  if (documents !== undefined) {
    payload.documents = documents;
    payload.docs = documents;
  }

  const data = await fetchJsonOrThrow(
    `${API_BASE}/vendor/applications/${applicationIdPath}/progress`,
    {
      method: "PUT",
      headers: buildVendorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }
  );

  const appFromResp = (data as any)?.application;
  if (appFromResp) return appFromResp as ServerApplication;

  const appId =
    (data as any)?.app_id ??
    (data as any)?.appId ??
    (data as any)?.id ??
    applicationIdPath;

  if (appId) {
    const fresh = await fetchJsonOrThrow(`${API_BASE}/vendor/applications/${idPath("applicationId", appId)}`, {
      method: "GET",
      headers: buildVendorHeaders(),
    });
    return unwrapApplication(fresh);
  }

  return unwrapApplication(data);
}

export async function vendorUpdateApplication(
  a1: any,
  a2?: any
): Promise<ServerApplication> {
  return vendorSaveProgress(a1 as any, a2 as any);
}

/* ---------------- Vendor: submit application (compat) ---------------- */

export async function submitApplication(args: {
  applicationId: string | number;
}): Promise<ServerApplication> {
  const applicationId = idPath("applicationId", args.applicationId);

  const data = await fetchJsonOrThrow(`${API_BASE}/vendor/applications/${applicationId}/submit`, {
    method: "POST",
    headers: buildVendorHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });

  return unwrapApplication(data);
}

/* ---------------- Organizer: application helpers (NEW) ---------------- */
/**
 * Requires backend endpoint:
 * GET /organizer/events/{event_id}/applications/{app_id}
 */
export async function organizerGetApplication(args: {
  eventId: string | number;
  appId: string | number;
}): Promise<ServerApplication> {
  const eventId = idPath("eventId", args.eventId);
  const appId = idPath("appId", args.appId);

  const data = await fetchJsonOrThrow(`${API_BASE}/organizer/events/${eventId}/applications/${appId}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  return unwrapApplication(data);
}

export async function organizerApproveApplication(args: {
  appId: string | number;
}): Promise<ServerApplication> {
  const appId = idPath("appId", args.appId);

  const data = await fetchJsonOrThrow(`${API_BASE}/organizer/applications/${appId}/approve`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });

  return unwrapApplication(data);
}

export async function organizerRejectApplication(args: {
  appId: string | number;
}): Promise<ServerApplication> {
  const appId = idPath("appId", args.appId);

  const data = await fetchJsonOrThrow(`${API_BASE}/organizer/applications/${appId}/reject`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });

  return unwrapApplication(data);
}
