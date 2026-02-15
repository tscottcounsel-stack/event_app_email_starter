// vendor-portal/src/figma/components/api/diagram.ts
import { readSession } from "../../../auth/authStorage";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

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
};

export type DiagramResponse = {
  diagram: any;
  version: number;
};

function normalize(data: any): DiagramResponse {
  return {
    diagram: data?.diagram ?? { elements: [], meta: {} },
    version: data?.version ?? 0,
  };
}

function authHeaders(): Record<string, string> {
  const s = readSession();
  const h: Record<string, string> = { Accept: "application/json" };
  if (s?.accessToken) h.Authorization = `Bearer ${s.accessToken}`;
  return h;
}

// Organizer diagram endpoints (what BoothMapEditor uses)
function organizerDiagramUrl(eventId: string | number) {
  return `${API_BASE}/organizer/events/${encodeURIComponent(String(eventId))}/diagram`;
}

export async function getEventDiagram(eventId: string | number): Promise<DiagramResponse> {
  const res = await fetch(organizerDiagramUrl(eventId), {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) return normalize(null);
  return normalize(await res.json().catch(() => null));
}

export async function saveEventDiagram(
  eventId: string | number,
  diagram: any,
  version?: number | null
): Promise<DiagramResponse> {
  const payload = { diagram, version: version ?? null };

  // Try PUT first
  let res = await fetch(organizerDiagramUrl(eventId), {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) return normalize(await res.json().catch(() => null));

  // Fallback POST only if PUT is not allowed
  if (res.status === 405) {
    res = await fetch(organizerDiagramUrl(eventId), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Failed to save diagram (POST ${res.status})`);
    return normalize(await res.json().catch(() => null));
  }

  throw new Error(`Failed to save diagram (PUT ${res.status})`);
}

// Back-compat for any other callers
export const getDiagram = async (eventId: number) => getEventDiagram(eventId);
export const saveDiagram = async (eventId: number, payload: DiagramResponse) =>
  saveEventDiagram(eventId, payload.diagram, payload.version);
