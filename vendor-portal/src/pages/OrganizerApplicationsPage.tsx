// src/pages/OrganizerApplicationsPage.tsx

import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/api";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface OrganizerApplication {
  id: number;
  vendor_name?: string;
  business_name?: string;
  vendorName?: string;
  status: string;
  payment_status?: string;
  paymentStatus?: string;
  assigned_slot_label?: string | null;
  assigned_slot_code?: string | null;
  total_due_cents?: number;
  total_paid_cents?: number;
  submitted_at?: string;
}

interface OrganizerEventApplicationsSummary {
  event_id: number;
  total_applications: number;
  pending: number;
  approved: number;
  rejected: number;
  total_due_cents: number;
  total_paid_cents: number;
}

interface OrganizerEventApplicationsResponse {
  summary: OrganizerEventApplicationsSummary;
  items: OrganizerApplication[];
}

interface VendorProfile {
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

const OrganizerApplicationsPage: React.FC = () => {
  // Accept either :eventId or :id from the route
  const params = useParams<Record<string, string>>();
  const hasRouteParam =
    params.eventId !== undefined || params.id !== undefined;
  const eventIdStr = params.eventId ?? params.id ?? "";
  const parsedEventId = eventIdStr ? Number(eventIdStr) : NaN;

  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const [applications, setApplications] = useState<OrganizerApplication[]>([]);
  const [summary, setSummary] =
    useState<OrganizerEventApplicationsSummary | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [paymentFilter, setPaymentFilter] = useState<
    "all" | "unpaid" | "partial" | "paid"
  >("all");

  // Actions state
  const [actionBusy, setActionBusy] = useState<Record<number, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Vendor modal state
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorProfile | null>(
    null,
  );

  // ---------------------------------------------------------------------------
  // Load applications + summary
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // If this route has no event param at all, don't try to load anything.
    if (!hasRouteParam) {
      setStatus("idle");
      setApplications([]);
      setSummary(null);
      setError(null);
      return;
    }

    // Route has a param, but it isn't a valid number
    if (!eventIdStr || Number.isNaN(parsedEventId)) {
      setStatus("error");
      setError("Invalid event id.");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setStatus("loading");
        setError(null);

        const resp = await apiGet<OrganizerEventApplicationsResponse>(
          `/organizer/events/${parsedEventId}/applications?page=1&page_size=200`,
        );

        if (cancelled) return;

        setApplications(resp.items ?? []);
        setSummary(resp.summary ?? null);
        setStatus("loaded");
      } catch (err: any) {
        console.error(
          "[OrganizerApplicationsPage] failed to load applications",
          err,
        );
        if (cancelled) return;

        setStatus("error");
        setError(
          err?.data?.detail ??
            "Could not load applications for this event. Please try again.",
        );
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [hasRouteParam, eventIdStr, parsedEventId]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatCents(cents?: number) {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }

  function getFilteredApplications(
    apps: OrganizerApplication[],
  ): OrganizerApplication[] {
    return apps.filter((app) => {
      const s = (app.status || "").toLowerCase();
      const p = (app.payment_status || app.paymentStatus || "").toLowerCase();

      if (statusFilter !== "all" && s !== statusFilter) {
        return false;
      }

      if (paymentFilter !== "all" && p !== paymentFilter) {
        return false;
      }

      return true;
    });
  }

  const filteredApplications = getFilteredApplications(applications);

  // ---------------------------------------------------------------------------
  // Vendor profile helpers
  // ---------------------------------------------------------------------------

  async function handleViewVendor(appId: number) {
    try {
      setVendorModalOpen(true);
      setVendorLoading(true);
      setVendorError(null);
      setSelectedVendor(null);

      const profile = await apiGet<VendorProfile>(
        `/organizer/applications/${appId}/vendor-profile`,
      );

      setSelectedVendor(profile);
    } catch (err: any) {
      console.error(
        "[OrganizerApplicationsPage] failed to load vendor profile",
        err,
      );
      setVendorError("Could not load vendor profile.");
      setSelectedVendor(null);
    } finally {
      setVendorLoading(false);
    }
  }

  function closeVendorModal() {
    setVendorModalOpen(false);
    setVendorLoading(false);
    setVendorError(null);
    setSelectedVendor(null);
  }

  // ---------------------------------------------------------------------------
  // Application actions (approve / reject / mark-paid / mark-unpaid)
  // ---------------------------------------------------------------------------

  type AppAction = "approve" | "reject" | "mark-paid" | "mark-unpaid";

  async function handleApplicationAction(appId: number, action: AppAction) {
    try {
      setActionError(null);
      setActionBusy((prev) => ({ ...prev, [appId]: true }));

      // Hit the generic action endpoint
      await apiPost(`/organizer/applications/${appId}/${action}`);

      // After a successful action, re-fetch the event's applications
      if (!Number.isNaN(parsedEventId)) {
        const resp = await apiGet<OrganizerEventApplicationsResponse>(
          `/organizer/events/${parsedEventId}/applications?page=1&page_size=200`,
        );
        setApplications(resp.items ?? []);
        setSummary(resp.summary ?? null);
      }
    } catch (err: any) {
      console.error(
        "[OrganizerApplicationsPage] failed to perform application action",
        err,
      );
      setActionError("Could not update application. Please try again.");
    } finally {
      setActionBusy((prev) => ({ ...prev, [appId]: false }));
    }
  }

  // ---------------------------------------------------------------------------
  // Render branches for route cases
  // ---------------------------------------------------------------------------

  // 🔹 Case 1: This page is mounted on a route with NO :eventId at all
  if (!hasRouteParam) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <p className="mb-1 font-semibold">Select an event.</p>
          <p className="mb-3">
            Choose an event from the organizer dashboard to view its
            applications.
          </p>
          <Link
            to="/organizer/events"
            className="inline-flex rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Back to events
          </Link>
        </div>
      </div>
    );
  }

