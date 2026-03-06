// src/pages/OrganizerDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type Event = {
  id: number | string;
  title?: string;

  published?: boolean;
  archived?: boolean;

  requirements_published?: boolean;
  layout_published?: boolean;

  start_date?: string;
  end_date?: string;
  venue_name?: string;
  city?: string;
  state?: string;
};

type StatusKey = "draft" | "progress" | "ready" | "complete" | "archived";

function statusKey(ev: Event): StatusKey {
  if (ev.archived) return "archived";
  if (ev.published) return "complete";

  const hasReq = !!ev.requirements_published;
  const hasLayout = !!ev.layout_published;

  if (hasReq && hasLayout) return "ready";
  if (hasReq || hasLayout) return "progress";
  return "draft";
}

function statusLabel(k: StatusKey) {
  switch (k) {
    case "archived":
      return "Archived";
    case "complete":
      return "Complete";
    case "ready":
      return "Ready";
    case "progress":
      return "In Progress";
    default:
      return "Draft";
  }
}

function statusPillClass(k: StatusKey) {
  switch (k) {
    case "archived":
      return "bg-slate-100 text-slate-700";
    case "complete":
      return "bg-emerald-50 text-emerald-700";
    case "ready":
      return "bg-indigo-50 text-indigo-700";
    case "progress":
      return "bg-sky-50 text-sky-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

function progressPct(ev: Event) {
  if (ev.archived) return 0;
  if (ev.published) return 100;

  const steps = [!!ev.requirements_published, !!ev.layout_published];
  const done = steps.filter(Boolean).length;
  return Math.round((done / steps.length) * 100);
}

function formatLocation(ev: Event) {
  const parts = [ev.venue_name, ev.city, ev.state].filter(Boolean);
  return parts.length ? parts.join(" • ") : "—";
}

function formatDateRange(ev: Event) {
  // Guard against the common "epoch default" bug (1970/1971) and invalid dates.
  const parse = (s?: string) => {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    // Treat 1970/1971 as unset placeholders.
    if (d.getFullYear() <= 1971) return null;
    return d;
  };

  const start = parse(ev.start_date);
  const end = parse(ev.end_date);

  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  if (start && end) return `${fmt(start)} - ${fmt(end)}`;
  if (start) return fmt(start);
  if (end) return fmt(end);
  return "Dates TBD";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const data = await getJson<any>("/organizer/events");
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.events)
          ? data.events
          : [];
      setEvents(list);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const total = events.length;
    const complete = events.filter((e) => !!e.published && !e.archived).length;
    const draft = events.filter((e) => !e.published && !e.archived).length;
    const ready = events.filter((e) => statusKey(e) === "ready").length;
    const inProgress = events.filter((e) => statusKey(e) === "progress").length;
    return { total, complete, draft, ready, inProgress };
  }, [events]);

  const topEvents = useMemo(() => {
    const rank: Record<StatusKey, number> = {
      ready: 1,
      progress: 2,
      draft: 3,
      complete: 4,
      archived: 5,
    };

    return [...events]
      .filter((e) => !e.archived)
      .sort((a, b) => rank[statusKey(a)] - rank[statusKey(b)])
      .slice(0, 5);
  }, [events]);

  // ✅ Use a real eventId route for applications
  const defaultApplicationsEventId = useMemo(() => {
    const rank: Record<StatusKey, number> = {
      ready: 1,
      progress: 2,
      draft: 3,
      complete: 4,
      archived: 5,
    };

    const candidate = [...events]
      .filter((e) => !e.archived)
      .sort((a, b) => rank[statusKey(a)] - rank[statusKey(b)])[0];

    return candidate ? String(candidate.id) : null;
  }, [events]);

  function goToApplications() {
    if (defaultApplicationsEventId) {
      navigate(`/organizer/events/${encodeURIComponent(defaultApplicationsEventId)}/applications`);
      return;
    }
    navigate("/organizer/events");
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-3xl font-black tracking-tight text-slate-900">
            Organizer Dashboard
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-600">
            A command center for events, applications, and contacts.
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={load}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
          >
            Sign Out
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {err}
        </div>
      )}

      {/* KPI Cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-black uppercase text-slate-500">
            Total Events
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {loading ? "—" : summary.total}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-black uppercase text-slate-500">
            Complete
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {loading ? "—" : summary.complete}
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600">
            Published events.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-black uppercase text-slate-500">
            Ready to Publish
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {loading ? "—" : summary.ready}
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600">
            Requirements + layout saved.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-black uppercase text-slate-500">
            Draft / In Progress
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {loading ? "—" : summary.draft}
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600">
            {summary.inProgress} in progress.
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-black text-slate-900">Your Events</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Jump back into what you were building.
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate("/organizer/events")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              >
                View All
              </button>

              <button
                type="button"
                onClick={() => navigate("/organizer/events/create")}
                className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
              >
                + Create Event
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {loading && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                Loading events…
              </div>
            )}

            {!loading && topEvents.length === 0 && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-sm font-semibold text-slate-600">
                No events yet. Create your first event to get started.
              </div>
            )}

            {!loading &&
              topEvents.map((ev) => {
                const k = statusKey(ev);
                const pct = progressPct(ev);

                return (
                  <div
                    key={String(ev.id)}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[240px]">
                        <div className="text-base font-black text-slate-900">
                          {ev.title || `Event ${ev.id}`}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-600">
                          {formatDateRange(ev)} • {formatLocation(ev)}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${statusPillClass(
                            k
                          )}`}
                        >
                          {statusLabel(k)}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/organizer/events/${ev.id}/details`)
                          }
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
                        >
                          Open
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/organizer/events/${ev.id}/layout`)
                          }
                          className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
                        >
                          Layout
                        </button>
                      </div>
                    </div>

                    {!ev.published && !ev.archived && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                          <span>Build progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-indigo-600"
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/organizer/events/${ev.id}/requirements`)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-50"
                          >
                            Requirements
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/organizer/events/${ev.id}/layout`)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-50"
                          >
                            Layout
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/organizer/events/${ev.id}/details`)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-900 hover:bg-slate-50"
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right rail */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-black text-slate-900">Next Up</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">
            What you can do right now.
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">
                Pending Applications
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Review vendor applications for your next active event.
              </div>

              {/* ✅ FIXED: Must include :eventId */}
              <button
                type="button"
                onClick={goToApplications}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              >
                Go to Applications
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">
                Contact Management
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Import contacts and invite vendors.
              </div>
              <button
                type="button"
                onClick={() => navigate("/organizer/contacts")}
                className="mt-3 w-full rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
              >
                Manage Contacts
              </button>
            </div>
          </div>

          <div className="mt-6 text-xs font-semibold text-slate-500">
            Tip: events show <span className="font-black">Ready</span> once
            requirements + layout are saved.
          </div>
        </div>
      </div>

      <div className="h-10" />
    </div>
  );
}
