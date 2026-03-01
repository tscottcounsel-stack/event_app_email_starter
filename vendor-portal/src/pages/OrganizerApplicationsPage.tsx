// src/pages/OrganizerApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type AppStatus = "draft" | "submitted" | "approved" | "rejected" | string;

type OrganizerApplication = {
  id: number | string;
  status?: AppStatus;

  vendor_id?: number | string;
  vendorId?: number | string;
  vendor?: {
    id?: number | string;
    company_name?: string;
    companyName?: string;
    display_name?: string;
    displayName?: string;
    email?: string;
  };

  company_name?: string;
  companyName?: string;
  vendor_name?: string;
  vendorName?: string;
  email?: string;

  created_at?: string;
  submitted_at?: string;
  updated_at?: string;

  booth_id?: string | number | null;
  boothId?: string | number | null;

  reserved_booth_id?: string | number | null;
  reservedBoothId?: string | number | null;

  reserved_until?: string | null;
  reservedUntil?: string | null;

  reservation_expires_at?: string | null;
  reservationExpiresAt?: string | null;

  reservation?: {
    booth_id?: string | number | null;
    boothId?: string | number | null;
    expires_at?: string | null;
    expiresAt?: string | null;
  } | null;

  is_paid?: boolean;
  isPaid?: boolean;
  paid?: boolean;
  paid_at?: string | null;
  paidAt?: string | null;
  payment_status?: string | null;
  paymentStatus?: string | null;
};

/* ---------------- Helpers ---------------- */

function normalizeStatus(s?: string): string {
  return String(s || "").trim().toLowerCase();
}

function pickVendorId(app: OrganizerApplication): string | number | undefined {
  return app.vendor_id ?? app.vendorId ?? app.vendor?.id ?? undefined;
}

function pickCompanyName(app: OrganizerApplication): string {
  return (
    app.vendor?.company_name ??
    app.vendor?.companyName ??
    app.vendor?.display_name ??
    app.vendor?.displayName ??
    app.company_name ??
    app.companyName ??
    app.vendor_name ??
    app.vendorName ??
    "Vendor"
  );
}

function pickEmail(app: OrganizerApplication): string | undefined {
  return app.vendor?.email ?? app.email ?? undefined;
}

function pickBoothId(app: OrganizerApplication): string | number | null {
  return (
    app.reservation?.booth_id ??
    app.reservation?.boothId ??
    app.booth_id ??
    app.boothId ??
    app.reserved_booth_id ??
    app.reservedBoothId ??
    null
  );
}

function pickReservedUntil(app: OrganizerApplication): string | null {
  return (
    app.reservation?.expires_at ??
    app.reservation?.expiresAt ??
    app.reservation_expires_at ??
    app.reservationExpiresAt ??
    app.reserved_until ??
    app.reservedUntil ??
    null
  );
}

function isPaid(app: OrganizerApplication): boolean {
  const paidFlag = app.is_paid ?? app.isPaid ?? app.paid ?? false;
  const paidAt = app.paid_at ?? app.paidAt;
  const status = (app.payment_status ?? app.paymentStatus ?? "").toLowerCase();
  return Boolean(paidFlag || paidAt || status === "paid" || status === "succeeded");
}

