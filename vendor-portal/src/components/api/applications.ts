// src/components/api/applications.ts
import { readSession } from "../../auth/authStorage";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

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
  status?: string | null;
  payment_status?: string | null;
  checked?: Record<string, boolean> | null;
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;
  notes?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

export type ApplyBody = {
  booth_id?: string | null;
  booth_price?: number | null;
  booth_category_id?: string | null;
  checked?: Record<string, boolean>;
  notes?: string;
};

type ApiError = Error & {
  status?: number;
  data?: any;
  url?: string;
};

function mustHaveSession() {
  const s = readSession();
  if (!s?.accessToken) throw new Error("Missing auth session (accessToken).");
  return s;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const s = mustHaveSession();
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${s.accessToken}`,
  };
  if (s.email) headers["x-user-email"] = s.email;
  return { ...headers, ...(extra || {}) };
}

function makeApiError(message: string, extras?: Partial<ApiError>): ApiError {
  const err = new Error(message) as ApiError;
  if (extras) Object.assign(err, extras);
  return err;
}

function parseMaybeJson(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractServerMessage(data: any, status: number) {
  if (typeof data === "string" && data.trim()) return data;
  if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  if (Array.isArray(data?.detail)) {
    try {
      return JSON.stringify(data.detail);
    } catch {
      return `Request failed (${status})`;
    }
  }
  if (data && typeof data === "object") {
    try {
      return JSON.stringify(data);
    } catch {
      return `Request failed (${status})`;
    }
  }
  return `Request failed (${status})`;
}

async function fetchJsonOrThrow(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = parseMaybeJson(text);

  if (!res.ok) {
    const message = extractServerMessage(data, res.status);
    throw makeApiError(message, {
      status: res.status,
      data,
      url,
    });
  }

  return data;
}

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
  if ((data as any)?.application) return (data as any).application as ServerApplication;
  if ((data as any)?.data?.application) return (data as any).data.application as ServerApplication;
  if ((data as any)?.data && typeof (data as any).data === "object") {
    return (data as any).data as ServerApplication;
  }
  return data as ServerApplication;
}

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

function normalizeDocumentsShape(
  docs: any
): Record<string, UploadedDocMeta[]> | undefined {
  if (docs === undefined) return undefined;
  if (!docs || typeof docs !== "object") return {};

  const out: Record<string, UploadedDocMeta[]> = {};

  Object.entries(docs).forEach(([key, value]) => {
    if (!value) return;

    const items = Array.isArray(value) ? value : [value];
    const normalized = items
      .map((item: any) => {
        if (!item || typeof item !== "object") return null;
        return {
          name: String(item?.name || item?.filename || key || "file"),
          size: Number(item?.size || 0),
          type: item?.type ? String(item.type) : "",
          lastModified:
            item?.lastModified != null
              ? Number(item.lastModified)
              : item?.last_modified != null
              ? Number(item.last_modified)
              : 0,
        } as UploadedDocMeta;
      })
      .filter(Boolean) as UploadedDocMeta[];

    if (normalized.length > 0) out[key] = normalized;
  });

  return out;
}
function buildProgressPayload(body: any) {
  const documents = normalizeDocumentsShape(body?.documents ?? body?.docs);

  const payload: Record<string, any> = {};

  if (body?.checked !== undefined) payload.checked = body.checked;
  if (body?.notes !== undefined) payload.notes = body.notes;

  if (body?.booth_id !== undefined) payload.booth_id = body.booth_id;
  if (body?.boothId !== undefined) payload.booth_id = body.boothId;
  if (body?.booth_price !== undefined) payload.booth_price = body.booth_price;

  if (body?.booth_category_id !== undefined) payload.booth_category_id = body.booth_category_id;
  if (body?.boothCategoryId !== undefined) payload.booth_category_id = body.boothCategoryId;

  if (documents !== undefined) {
    payload.documents = documents;
    payload.docs = documents;
  }

  return payload;
}

export async function listVendorApplications(): Promise<ServerApplication[]> {
  const data = await fetchJsonOrThrow(`${API_BASE}/vendor/applications`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (Array.isArray((data as any)?.applications)) return (data as any).applications;
  if (Array.isArray((data as any)?.data?.applications)) return (data as any).data.applications;
  if (Array.isArray(data)) return data as any;
  return [];
}

export async function vendorGetApplication(a1: any, a2?: any): Promise<ServerApplication> {
  let applicationId: any;
  if (isObj(a1)) applicationId = a1.applicationId;
  else if (a2 != null) applicationId = a2;
  else applicationId = a1;

  const appId = idPath("applicationId", applicationId);

  try {
    const data = await fetchJsonOrThrow(`${API_BASE}/vendor/applications/${appId}`, {
      method: "GET",
      headers: buildAuthHeaders(),
    });
    return unwrapApplication(data);
  } catch (e: any) {
    const status = Number(e?.status || 0);
    const msg = String(e?.message || "").toLowerCase();
    const isMissingSingleRoute =
      status === 404 ||
      msg.includes("not found") ||
      msg.includes("404") ||
      msg.includes("method not allowed");

    if (!isMissingSingleRoute) throw e;

    const apps = await listVendorApplications();
    const found = apps.find((a: any) => String(a?.id ?? "") === String(appId));
    if (found) return unwrapApplication(found);

    throw new Error("Application not found");
  }
}

export async function vendorApplyToEvent(args: {
  eventId: string | number;
  body: ApplyBody;
}): Promise<ServerApplication> {
  const eventId = idPath("eventId", args.eventId);
  const data = await fetchJsonOrThrow(`${API_BASE}/applications/events/${eventId}/apply`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(args.body || {}),
  });
  return unwrapApplication(data);
}

export async function vendorGetOrCreateDraftApplication(a1: any): Promise<ServerApplication> {
  const eventId = isObj(a1) ? a1.eventId : a1;
  const eventIdPath = idPath("eventId", eventId);

  const apps = await listVendorApplications();

  const sameEventApps = apps.filter(
    (a) => String(a?.event_id ?? "") === String(eventIdPath)
  );

  const statusRank = (status: any) => {
    const s = String(status || "").toLowerCase().trim();
    if (s === "approved") return 4;
    if (s === "submitted") return 3;
    if (s === "draft") return 2;
    if (s === "rejected") return 1;
    return 0;
  };

  const paymentRank = (payment: any) => {
    const p = String(payment || "").toLowerCase().trim();
    if (p === "paid") return 3;
    if (p === "pending") return 2;
    if (p === "unpaid") return 1;
    return 0;
  };

  const existing = sameEventApps.sort((a, b) => {
    const aStatus = statusRank(a?.status);
    const bStatus = statusRank(b?.status);
    if (bStatus !== aStatus) return bStatus - aStatus;

    const aPayment = paymentRank((a as any)?.payment_status);
    const bPayment = paymentRank((b as any)?.payment_status);
    if (bPayment !== aPayment) return bPayment - aPayment;

    const aTime = Date.parse(
      String(a?.updated_at || a?.submitted_at || a?.created_at || 0)
    );
    const bTime = Date.parse(
      String(b?.updated_at || b?.submitted_at || b?.created_at || 0)
    );
    if (bTime !== aTime) return bTime - aTime;

    return Number(b?.id || 0) - Number(a?.id || 0);
  })[0];

  if (existing) return unwrapApplication(existing);

  return vendorApplyToEvent({ eventId: eventIdPath, body: {} });
}
export async function vendorGetOrCreateDraftApplicationLegacy(a1: any): Promise<ServerApplication> {
  return vendorGetOrCreateDraftApplication(a1);
}

export async function vendorSaveProgress(...args: any[]): Promise<ServerApplication> {
  const [a1, a2] = args;

  const isObj = (v: any) => v != null && typeof v === "object" && !Array.isArray(v);

  let applicationId: string | number | undefined;
  let body: any;

  if (isObj(a1) && ("applicationId" in a1 || "appId" in a1 || "body" in a1)) {
    applicationId =
      a1.applicationId ?? a1.appId ?? pickAppIdFromUnknownShape(a1.body ?? a1);
    body = a1.body ?? a1;
  } else {
    const payload = a2 != null ? a2 : a1;
    applicationId =
      payload?.applicationId ?? payload?.appId ?? pickAppIdFromUnknownShape(payload);
    body = payload || {};
  }

  const applicationIdPath = idPath("applicationId", applicationId);
  const payload = buildProgressPayload(body);
  const headers = buildAuthHeaders({ "Content-Type": "application/json" });

  try {
    const patchData = await fetchJsonOrThrow(
      `${API_BASE}/vendor/applications/${applicationIdPath}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      }
    );

    const patched = unwrapApplication(patchData);
    if (patched?.id) return patched;
  } catch (e: any) {
    const status = Number(e?.status || 0);
    if (status !== 404 && status !== 405) throw e;
  }

  const progressData = await fetchJsonOrThrow(
    `${API_BASE}/vendor/applications/${applicationIdPath}/progress`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    }
  );

  const app = unwrapApplication(progressData);
  if (app?.id) return app;

  throw new Error("Failed to save application progress.");
}

