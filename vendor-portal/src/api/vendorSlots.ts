// src/api/vendorSlots.ts
import { apiGet } from "../api";

export type VendorSlot = {
  id: number;
  event_id: number;
  label: string;

  price_cents?: number | null;
  width?: number | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;

  meta?: Record<string, any> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * Vendor-facing list of slots/booths for an event.
 * Backend route: GET /vendor/events/{eventId}/slots
 */
export async function listVendorSlots(eventId: number): Promise<VendorSlot[]> {
  return apiGet(`/vendor/events/${eventId}/slots`);
}
