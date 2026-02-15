import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type OrganizerEvent = {
  id: number | string;
  title?: string;
  name?: string;

  // Backend flags
  archived?: boolean;
  published?: boolean;
  layout_published?: boolean;

  // NEW: requirements progress flags (set by requirements.py when saved)
  requirements_published?: boolean;
  requirements_version?: number;
  requirements_updated_at?: string;

  // Optional fields
  start_date?: string;
  end_date?: string;
  venue_name?: string;
  city?: string;
  state?: string;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function formatDateRange(ev: OrganizerEvent) {
  const start = ev.start_date ? new Date(ev.start_date) : null;
  const end = ev.end_date ? new Date(ev.end_date) : null;

  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  let dates = "—";
  if (start && end) dates = `${fmt(start)} - ${fmt(end)}`;
  else if (start) dates = fmt(start);
  else if (end) dates = fmt(end);

  const venueLine = [ev.venue_name, ev.city, ev.state].filter(Boolean).join(" • ");
  return { dates, venueLine: venueLine || "—" };
}

function statusLabel(ev: OrganizerEvent) {
  if (ev.archived) return "Archived";

  // Once published, no more "Draft"
  if (ev.published) return "Complete";

  const hasReq = !!ev.requirements_published;
  const hasLayout = !!ev.layout_published;

  if (hasReq && hasLayout) return "Ready";
  if (hasReq || hasLayout) return "In Progress";
  return "Draft";
}

function statusClasses(ev: OrganizerEvent) {
  if (ev.archived) return "bg-slate-100 text-slate-700";
  if (ev.published) return "bg-emerald-50 text-emerald-700";

  const hasReq = !!ev.requirements_published;
  const hasLayout = !!ev.layout_published;

  if (hasReq && hasLayout) return "bg-indigo-50 text-indigo-700";
  if (hasReq || hasLayout) return "bg-sky-50 text-sky-700";
  return "bg-amber-50 text-amber-700";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export default function OrganizerEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const summary = useMemo(() => {
    const total = events.length;
    const active = events.filter((e) => !!e.published && !e.archived).length;
    const draft = events.filter((e) => !e.published && !e.archived).length;
    return { total, active, draft };
  }, [events]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        // Try the most likely endpoints (your app has moved around a bit)
        const candidates = ["/events", "/organizer/events", "/api/events", "/api/organizer/events"];

        let data: any = null;
        let lastError: any = null;

        for (const p of candidates) {
          try {
            data = await getJson<any>(p);
            break;
          } catch (e) {
            lastError = e;
          }
        }

        if (!data) throw lastError || new Error("Unable to load events");

        // normalize: backend may return { events: [...] } or just [...]
        const list = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
        if (!Array.isArray(list)) throw new Error("Unexpected events payload");

        if (mounted) setEvents(list);
      } catch (e: any) {
        if (mounted) setErr(e?.message || "Failed to load events");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Loading events…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Your Events</div>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {err}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <div className="text-3xl font-black tracking-tight text-slate-900">Your Events</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">
            Open an event to view details, applications, or layout.
          </div>
        </div>

        <div className="flex gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs font-bold text-slate-500">Total Events</div>
            <div className="text-2xl font-black text-slate-900">{summary.total}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs font-bold text-slate-500">Active Events</div>
            <div className="text-2xl font-black text-slate-900">{summary.active}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs font-bold text-slate-500">Draft Events</div>
            <div className="text-2xl font-black text-slate-900">{summary.draft}</div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr] gap-3 border-b border-slate-100 pb-3 text-xs font-black uppercase text-slate-500">
          <div>Event</div>
          <div>Dates</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="divide-y divide-slate-100">
          {events.map((ev) => {
            const id = ev.id;
            const title = ev.title || ev.name || `Event ${id}`;
            const { dates, venueLine } = formatDateRange(ev);

            return (
              <div key={String(id)} className="grid grid-cols-[2fr_1.2fr_1fr_1fr] gap-3 py-4">
                <div>
                  <div className="text-base font-black text-slate-900">{title}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-600">{venueLine}</div>
                </div>

                <div className="text-sm font-semibold text-slate-800">{dates}</div>

                <div>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${statusClasses(ev)}`}>
                    {statusLabel(ev)}
                  </span>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
                    onClick={() => navigate(`/organizer/events/${id}`)}
                  >
                    Open
                  </button>

                  <button
                    type="button"
                    className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
                    onClick={() => navigate(`/organizer/events/${id}/layout`)}
                  >
                    Layout
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
