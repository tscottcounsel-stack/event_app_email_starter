// src/api/organizerSlots.ts
import { apiGet } from "../api";

export type OrganizerSlot = {
  id: number;
  event_id: number;
  label: string;

  price_cents?: number | null;
  width?: number | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;

  meta?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * List all slots/booths for a given event (organizer view).
 * Backend route: GET /organizer/events/{eventId}/slots
 */
export async function listOrganizerSlots(
  eventId: number,
): Promise<OrganizerSlot[]> {
  return apiGet<OrganizerSlot[]>(`/organizer/events/${eventId}/slots`);
}
