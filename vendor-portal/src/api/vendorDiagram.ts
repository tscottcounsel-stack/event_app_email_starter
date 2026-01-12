// src/api/vendorDiagram.ts
import { apiGet } from "../api";
import type { DiagramEnvelope } from "./diagramTypes";

/**
 * Vendor diagram fetcher.
 * Prefer vendor endpoint, but FALLBACK to public endpoint if vendor returns null diagram.
 */
export async function getVendorDiagram(eventId: number): Promise<DiagramEnvelope> {
  // 1) Try vendor endpoint first (future-proof)
  try {
    const vend = await apiGet<DiagramEnvelope>(`/vendor/events/${eventId}/diagram`);
    if (vend && vend.diagram) return vend;
  } catch {
    // ignore -> fallback to public
  }

  // 2) Fallback to public (your current working source of truth)
  return apiGet<DiagramEnvelope>(`/public/events/${eventId}/diagram`);
}
