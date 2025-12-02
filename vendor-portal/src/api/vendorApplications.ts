// src/api/vendorApplications.ts

import { apiGet, apiPost } from "../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VendorApplicationStatus = "pending" | "approved" | "rejected";
export type VendorPaymentStatus = "unpaid" | "paid" | "partial";

export type VendorApplicationListItem = {
  id: number;
  event_id: number;
  event_title: string;
  status: VendorApplicationStatus;
  payment_status: VendorPaymentStatus;
  total_due_cents: number | null;
  total_paid_cents: number | null;
  submitted_at: string | null;
};

export type VendorApplicationDetail = VendorApplicationListItem & {
  answers?: Record<string, unknown> | null;
};

export type VendorApplicationCreatePayload = {
  notes?: string;
  [key: string]: unknown;
};

// Dashboard summary for the vendor home page
export type VendorDashboardSummary = {
  total_applications: number;
  pending: number;
  approved: number;
  rejected: number;
  total_due_cents: number;
  total_paid_cents: number;
};

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** List ALL applications for the current vendor. */
export async function listVendorApplications(): Promise<VendorApplicationListItem[]> {
  return apiGet("/vendor/applications");
}

/** List applications for a specific event for the current vendor. */
export async function listVendorApplicationsForEvent(
  eventId: number,
): Promise<VendorApplicationListItem[]> {
  const all = (await apiGet("/vendor/applications")) as VendorApplicationListItem[];
  return all.filter((app) => app.event_id === eventId);
}

/** Alias for older code that imports getVendorApplicationsForEvent. */
export async function getVendorApplicationsForEvent(
  eventId: number,
): Promise<VendorApplicationListItem[]> {
  return listVendorApplicationsForEvent(eventId);
}

/** Get a single application by id. */
export async function getVendorApplication(
  applicationId: number,
): Promise<VendorApplicationDetail> {
  return apiGet(`/vendor/applications/${applicationId}`);
}

/** Create/submit an application for a given event. */
export async function createVendorApplication(
  eventId: number,
  payload: VendorApplicationCreatePayload,
): Promise<VendorApplicationDetail> {
  return apiPost(`/vendor/events/${eventId}/apply`, {
    event_id: eventId,
    ...payload,
  });
}

/** Vendor dashboard summary (used on VendorDashboard.tsx). */
export async function getVendorDashboardSummary(): Promise<VendorDashboardSummary> {
  return apiGet("/vendor/dashboard-summary");
}

/**
 * applyForEventSlot – very flexible wrapper so any existing call signature works.
 *
 * Common patterns we support:
 *   applyForEventSlot(eventId, slotId)
 *   applyForEventSlot(eventId, { assigned_slot_id, ...extra })
 *   applyForEventSlot(eventId, slotId, { ...extra })
 */
export async function applyForEventSlot(
  ...args: any[]
): Promise<VendorApplicationDetail> {
  const [eventId, arg2, arg3] = args;

  if (!eventId) {
    throw new Error("applyForEventSlot: eventId is required as first argument");
  }

  let payload: any = {};

  if (typeof arg2 === "number") {
    // (eventId, slotId, maybePayload)
    payload = { assigned_slot_id: arg2, ...(arg3 ?? {}) };
  } else if (typeof arg2 === "object" && arg2 !== null) {
    // (eventId, payloadObject)
    payload = arg2;
  }

  return createVendorApplication(eventId, payload);
}
