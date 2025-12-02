// src/api/vendorDiagram.ts
import { apiGet } from "./api";
import type { DiagramEnvelope } from "./diagramTypes";

/**
 * Read-only vendor diagram fetcher.
 * Vendors can see the map but can’t edit it.
 */
export async function getVendorDiagram(
  eventId: number
): Promise<DiagramEnvelope> {
  return apiGet<DiagramEnvelope>(`/vendor/events/${eventId}/diagram`);
}
