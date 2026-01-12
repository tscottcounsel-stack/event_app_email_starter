// src/pages/OrganizerDashboardPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiGet } from "../api";

type OrganizerEvent = {
  id: number;
  title?: string;
  date?: string;
  city?: string;
  location?: string;
  kind?: string;
  status?: string;
};

function formatDate(d?: string) {
  if (!d) return "";
  // supports "2026-05-05" or ISO strings
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export default function OrganizerDashboardPage() {
  const nav = useNavigate();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res: any = await apiGet<any>("/organizer/events");
        const list: OrganizerEvent[] = Array.isArray(res)
          ? res
          : Array.isArray(res?.items)
          ? res.items
          : Array.isArray(res?.events)
          ? res.events
          : [];

        if (mounted) setEvents(list);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load organizer events");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const totalEvents = events.length;
    const activeEvents = events.filter((e) => (e.status || "").toLowerCase() === "active").length;
    const draftEvents = events.filter((e) => (e.status || "").toLowerCase() === "draft").length;

    // Keep this 0 until you add a real endpoint for counts
    const pendingApplications = 0;

    return { totalEvents, activeEvents, draftEvents, pendingApplications };
  }, [events]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizer Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">Overview, events, applications, and controls.</p>
        </div>

        <button
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => nav("/organizer/events")}
        >
          View Events
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Events" value={stats.totalEvents} />
        <Stat label="Active" value={stats.activeEvents} />
        <Stat label="Draft" value={stats.draftEvents} />
        <Stat label="Pending Apps" value={stats.pendingApplications} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Events</h2>
          <button
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => nav("/organizer/events")}
          >
            Manage Events
          </button>
        </div>

        {loading && <div className="text-sm text-gray-500">Loading…</div>}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            No events found.
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div className="space-y-3">
            {events.slice(0, 8).map((ev) => (
              <div key={ev.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-base font-semibold">{ev.title || `Event #${ev.id}`}</div>
                    <div className="mt-1 text-sm text-gray-600">
                      {formatDate(ev.date)} • {ev.location || "Location TBD"}
                      {ev.city ? ` • ${ev.city}` : ""}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm">
                    <button
                      className="underline"
                      onClick={() => nav(`/organizer/applications?eventId=${ev.id}`)}
                    >
                      Applications
                    </button>

                    <button className="underline" onClick={() => nav(`/organizer/events/${ev.id}/map`)}>
                      Map Editor
                    </button>

                    <a
                      className="underline"
                      href={`${API_BASE}/public/events/${ev.id}/diagram`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Public Diagram (JSON)
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}
