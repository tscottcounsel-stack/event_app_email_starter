// src/api/organizerEvents.ts
import { apiGet, apiPost, apiPut } from "../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrganizerEvent = {
  id: number;
  organizer_id: number;
  title: string;
  description?: string | null;
  date?: string | null;        // "YYYY-MM-DD" or ISO string
  location?: string | null;
  city?: string | null;
  kind?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type OrganizerEventDashboardStats = {
  event_id: number;
  total_applications: number;
  pending: number;
  approved: number;
  rejected: number;
  total_due_cents: number;
  total_paid_cents: number;
};

export type EventCreatePayload = {
  title: string;
  description?: string;
  date?: string;       // "YYYY-MM-DD"
  location?: string;
  city?: string;
  kind?: string;
};

export type EventUpdatePayload = Partial<EventCreatePayload>;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// List all events for the current organizer
export async function listOrganizerEvents(): Promise<OrganizerEvent[]> {
  return apiGet("/organizer/events");
}

// Get a single event
export async function getOrganizerEvent(
  eventId: number
): Promise<OrganizerEvent> {
  return apiGet(`/organizer/events/${eventId}`);
}

// Create a new event
export async function createOrganizerEvent(
  payload: EventCreatePayload
): Promise<OrganizerEvent> {
  return apiPost("/organizer/events", payload);
}

// Update an existing event
export async function updateOrganizerEvent(
  eventId: number,
  payload: EventUpdatePayload
): Promise<OrganizerEvent> {
  return apiPut(`/organizer/events/${eventId}`, payload);
}

// Per-event dashboard stats
export async function getOrganizerEventDashboardStats(
  eventId: number
): Promise<OrganizerEventDashboardStats> {
  return apiGet(`/organizer/events/${eventId}/dashboard-stats`);
}
