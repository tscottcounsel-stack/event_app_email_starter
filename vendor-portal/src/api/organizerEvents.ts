// src/api/organizerEvents.ts
//
// Organizer event API helpers.
// This file exists because multiple pages import from it.
// It MUST export getOrganizerEventDashboardStats (your current crash).

import { apiGet, apiPost, apiPatch } from "../api";

export type OrganizerEvent = {
  id: number;
  title: string;
  description?: string | null;
  location?: string | null;
  city?: string | null;
  date?: string | null;
  kind?: string | null;

  // Optional capacity fields (exist in your schema, but may be null)
  max_vendor_slots?: number | null;
  total_vendor_capacity?: number | null;
  category_vendor_capacity?: any | null;

  business_only?: boolean;
  badge_required?: boolean;

  created_at?: string;
  updated_at?: string;
};

export type OrganizerDashboardStats = {
  // Keep flexible because different backends return different shapes
  [k: string]: any;
};

export async function listOrganizerEvents(): Promise<OrganizerEvent[]> {
  const data = await apiGet("/organizer/events");
  // some endpoints return array, some return { items }
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function getOrganizerEvent(eventId: number): Promise<OrganizerEvent> {
  return apiGet(`/organizer/events/${eventId}`);
}

export async function createOrganizerEvent(payload: Partial<OrganizerEvent>) {
  return apiPost("/organizer/events", payload);
}

export async function updateOrganizerEvent(eventId: number, payload: Partial<OrganizerEvent>) {
  return apiPatch(`/organizer/events/${eventId}`, payload);
}

/**
 * IMPORTANT: This is the export your OrganizerDashboard.tsx is importing.
 *
 * Because your backend endpoints have changed over time, this function tries
 * a few common routes in order.
 */
export async function getOrganizerEventDashboardStats(): Promise<OrganizerDashboardStats> {
  const candidates = [
    "/organizer/dashboard/stats",
    "/organizer/events/stats",
    "/organizer/stats",
    "/stats",
  ];

  let lastErr: any = null;

  for (const path of candidates) {
    try {
      const data = await apiGet(path);
      return data ?? {};
    } catch (e: any) {
      lastErr = e;
    }
  }

  // If none worked, throw the last error so the UI can show something useful
  throw lastErr ?? new Error("Failed to load organizer dashboard stats.");
}
