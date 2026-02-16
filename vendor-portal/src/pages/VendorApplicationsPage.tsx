// src/pages/VendorApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorProgress = {
  eventId: string;
  appId: string;
  boothId?: string;
  checked: Record<string, boolean>;
  notes?: string;
  updatedAt: string;
  status?: "draft" | "submitted" | "approved" | "rejected";
  submittedAt?: string;
};

type ServerApplication = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  app_ref?: string | null;
  notes?: string;
  checked?: Record<string, boolean>;
  status?: string;
  submitted_at?: string;
  updated_at?: string;

  vendor_email?: string | null;
  vendor_id?: string | null;
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function calcCompletion(item: VendorProgress) {
  const keys = Object.keys(item.checked || {});
  if (keys.length === 0) return { done: 0, total: 0, pct: 100 };
  const done = keys.filter((k) => item.checked[k]).length;
  const total = keys.length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return { done, total, pct };
}

function normalizeServerToUi(a: ServerApplication): VendorProgress {
  const appId = (a.app_ref && String(a.app_ref)) || String(a.id);

  const rawStatus = String(a.status || "").toLowerCase();
  const status =
    rawStatus === "approved" || rawStatus === "rejected" || rawStatus === "submitted"
      ? (rawStatus as any)
      : ("draft" as any);

  return {
    eventId: String(a.event_id),
    appId,
    boothId: a.booth_id ? String(a.booth_id) : undefined,
    checked: a.checked || {},
    notes: a.notes || "",
    updatedAt: a.updated_at || a.submitted_at || new Date().toISOString(),
    status,
    submittedAt: a.submitted_at || undefined,
  };
}

export default function VendorApplicationsPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverApps, setServerApps] = useState<VendorProgress[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setServerError(null);

      try {
        const headers = buildAuthHeaders();

        // Guard: If no identity, backend will return empty and you'll be confused.
        const hasIdentity = !!headers.Authorization || !!headers["x-user-email"] || !!headers["x-user-id"];
        if (!hasIdentity) {
          throw new Error(
            "Missing login identity headers (Authorization / x-user-email / x-user-id). Log in again so applications can load."
          );
        }

        const res = await fetch(`${API_BASE}/vendor/applications`, {
          method: "GET",
          headers,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${text || "Failed to load server applications"}`);
        }

        const data = (await res.json().catch(() => null)) as { applications?: ServerApplication[] } | null;
        const apps = Array.isArray(data?.applications) ? data!.applications : [];
        const normalized = apps.map(normalizeServerToUi);

        if (!cancelled) setServerApps(normalized);
      } catch (e: any) {
        if (!cancelled) setServerError(e?.message || "Failed to load applications from server.");
        if (!cancelled) setServerApps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => {
    const list = serverApps.slice();
    list.sort((a, b) => {
      const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });
    return list;
  }, [serverApps]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Applications</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">Submissions are loaded from the server.</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => nav("/vendor/events")}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
              type="button"
            >
              Browse Events
            </button>
          </div>
        </div>

        {/* Server status */}
        <div className="mt-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">
              Loading applications…
            </div>
          ) : serverError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              <div className="font-black">Server applications unavailable</div>
              <div className="mt-1 opacity-90">{serverError}</div>
              <div className="mt-2 text-xs font-bold text-amber-800">
                If this is unexpected, confirm you are logged in and that the request includes identity headers.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Loaded server applications: <span className="font-black">{serverApps.length}</span>
            </div>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-xl font-black text-slate-900">No applications yet</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              When you submit an application, it will show up here.
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => nav("/vendor/events")}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                type="button"
              >
                Find Events
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {sorted.map((it) => {
              const { done, total, pct } = calcCompletion(it);

              const status = it.status || "draft";
              const viewUrl = `/vendor/events/${encodeURIComponent(it.eventId)}/apply?` +
                new URLSearchParams({
                  appId: it.appId,
                  ...(it.boothId ? { boothId: it.boothId } : {}),
                }).toString();

              return (
                <div key={`${it.eventId}:${it.appId}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="text-lg font-black text-slate-900">
                        Event #{it.eventId}
                        {it.boothId ? (
                          <span className="ml-2 text-sm font-extrabold text-slate-500">• Booth {it.boothId}</span>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        Last updated: {formatDate(it.updatedAt)}
                        {it.submittedAt ? <span className="ml-2">• Submitted: {formatDate(it.submittedAt)}</span> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={
                          "rounded-full px-3 py-1 text-xs font-extrabold " +
                          (status === "approved"
                            ? "bg-emerald-50 text-emerald-700"
                            : status === "rejected"
                            ? "bg-rose-50 text-rose-700"
                            : status === "submitted"
                            ? "bg-violet-50 text-violet-700"
                            : "bg-slate-100 text-slate-700")
                        }
                      >
                        {status === "approved"
                          ? "Approved"
                          : status === "rejected"
                          ? "Rejected"
                          : status === "submitted"
                          ? "Submitted"
                          : "Draft"}
                      </span>

                      <div className="text-sm font-extrabold text-slate-700">
                        {pct}% <span className="font-semibold text-slate-500">({done}/{total})</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      to={viewUrl}
                      className="rounded-full bg-violet-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-violet-700"
                    >
                      View
                    </Link>

                    <Link
                      to={`/vendor/events/${encodeURIComponent(it.eventId)}`}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                    >
                      View Event
                    </Link>
                  </div>

                  {it.notes ? (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Notes</div>
                      <div className="mt-1 whitespace-pre-wrap">{it.notes}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
