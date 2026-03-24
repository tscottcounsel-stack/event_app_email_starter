// vendor-portal/src/figma/components/api/diagram.ts
import { readSession } from "../../../auth/authStorage";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

export type Booth = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  status?: string;
  category?: string;
  price?: number;
  companyName?: string;
};

export type BoothStateByIdEntry = {
  status?: "available" | "reserved" | "assigned" | "blocked" | "paid" | string;
  applicationId?: number;
  vendorEmail?: string;
  vendorName?: string;
  paymentStatus?: "unpaid" | "pending" | "paid" | "expired" | "unknown" | string;
  reservedUntil?: string | null;
};

export type DiagramResponse = {
  diagram: any;
  version: number;
  booth_state_by_id?: Record<string, BoothStateByIdEntry>;
};

function normalize(data: any): DiagramResponse {
  const raw =
    data?.diagram ??
    data?.event?.diagram ??
    data?.data?.diagram ??
    data?.event ??
    data?.data ??
    data ??
    null;

  const looksLikeDiagram =
    raw &&
    typeof raw === "object" &&
    (
      Array.isArray(raw?.levels) ||
      Array.isArray(raw?.booths) ||
      raw?.canvas ||
      Array.isArray(raw?.elements)
    );

  const boothStateById =
    data?.booth_state_by_id && typeof data.booth_state_by_id === "object"
      ? data.booth_state_by_id
      : raw?.booth_state_by_id && typeof raw.booth_state_by_id === "object"
      ? raw.booth_state_by_id
      : {};

  return {
    diagram: looksLikeDiagram ? raw : { elements: [], meta: {} },
    version:
      data?.version ??
      raw?.version ??
      0,
    booth_state_by_id: boothStateById,
  };
}
function authHeaders(): Record<string, string> {
  const s = readSession();
  const h: Record<string, string> = { Accept: "application/json" };
  if (s?.accessToken) h.Authorization = `Bearer ${s.accessToken}`;
  return h;
}

async function readJsonSafe(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json().catch(() => null);
  return res.text().catch(() => null);
}

/**
 * ✅ Canonical organizer endpoints (no /layout probing)
 * GET  /organizer/events/:eventId/diagram
 * PUT  /organizer/events/:eventId/diagram
 */
function organizerDiagramUrl(eventId: string | number) {
  const id = encodeURIComponent(String(eventId));
  return `${API_BASE}/organizer/events/${id}/diagram`;
}

/**
 * ✅ Canonical public/vendor endpoint
 * GET /events/:eventId/diagram
 */
function publicDiagramUrl(eventId: string | number) {
  const id = encodeURIComponent(String(eventId));
  return `${API_BASE}/events/${id}/diagram`;
}

// ---------------- Organizer API ----------------

export async function getEventDiagram(
  eventId: string | number
): Promise<DiagramResponse> {
  const url = organizerDiagramUrl(eventId);

  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const body = await readJsonSafe(res);
    // eslint-disable-next-line no-console
    console.warn("getEventDiagram failed:", url, res.status, body);
    return normalize(null);
  }

  return normalize(await res.json().catch(() => null));
}

export async function saveEventDiagram(
  eventId: string | number,
  diagram: any,
  version?: number | null
): Promise<DiagramResponse> {
  const url = organizerDiagramUrl(eventId);

  const payload = { diagram, version: version ?? null };

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await readJsonSafe(res);
    throw new Error(
      `Failed to save diagram (PUT ${res.status}) ${
        body ? JSON.stringify(body) : ""
      }`
    );
  }

  return normalize(await res.json().catch(() => null));
}

// ---------------- Public/Vendor API ----------------

export async function getPublicEventDiagram(
  eventId: string | number
): Promise<DiagramResponse> {
  const url = publicDiagramUrl(eventId);

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await readJsonSafe(res);
    // eslint-disable-next-line no-console
    console.warn("getPublicEventDiagram failed:", url, res.status, body);
    return normalize(null);
  }

  return normalize(await res.json().catch(() => null));
}

// Back-compat exports for older callers
export const getDiagram = async (eventId: number) => getEventDiagram(eventId);
export const saveDiagram = async (eventId: number, payload: DiagramResponse) =>
  saveEventDiagram(eventId, payload.diagram, payload.version);
