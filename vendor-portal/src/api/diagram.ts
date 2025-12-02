// src/api/diagram.ts
import { apiGet, apiPost, apiPut } from "../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoothRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramBody {
  boothMap: Record<string, BoothRect>;
}

export interface DiagramOut {
  event_id: number;
  version: number;
  diagram: DiagramBody;
  tag?: string | null;
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TagInfo {
  tag: string;
  latest_version: number;
  latest_created_at: string;
}

export interface HistItem {
  version: number;
  tag?: string | null;
  reason?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Organizer diagram helpers
// ---------------------------------------------------------------------------

export async function getDiagram(eventId: number): Promise<DiagramOut> {
  return apiGet<DiagramOut>(`/organizer/events/${eventId}/diagram`);
}

/**
 * Save/overwrite the current organizer diagram for an event.
 *
 * IMPORTANT: This matches how DiagramEditor calls it:
 *   saveOrganizerDiagram(eventId, { diagram: { boothMap }, expect_version: ... })
 */
export async function saveOrganizerDiagram(
  eventId: number,
  body: {
    diagram: { boothMap: Record<string, BoothRect> };
    expect_version: number | null;
    tag?: string;
    reason?: string;
  }
): Promise<DiagramOut> {
  return apiPut<DiagramOut>(`/organizer/events/${eventId}/diagram`, body);
}

export async function getTags(eventId: number): Promise<TagInfo[]> {
  return apiGet<TagInfo[]>(`/organizer/events/${eventId}/diagram/tags`);
}

export async function getHistory(params: {
  eventId: number;
  limit?: number;
  order?: "asc" | "desc";
}): Promise<HistItem[]> {
  const { eventId, limit, order } = params;

  const qs = new URLSearchParams();
  if (limit != null) qs.set("limit", String(limit));
  if (order) qs.set("order", order);

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<HistItem[]>(
    `/organizer/events/${eventId}/diagram/history${suffix}`
  );
}

export async function snapshotGuarded(params: {
  eventId: number;
  tag: string;
  reason?: string;
  expectedVersion?: number;
}): Promise<DiagramOut> {
  const { eventId, tag, reason, expectedVersion } = params;

  const body: Record<string, unknown> = { tag };
  if (reason) body.reason = reason;
  // backend expects `expect_version` (no "ed")
  if (typeof expectedVersion === "number") {
    body.expect_version = expectedVersion;
  }

  return apiPost<DiagramOut>(
    `/organizer/events/${eventId}/diagram/snapshot/guarded`,
    body
  );
}

export async function revertToTagGuarded(params: {
  eventId: number;
  tag: string;
  reason?: string;
  expectedVersion?: number;
}): Promise<DiagramOut> {
  const { eventId, tag, reason, expectedVersion } = params;

  const body: Record<string, unknown> = { tag };
  if (reason) body.reason = reason;
  if (typeof expectedVersion === "number") {
    body.expect_version = expectedVersion;
  }

  return apiPost<DiagramOut>(
    `/organizer/events/${eventId}/diagram/revert-to-tag/guarded`,
    body
  );
}

// ---------------------------------------------------------------------------
// Vendor: read-only diagram helper
// ---------------------------------------------------------------------------

export async function getVendorDiagram(eventId: number): Promise<DiagramOut> {
  return apiGet<DiagramOut>(`/vendor/events/${eventId}/diagram`);
}

// ---------------------------------------------------------------------------
// Backwards-compatibility helpers
// ---------------------------------------------------------------------------

// Older components might import `getOrganizerDiagram` instead of `getDiagram`.
export async function getOrganizerDiagram(
  eventId: number
): Promise<DiagramOut> {
  return getDiagram(eventId);
}

// Older components might import `createSnapshot` instead of `snapshotGuarded`.
type CreateSnapshotParams = {
  eventId: number;
  tag: string;
  reason?: string;
  expectedVersion?: number;
};

export async function createSnapshot(
  eventIdOrParams: number | CreateSnapshotParams,
  tagMaybe?: string,
  reasonMaybe?: string
): Promise<DiagramOut> {
  let params: CreateSnapshotParams;

  if (typeof eventIdOrParams === "number") {
    params = {
      eventId: eventIdOrParams,
      tag: tagMaybe ?? "snapshot",
      reason: reasonMaybe,
    };
  } else {
    params = eventIdOrParams;
  }

  if (!params.tag) {
    params.tag = "snapshot";
  }

  return snapshotGuarded({
    eventId: params.eventId,
    tag: params.tag,
    reason: params.reason ?? "snapshot",
    expectedVersion: params.expectedVersion,
  });
}
