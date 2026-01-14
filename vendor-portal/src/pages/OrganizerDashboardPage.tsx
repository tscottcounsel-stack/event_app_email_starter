// src/pages/OrganizerDashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, type OrganizerEventListItem } from "../api";

function StatCard(props: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{props.value}</div>
    </div>
  );
}

function formatDateShort(d?: any) {
  if (!d) return "—";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export default function OrganizerDashboardPage() {
  const nav = useNavigate();

  const [items, setItems] = useState<OrganizerEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      // Works with either { items: [...] } or plain array fallback
      const res: any = await apiGet<any>("/organizer/events");
      const list: OrganizerEventListItem[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.events)
        ? res.events
        : [];

      setItems(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load organizer events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const total = items.length;

    // Safe/soft counts until you add real status rules
    const active = items.filter((e: any) => String(e?.status || "").toLowerCase() === "active").length;
    const draft = items.filter((e: any) => String(e?.status || "").toLowerCase() === "draft").length;

    // Keep 0 until you wire an endpoint
    const pendingApps = 0;

    return { total, active, draft, pendingApps };
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizer Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">A simple overview of your events and activity.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-full border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={() => nav("/organizer/events")}
          >
            Manage Events
          </button>

          <button
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            onClick={() => nav("/organizer/events/new")}
            title="Create a new event"
          >
            <span className="text-base leading-none">+</span>
            Create Event
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Events" value={stats.total} />
        <StatCard label="Pending Applications" value={stats.pendingApps} />
        <StatCard label="Active Events" value={stats.active} />
        <StatCard label="Draft Events" value={stats.draft} />
      </div>

      {/* Your Events (match Events page look) */}
      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <div className="text-lg font-semibold">Your Events</div>
            <div className="text-sm text-slate-500">Create and manage your events in one place.</div>
          </div>

          <button
            className="rounded-full border bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {error && <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="px-5 py-6 text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">No events found.</div>
        ) : (
          <div className="space-y-4 p-5">
            {items.slice(0, 8).map((e: any) => (
              <div key={e.id} className="rounded-xl border bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold">{e.title || "Untitled Event"}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      <span>{formatDateShort(e.date)}</span>
                      <span className="mx-2">•</span>
                      <span>
                        {e.location ? e.location : "Location TBD"}
                        {e.city ? ` • ${e.city}` : ""}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-sm">
                    {/* ✅ NEW: Open goes to your new event detail page */}
                    <button
                      className="rounded-full bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
                      onClick={() => nav(`/organizer/events/${e.id}`)}
                      title="Open event"
                    >
                      Open
                    </button>

                    <button
                      className="rounded-full border px-4 py-2 hover:bg-slate-50"
                      onClick={() => nav(`/organizer/applications?eventId=${e.id}`)}
                    >
                      Applications
                    </button>

                    <button
                      className="rounded-full border px-4 py-2 hover:bg-slate-50"
                      onClick={() => nav(`/organizer/events/${e.id}/map`)}
                    >
                      Map Editor
                    </button>

                    <button
                      className="rounded-full border px-4 py-2 hover:bg-slate-50"
                      onClick={() => nav(`/public/events/${e.id}/diagram.json`)}
                      title="Open public diagram JSON"
                    >
                      Public Diagram (JSON)
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {items.length > 8 && (
              <div className="pt-1">
                <button
                  className="text-sm font-medium text-indigo-700 hover:underline"
                  onClick={() => nav("/organizer/events")}
                >
                  View all events →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