  // 🔹 Case 2: Route HAS a param, but it's not a valid number
  if (!eventIdStr || Number.isNaN(parsedEventId)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="mb-1 font-semibold">Invalid event.</p>
          <p className="mb-3">
            The URL is missing a valid <code>eventId</code>. Go back to the
            organizer dashboard and choose an event.
          </p>
          <Link
            to="/organizer/events"
            className="inline-flex rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Back to events
          </Link>
        </div>
      </div>
    );
  }

  // 🔹 Case 3: Normal happy path – we have a valid event id
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-xs text-slate-500">
            <Link
              to="/organizer/events"
              className="text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              ← Back to events
            </Link>
          </p>
          <h1 className="text-lg font-semibold text-slate-900">
            Applications for event #{parsedEventId}
          </h1>
          {summary && (
            <p className="mt-1 text-xs text-slate-500">
              {summary.total_applications} application
              {summary.total_applications === 1 ? "" : "s"} ·{" "}
              {summary.pending} pending · {summary.approved} approved ·{" "}
              {summary.rejected} rejected
            </p>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 text-xs">
          <div className="rounded-lg bg-slate-900 text-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Total applications
            </div>
            <div className="mt-1 text-sm font-semibold">
              {summary.total_applications}
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 text-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Pending
            </div>
            <div className="mt-1 text-sm font-semibold">
              {summary.pending}
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 text-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Total due
            </div>
            <div className="mt-1 text-sm font-semibold">
              {formatCents(summary.total_due_cents)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 text-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Total paid
            </div>
            <div className="mt-1 text-sm font-semibold">
              {formatCents(summary.total_paid_cents)}
            </div>
          </div>
        </div>
      )}

      {/* Filters + table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="text-xs font-semibold text-slate-700">
            Applications
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filter:</span>
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={paymentFilter}
              onChange={(e) =>
                setPaymentFilter(e.target.value as typeof paymentFilter)
              }
            >
              <option value="all">All payments</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        {status === "loading" && (
          <div className="px-4 py-6 text-xs text-slate-500">
            Loading applications…
          </div>
        )}

        {status === "error" && (
          <div className="px-4 py-6 text-xs text-red-600">
            {error ?? "Something went wrong loading applications."}
          </div>
        )}

        {status === "loaded" && filteredApplications.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-500">
            No applications match the current filters.
          </div>
        )}

        {status === "loaded" && filteredApplications.length > 0 && (
          <>
            {actionError && (
              <div className="px-4 pt-3 text-[11px] text-rose-600">
                {actionError}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full border-t border-slate-200 text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Vendor</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Payment</th>
                    <th className="px-3 py-2 text-left">Booth</th>
                    <th className="px-3 py-2 text-right">Due</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredApplications.map((app) => {
                    const vendorLabel =
                      app.vendor_name ||
                      app.business_name ||
                      app.vendorName ||
                      `Application #${app.id}`;
                    const paymentStatus =
                      (app.payment_status ||
                        app.paymentStatus ||
                        "unpaid")?.toLowerCase();
                    const assignedLabel =
                      app.assigned_slot_label || app.assigned_slot_code;
                    const normStatus = (app.status || "").toLowerCase();

                    const isBusy = !!actionBusy[app.id];

                    const canApprove =
                      normStatus === "pending" || normStatus === "rejected";
                    const canReject =
                      normStatus === "pending" || normStatus === "approved";
                    const isPaid = paymentStatus === "paid";

                    return (
                      <tr key={app.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-slate-800">
                            {vendorLabel}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            App #{app.id}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-700">
                            {app.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-700">
                            {paymentStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          {assignedLabel ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              {assignedLabel}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Not assigned
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          {formatCents(app.total_due_cents)}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          {formatCents(app.total_paid_cents)}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {/* Vendor actions */}
                            <button
                              type="button"
                              onClick={() => handleViewVendor(app.id)}
                              className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
                            >
                              View vendor
                            </button>
                            {assignedLabel && (
                              <Link
                                to={`/organizer/events/${parsedEventId}/diagram/edit?slot=${encodeURIComponent(
                                  assignedLabel,
                                )}`}
                                className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
                              >
                                View on map
                              </Link>
                            )}

                            {/* Status actions */}
                            <button
                              type="button"
                              disabled={!canApprove || isBusy}
                              onClick={() =>
                                handleApplicationAction(app.id, "approve")
                              }
                              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                                canApprove && !isBusy
                                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                  : "bg-slate-200 text-slate-500 cursor-not-allowed"
                              }`}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={!canReject || isBusy}
                              onClick={() =>
                                handleApplicationAction(app.id, "reject")
                              }
                              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                                canReject && !isBusy
                                  ? "bg-rose-600 text-white hover:bg-rose-500"
                                  : "bg-slate-200 text-slate-500 cursor-not-allowed"
                              }`}
                            >
                              Reject
                            </button>

                            {/* Payment actions */}
                            {!isPaid ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  handleApplicationAction(app.id, "mark-paid")
                                }
                                className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                              >
                                Mark paid
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  handleApplicationAction(
                                    app.id,
                                    "mark-unpaid",
                                  )
                                }
                                className="rounded-md bg-slate-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-500 disabled:opacity-60"
                              >
                                Mark unpaid
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Vendor profile modal */}
      {vendorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-4 text-sm text-slate-900 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Vendor profile</h2>
              <button
                onClick={closeVendorModal}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            {vendorLoading && (
              <div className="py-4 text-xs text-slate-500">Loading…</div>
            )}

            {vendorError && (
              <div className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                {vendorError}
              </div>
            )}

            {selectedVendor && !vendorLoading && (
              <div className="space-y-1 text-xs">
                <div>
                  <span className="font-semibold">Business:</span>{" "}
                  {selectedVendor.business_name || "—"}
                </div>
                <div>
                  <span className="font-semibold">Contact:</span>{" "}
                  {selectedVendor.contact_name || "—"}
                </div>
                <div>
                  <span className="font-semibold">Email:</span>{" "}
                  {selectedVendor.email || "—"}
                </div>
                <div>
                  <span className="font-semibold">Phone:</span>{" "}
                  {selectedVendor.phone || "—"}
                </div>
                <div>
                  <span className="font-semibold">Location:</span>{" "}
                  {selectedVendor.city || "—"},{" "}
                  {selectedVendor.state || ""}
                </div>
                <div>
                  <span className="font-semibold">Website:</span>{" "}
                  {selectedVendor.website || "—"}
                </div>
                <div className="mt-2">
                  <span className="font-semibold">About:</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {selectedVendor.description || "No description provided."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizerApplicationsPage;
