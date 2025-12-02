// src/api/organizerApplications.ts

import { apiGet, apiPost } from "./api";

/**
 * ---------------------------------------------------------
 * Local storage helpers for "last selected organizer event"
 * ---------------------------------------------------------
 */

const ORGANIZER_EVENT_ID_KEY = "organizer:selectedEventId";

export interface VendorProfile {
  id?: number | null;
  business_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  description?: string | null;
}

export async function getApplicationVendorProfile(
  applicationId: number,
): Promise<VendorProfile> {
  return apiGet<VendorProfile>(
    `/organizer/applications/${applicationId}/vendor-profile`,
  );
}
export function getStoredEventId(): number | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ORGANIZER_EVENT_ID_KEY);
  if (!raw) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function setStoredEventId(eventId: number | null): void {
  if (typeof window === "undefined") return;

  if (eventId == null) {
    window.localStorage.removeItem(ORGANIZER_EVENT_ID_KEY);
  } else {
    window.localStorage.setItem(ORGANIZER_EVENT_ID_KEY, String(eventId));
  }
}

/**
 * ---------------------------------------------------------
 * Types
 * ---------------------------------------------------------
 */

export type ApplicationStatus = "pending" | "approved" | "rejected";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface OrganizerApplicationSummary {
  event_id: number;
  total_applications: number;
  pending: number;
  approved: number;
  rejected: number;
  total_due_cents: number;
  total_paid_cents: number;
}

export interface OrganizerApplicationItem {
  id: number;
  event_id: number;
  vendor_id: number | null;
  vendor_profile_id: number | null;
  vendor_name: string;
  status: ApplicationStatus;
  payment_status: PaymentStatus;
  total_due_cents: number;
  total_paid_cents: number;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  assigned_slot_id: number | null;
  // allow extra fields from backend
  [key: string]: unknown;
}

export interface OrganizerApplicationsResponse {
  summary: OrganizerApplicationSummary;
  items: OrganizerApplicationItem[];
}

export interface ApplicationFilterParams {
  status?: ApplicationStatus | "all";
  payment_status?: PaymentStatus | "all";
  page?: number;
  page_size?: number;
}

/**
 * ---------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------
 */

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * ---------------------------------------------------------
 * API calls
 * ---------------------------------------------------------
 */

/**
 * List applications for a given event, including summary.
 *   GET /organizer/events/{eventId}/applications
 */
export async function listOrganizerApplications(
  eventId: number,
  filters: ApplicationFilterParams = {},
): Promise<OrganizerApplicationsResponse> {
  const query = buildQuery({
    status: filters.status && filters.status !== "all" ? filters.status : undefined,
    payment_status:
      filters.payment_status && filters.payment_status !== "all"
        ? filters.payment_status
        : undefined,
    page: filters.page,
    page_size: filters.page_size,
  });

  return apiGet<OrganizerApplicationsResponse>(
    `/organizer/events/${eventId}/applications${query}`,
  );
}

/**
 * Get a single application detail for an event.
 *   GET /organizer/events/{eventId}/applications/{applicationId}
 */
export async function getOrganizerApplicationDetail(
  eventId: number,
  applicationId: number,
): Promise<OrganizerApplicationItem> {
  return apiGet<OrganizerApplicationItem>(
    `/organizer/events/${eventId}/applications/${applicationId}`,
  );
}

/**
 * Update application status (pending / approved / rejected).
 *   POST /organizer/events/{eventId}/applications/{applicationId}/status
 *   body: { status: "approved" }
 */
export async function updateApplicationStatus(
  eventId: number,
  applicationId: number,
  status: ApplicationStatus,
): Promise<OrganizerApplicationItem> {
  return apiPost<OrganizerApplicationItem>(
    `/organizer/events/${eventId}/applications/${applicationId}/status`,
    { status },
  );
}

/**
 * Update payment status (unpaid / partial / paid).
 *   POST /organizer/events/{eventId}/applications/{applicationId}/payment-status
 *   body: { payment_status: "paid" }
 */
export async function updateApplicationPaymentStatus(
  eventId: number,
  applicationId: number,
  paymentStatus: PaymentStatus,
): Promise<OrganizerApplicationItem> {
  return apiPost<OrganizerApplicationItem>(
    `/organizer/events/${eventId}/applications/${applicationId}/payment-status`,
    { payment_status: paymentStatus },
  );
}

/**
 * Assign an application to a booth slot.
 *   POST /organizer/events/{eventId}/applications/{applicationId}/assign-slot
 *   body: { slot_id }
 */
export async function assignApplicationSlot(
  eventId: number,
  applicationId: number,
  slotId: number,
): Promise<OrganizerApplicationItem> {
  return apiPost<OrganizerApplicationItem>(
    `/organizer/events/${eventId}/applications/${applicationId}/assign-slot`,
    { slot_id: slotId },
  );
}

/**
 * Clear / unassign the slot for an application.
 *   POST /organizer/events/{eventId}/applications/{applicationId}/unassign-slot
 */
export async function unassignApplicationSlot(
  eventId: number,
  applicationId: number,
): Promise<OrganizerApplicationItem> {
  return apiPost<OrganizerApplicationItem>(
    `/organizer/events/${eventId}/applications/${applicationId}/unassign-slot`,
    {},
  );
}