export async function organizerGetApplication(args: {
  eventId: string | number;
  appId: string | number;
}): Promise<ServerApplication> {
  const eventId = idPath("eventId", args.eventId);
  const appId = idPath("appId", args.appId);
  const data = await fetchJsonOrThrow(
    `${API_BASE}/organizer/events/${eventId}/applications/${appId}`,
    {
      method: "GET",
      headers: buildAuthHeaders(),
    }
  );
  return unwrapApplication(data);
}

export async function vendorUpdateApplication(args: {
  applicationId: string | number;
  booth_id?: string | null;
  booth_price?: number | null;
  checked?: Record<string, boolean>;
  docs?: Record<string, any>;
  documents?: Record<string, any>;
  booth_category_id?: string | null;
  notes?: string;
}): Promise<ServerApplication> {
  const applicationId = idPath("applicationId", args.applicationId);
  const payload = buildProgressPayload(args);

  const data = await fetchJsonOrThrow(
    `${API_BASE}/vendor/applications/${applicationId}`,
    {
      method: "PATCH",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }
  );

  return unwrapApplication(data);
}

export async function organizerApproveApplication(args: {
  appId: string | number;
}): Promise<ServerApplication> {
  const appId = idPath("appId", args.appId);

  const data = await fetchJsonOrThrow(
    `${API_BASE}/organizer/applications/${appId}/approve`,
    {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    }
  );

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

/* ---------------- Payment Workflow Extensions ---------------- */

export async function vendorMarkPaymentSent(args: {
  applicationId: string | number;
}) {
  const applicationId = idPath("applicationId", args.applicationId);

  const data = await fetchJsonOrThrow(
    `${API_BASE}/vendor/applications/${applicationId}/mark-payment-sent`,
    {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    }
  );

  return unwrapApplication(data);
}

export async function organizerConfirmPayment(args: {
  appId: string | number;
}) {
  const appId = idPath("appId", args.appId);

  const data = await fetchJsonOrThrow(
    `${API_BASE}/organizer/applications/${appId}/confirm-payment`,
    {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    }
  );

  return unwrapApplication(data);
}





