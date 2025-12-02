// src/api/vendorEvents.ts
import { apiGet, apiPost } from "./api";

export interface VendorEvent {
  id: number;
  title: string;
  description: string;
  date: string;
  location: string;
  city: string;
  kind: string;
}

// List events vendor can apply to
export async function listVendorEvents(): Promise<VendorEvent[]> {
  return apiGet("/vendor/events");
}

// Get event details
export async function getVendorEvent(eventId: number): Promise<VendorEvent> {
  return apiGet(`/vendor/events/${eventId}`);
}

// Get event diagram for vendor (READ-ONLY)
export async function getVendorEventDiagram(eventId: number) {
  return apiGet(`/vendor/events/${eventId}/diagram`);
}

// Apply to a booth
export async function applyToBooth(eventId: number, boothLabel: string) {
  return apiPost(`/vendor/events/${eventId}/apply`, {
    boothLabel,
  });
}
