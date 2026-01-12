// src/pages/VendorDashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import { getVendorUserId } from "../auth";

type VendorEvent = {
  id: number;
  title?: string | null;
  name?: string | null;
  location?: string | null;
  date?: string | null;
};

type AppRow = {
  id: number;
  event_id: number;
  user_id: number;
  status?: string | null;
  assigned_slot_id?: number | null;
};

function safeDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toLocaleDateString() : String(d);
}

function norm(s?: string | null) {
  return (s ?? "").toLowerCase().trim();
}

function statusLabel(status?: string | null) {
  const s = norm(status);
  if (s === "assigned") return "Assigned";
  if (s === "approved") return "Approved";
  if (s === "pending") return "Pending";
  return status ?? "—";
}

export default function VendorDashboardPage() {
  const navigate = useNavigate();
  const uid = getVendorUserId();

  const [events, setEvents] = useState<VendorEvent[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [evResp, appResp] = await Promise.all([
          apiGet<{ items: VendorEvent[] }>(`/events?limit=100`),
          apiGet<{ items: AppRow[] }>(`/applications?limit=300`),
        ]);

        if (cancelled) return;

        setEvents(evResp.items ?? []);
        setApps(appResp.items ?? []);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setError(e?.message || "Unable to load dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const myApps = useMemo(() => {
    if (!uid) return [];
    return apps.filter((a) => Number(a.user_id) === Number(uid));
  }, [apps, uid]);

  const eventsById = useMemo(() => {
    const map = new Map<number, VendorEvent>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  const assigned = myApps.filter((a) => typeof a.assigned_slot_id === "number");
  const pending = myApps.filter((a) => norm(a.status) === "pending");
  const approved = myApps.filter(
    (a) => norm(a.status) === "approved" && a.assigned_slot_id == null
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              EP
            </div>
            <span className="font-semibold text-slate-900">
              Vendor dashboard
            </span>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => navigate("/vendor/profile")}
              className="text-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              My profile
            </button>
            <button
              onClick={() => navigate("/vendor/public-preview")}
              className="text-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              Public preview
            </button>
            <button
              onClick={() => navigate("/vendor/events")}
              className="text-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              Browse events
            </button>
            <button
              onClick={() => navigate("/vendor/applications")}
              className="text-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              My applications
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {!uid && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            You’re not logged in as a vendor.
          </div>
        )}

        {loading && (
          <div className="text-sm text-slate-600">Loading dashboard…</div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border bg-white p-4">
            <div className="text-xs text-slate-500">Assigned events</div>
            <div className="text-3xl font-bold text-green-700">
              {assigned.length}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="text-xs text-slate-500">Pending applications</div>
            <div className="text-3xl font-bold text-yellow-700">
              {pending.length}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="text-xs text-slate-500">
              Approved (awaiting booth)
            </div>
            <div className="text-3xl font-bold text-indigo-700">
              {approved.length}
            </div>
          </div>
        </div>

        {/* Assigned booths */}
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Your assigned booths</h2>
            <Link
              to="/vendor/events"
              className="text-sm text-emerald-700 hover:underline"
            >
              View all events
            </Link>
          </div>

          {assigned.length === 0 ? (
            <div className="mt-3 text-sm text-slate-600">
              You don’t have any assigned booths yet.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {assigned.map((a) => {
                const ev = eventsById.get(a.event_id);
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        {ev?.title || ev?.name || `Event #${a.event_id}`}
                      </div>
                      <div className="text-xs text-slate-600">
                        {safeDate(ev?.date)} • {ev?.location || "—"}
                      </div>
                      <div className="text-xs text-green-700 font-semibold">
                        Assigned
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        navigate(`/vendor/events/${a.event_id}/diagram`)
                      }
                      className="text-sm rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"
                    >
                      View booth
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending / approved */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold text-slate-900">
            Applications in progress
          </h2>

          {pending.length === 0 && approved.length === 0 ? (
            <div className="mt-3 text-sm text-slate-600">
              No pending or approved applications right now.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {[...pending, ...approved].map((a) => {
                const ev = eventsById.get(a.event_id);
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        {ev?.title || ev?.name || `Event #${a.event_id}`}
                      </div>
                      <div className="text-xs text-slate-600">
                        {safeDate(ev?.date)} • {ev?.location || "—"}
                      </div>
                      <div className="text-xs font-semibold text-slate-700">
                        {statusLabel(a.status)}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        navigate(`/vendor/events/${a.event_id}/diagram`)
                      }
                      className="text-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
                    >
                      Open event
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
