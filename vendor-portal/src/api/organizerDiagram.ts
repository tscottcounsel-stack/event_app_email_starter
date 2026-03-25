// src/api/organizerDiagram.ts
import { apiGet, apiPut } from "../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagramBooth = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priceCents?: number | null;
  status?: string | null;
  // link to a real application if assigned
  assignedApplicationId?: number | null;
};

export type DiagramBody = {
  width: number;
  height: number;
  boothMap: Record<string, DiagramBooth>;
};

export type OrganizerDiagram = {
  event_id: number;
  version: number | null;
  diagram: DiagramBody | null;
  updated_at: string | null;
};

export type SaveDiagramPayload = {
  diagram: DiagramBody;
  // optimistic concurrency; backend expects snake_case
  expect_version?: number | null;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeBody(raw: any): DiagramBody {
  const inner =
    raw && typeof raw === "object" && "diagram" in raw
      ? (raw.diagram as any)
      : raw;

  const width =
    typeof inner?.width === "number"
      ? inner.width
      : typeof inner?.w === "number"
      ? inner.w
      : 1200;

  const height =
    typeof inner?.height === "number"
      ? inner.height
      : typeof inner?.h === "number"
      ? inner.h
      : 800;

  const boothMapRaw = inner?.boothMap ?? {};
  const boothMap: Record<string, DiagramBooth> = {};

  for (const [label, value] of Object.entries(boothMapRaw as any)) {
    const b: any = value ?? {};

    const bw =
      typeof b.width === "number"
        ? b.width
        : typeof b.w === "number"
        ? b.w
        : 1;
    const bh =
      typeof b.height === "number"
        ? b.height
        : typeof b.h === "number"
        ? b.h
        : 1;

    boothMap[label] = {
      label,
      x: typeof b.x === "number" ? b.x : 0,
      y: typeof b.y === "number" ? b.y : 0,
      width: bw,
      height: bh,
      priceCents:
        typeof b.priceCents === "number"
          ? b.priceCents
          : typeof b.price_cents === "number"
          ? b.price_cents
          : null,
      status: (b.status as string) ?? null,
      assignedApplicationId:
        typeof b.assignedApplicationId === "number"
          ? b.assignedApplicationId
          : typeof b.assigned_application_id === "number"
          ? b.assigned_application_id
          : null,
    };
  }

  return { width, height, boothMap };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Load organizer diagram for an event.
 * Always returns a normalized body + the current version (if any).
 */
export async function getOrganizerDiagram(
  eventId: number
): Promise<{ version: number | null; body: DiagramBody }> {
  const data = (await apiGet(
    `/organizer/events/${eventId}/diagram`
  )) as OrganizerDiagram | DiagramBody | null;

  // Support both raw organizer shape and plain body
  let version: number | null = null;
  if (data && typeof data === "object" && "event_id" in data) {
    version = (data as OrganizerDiagram).version ?? null;
  }

  const body = normalizeBody(data);
  return { version, body };
}

/**
 * Save a diagram body for an event. Uses optimistic concurrency via expect_version.
 */
export async function saveOrganizerDiagram(
  eventId: number,
  body: DiagramBody,
  opts?: { expectVersion?: number | null }
): Promise<{ version: number | null; body: DiagramBody }> {
  const payload: SaveDiagramPayload = {
    diagram: body,
  };

  if (opts && opts.expectVersion != null) {
    payload.expect_version = opts.expectVersion;
  }

  const data = (await apiPut(
    `/organizer/events/${eventId}/diagram`,
    payload
  )) as OrganizerDiagram | DiagramBody;

  let version: number | null = null;
  if (data && typeof data === "object" && "event_id" in data) {
    version = (data as OrganizerDiagram).version ?? null;
  }

  const normalized = normalizeBody(data);
  return { version, body: normalized };
}