function parseDateSafe(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function formatLocalTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isReservationExpired(reservedUntilIso: string | null | undefined): boolean {
  const d = parseDateSafe(reservedUntilIso);
  if (!d) return false;
  return d.getTime() <= Date.now();
}

/* ---------------- Component ---------------- */

export default function OrganizerApplicationsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [apps, setApps] = useState<OrganizerApplication[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");
  const [busyId, setBusyId] = useState<string>("");

  const authHeaders = useMemo(() => buildAuthHeaders(), []);

  async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...(init || {}),
      headers: {
        ...(authHeaders as any),
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.detail || data.error || data.message)) ||
        (typeof data === "string" ? data : "") ||
        `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data as T;
  }

  async function load() {
    if (!eventId) return;
    setLoading(true);
    setErr("");
    try {
      const url = `${API_BASE}/organizer/events/${encodeURIComponent(
        String(eventId)
      )}/applications`;
      const data = await apiJson<any>(url, { method: "GET" });

      const items: OrganizerApplication[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.applications)
        ? data.applications
        : [];

      setApps(items);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Failed to load applications.");
      setApps([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function approve(appId: string | number) {
    setBusyId(String(appId));
    setErr("");
    try {
      await apiJson(`${API_BASE}/applications/${encodeURIComponent(String(appId))}/approve`, {
        method: "POST",
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Approve failed.");
    } finally {
      setBusyId("");
    }
  }

  async function reject(appId: string | number) {
    setBusyId(String(appId));
    setErr("");
    try {
      await apiJson(`${API_BASE}/applications/${encodeURIComponent(String(appId))}/reject`, {
        method: "POST",
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Reject failed.");
    } finally {
      setBusyId("");
    }
  }

  async function del(appId: string | number) {
    const ok = window.confirm("Delete this application? This cannot be undone.");
    if (!ok) return;

    setBusyId(String(appId));
    setErr("");
    try {
      await apiJson(`${API_BASE}/applications/${encodeURIComponent(String(appId))}`, {
        method: "DELETE",
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Delete failed.");
    } finally {
      setBusyId("");
    }
  }

  async function extendReservation(appId: string | number) {
    setBusyId(String(appId));
    setErr("");
    try {
      await apiJson(
        `${API_BASE}/applications/${encodeURIComponent(String(appId))}/reservation/extend`,
        { method: "POST" }
      );
      await load();
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Extend failed.");
    } finally {
      setBusyId("");
    }
  }

  async function releaseReservation(appId: string | number) {
    const ok = window.confirm("Release this booth reservation?");
    if (!ok) return;

    setBusyId(String(appId));
    setErr("");
    try {
      await apiJson(
        `${API_BASE}/applications/${encodeURIComponent(String(appId))}/reservation/release`,
        { method: "POST" }
      );
      await load();
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Release failed.");
    } finally {
      setBusyId("");
    }
  }

  function goReserve(app: OrganizerApplication) {
    if (!eventId) return;
    navigate(
      `/organizer/events/${encodeURIComponent(
        String(eventId)
      )}/layout?assignAppId=${encodeURIComponent(String(app.id))}&assignAction=reserve`
    );
  }

  function goChange(app: OrganizerApplication) {
    if (!eventId) return;
    navigate(
      `/organizer/events/${encodeURIComponent(
        String(eventId)
      )}/layout?assignAppId=${encodeURIComponent(String(app.id))}&assignAction=change`
    );
  }

  function viewApp(app: OrganizerApplication) {
    // ✅ FIX: pass eventId to the preview page (both query param + location state)
    const eid = String(eventId || "");
    const aid = String(app.id);
    navigate(`/organizer/vendor-preview/${encodeURIComponent(aid)}?eventId=${encodeURIComponent(eid)}`, {
      state: { eventId: eid, applicationId: aid },
    });
  }

  function viewProfile(app: OrganizerApplication) {
    const vid = pickVendorId(app);
    if (!vid) return;
    navigate(`/organizer/vendors/${encodeURIComponent(String(vid))}`);
  }

  const sorted = useMemo(() => {
    const copy = [...apps];
    copy.sort((a, b) => {
      const da =
        parseDateSafe(a.submitted_at || a.created_at || a.updated_at || "")?.getTime() || 0;
      const db =
        parseDateSafe(b.submitted_at || b.created_at || b.updated_at || "")?.getTime() || 0;
      return db - da;
    });
    return copy;
  }, [apps]);

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Applications</h1>
            <div className="mt-1 text-sm text-gray-500">
              Review applications and manage booth reservations.
            </div>
          </div>

          <button
            onClick={load}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            disabled={loading}
            title="Refresh"
          >
            Refresh
          </button>
        </div>

        {err ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
            Loading applications…
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
            No applications found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-600">
              <div className="col-span-4">Vendor</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3">Reservation</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-200">
              {sorted.map((app) => {
                const status = normalizeStatus(app.status);
                const paid = isPaid(app);

                const boothId = pickBoothId(app);
                const reservedUntilIso = pickReservedUntil(app);
                const reservedUntilDate = parseDateSafe(reservedUntilIso);
                const hasReservation = Boolean(boothId && reservedUntilDate);
                const expired = hasReservation ? isReservationExpired(reservedUntilIso) : false;

                const isDraftOrSubmitted = status === "draft" || status === "submitted";
                const isApproved = status === "approved";
                const isRejected = status === "rejected";

                const approvedNoHold = isApproved && !paid && (!hasReservation || expired);
                const approvedHeldUnpaidActive = isApproved && !paid && hasReservation && !expired;
                const approvedPaid = isApproved && paid;

                const name = pickCompanyName(app);
                const email = pickEmail(app);
                const isBusy = busyId === String(app.id);

                return (
                  <div key={String(app.id)} className="grid grid-cols-12 items-start px-4 py-4">
                    {/* Vendor */}
                    <div className="col-span-4">
                      <div className="flex flex-col">
                        <div className="text-sm font-semibold text-gray-900">{name}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          App #{String(app.id)}
                          {email ? <span className="ml-2">• {email}</span> : null}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => viewApp(app)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
                          title="View application"
                        >
                          View App
                        </button>

                        <button
                          onClick={() => viewProfile(app)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                          title="View vendor profile"
                          disabled={!pickVendorId(app)}
                        >
                          View Profile
                        </button>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="inline-flex rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700">
                        {status || "unknown"}
                      </div>

                      {approvedPaid ? (
                        <div className="mt-2 text-xs font-medium text-green-700">
                          Paid ✅ / Booth locked
                        </div>
                      ) : null}

                      {isApproved && !paid && expired ? (
                        <div className="mt-2 text-xs font-medium text-amber-700">
                          Reservation expired
                        </div>
                      ) : null}
                    </div>

                    {/* Reservation */}
                    <div className="col-span-3">
                      {isApproved ? (
                        approvedPaid ? (
                          <div className="text-xs text-gray-700">
                            {boothId ? (
                              <div className="font-medium">
                                Booth <span className="font-semibold">{String(boothId)}</span> locked
                              </div>
                            ) : (
                              <div className="font-medium">Booth locked</div>
                            )}
                          </div>
                        ) : hasReservation && reservedUntilDate ? (
                          <div className="text-xs text-gray-700">
                            <div>
                              Reserved: Booth{" "}
                              <span className="font-semibold">{String(boothId)}</span>{" "}
                              until{" "}
                              <span className="font-semibold">
                                {formatLocalTimestamp(reservedUntilDate)}
                              </span>
                            </div>
                            {expired ? (
                              <div className="mt-1 text-xs text-amber-700">
                                This hold is expired; you can reserve again.
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">No reservation</div>
                        )
                      ) : (
                        <div className="text-xs text-gray-400">—</div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-span-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {isDraftOrSubmitted ? (
                          <>
                            <button
                              onClick={() => approve(app.id)}
                              className="rounded-lg bg-black px-3 py-2 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-60"
                              disabled={isBusy}
                              title="Approve application"
                            >
                              {isBusy ? "Working…" : "Approve"}
                            </button>

                            <button
                              onClick={() => reject(app.id)}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
                              disabled={isBusy}
                              title="Reject application"
                            >
                              {isBusy ? "Working…" : "Reject"}
                            </button>

                            <button
                              onClick={() => del(app.id)}
                              className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                              disabled={isBusy}
                              title="Delete application"
                            >
                              Delete
                            </button>
                          </>
                        ) : null}

                        {isRejected ? (
                          <button
                            onClick={() => del(app.id)}
                            className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                            disabled={isBusy}
                            title="Delete application"
                          >
                            {isBusy ? "Working…" : "Delete"}
                          </button>
                        ) : null}

                        {isApproved ? (
                          <>
                            {approvedPaid ? (
                              <>
                                <button
                                  className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white opacity-90"
                                  disabled
                                  title="Booth is locked (paid)"
                                >
                                  Booth Locked
                                </button>
                              </>
                            ) : null}

                            {approvedNoHold ? (
                              <button
                                onClick={() => goReserve(app)}
                                className="rounded-lg bg-black px-3 py-2 text-xs font-medium text-white hover:bg-gray-900"
                                title="Reserve booth"
                              >
                                Reserve Booth
                              </button>
                            ) : null}

                            {approvedHeldUnpaidActive ? (
                              <>
                                <button
                                  className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white opacity-90"
                                  disabled
                                  title="Booth is currently reserved"
                                >
                                  Reserved
                                </button>

                                <button
                                  onClick={() => extendReservation(app.id)}
                                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
                                  disabled={isBusy}
                                  title="Extend reservation"
                                >
                                  {isBusy ? "Working…" : "Extend"}
                                </button>

                                <button
                                  onClick={() => goChange(app)}
                                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50"
                                  title="Change booth"
                                >
                                  Change Booth
                                </button>

                                <button
                                  onClick={() => releaseReservation(app.id)}
                                  className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                                  disabled={isBusy}
                                  title="Release reservation"
                                >
                                  {isBusy ? "Working…" : "Release"}
                                </button>
                              </>
                            ) : null}
                          </>
                        ) : null}

                        {!isDraftOrSubmitted && !isRejected && !isApproved ? (
                          <button
                            onClick={() => del(app.id)}
                            className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                            disabled={isBusy}
                            title="Delete application"
                          >
                            {isBusy ? "Working…" : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
