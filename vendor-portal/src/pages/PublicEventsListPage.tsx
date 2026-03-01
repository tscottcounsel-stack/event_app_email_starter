// vendor-portal/src/pages/PublicEventsListPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventModel = {
  id: number | string;
  title?: string;
  description?: string;

  venue_name?: string;
  city?: string;
  state?: string;

  start_date?: string;
  end_date?: string;

  heroImageUrl?: string;
  imageUrls?: string[];

  published?: boolean;
};

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArray(x: any): string[] {
  return Array.isArray(x) ? x : [];
}

/**
 * Stable date rendering to avoid timezone "day shift":
 * - If date-only (YYYY-MM-DD), render in UTC.
 * - If timestamp, render with UTC date parts.
 */
function formatDateStable(input?: string): string {
  const s = safeStr(input);
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return s;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;

  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateRange(start?: string, end?: string) {
  const s = formatDateStable(start);
  const e = formatDateStable(end);

  if (!s && !e) return "Dates TBD";
  if (s && e) return `${s} — ${e}`;
  return s || e || "Dates TBD";
}

export default function PublicEventsListPage() {
  const [events, setEvents] = useState<EventModel[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/public/events`);
        const data = await res.json().catch(() => null);

        let list: any[] = [];
        if (Array.isArray((data as any)?.events)) list = (data as any).events;
        else if (Array.isArray(data)) list = data as any[];
        else if (data && typeof data === "object" && (data as any).id) list = [data];

        if (!cancelled) setEvents(list as EventModel[]);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const ll = loc.trim().toLowerCase();

    return events.filter((ev) => {
      const title = safeStr(ev.title).toLowerCase();
      const location = `${safeStr(ev.venue_name)} ${safeStr(ev.city)} ${safeStr(ev.state)}`.toLowerCase();
      return title.includes(ql) && location.includes(ll);
    });
  }, [events, q, loc]);

  if (loading) {
    return <div className="min-h-screen bg-white p-10">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/" className="text-sm text-gray-600">
          ← Back
        </Link>

        <h1 className="text-4xl font-bold mt-4">Find Events</h1>
        <p className="text-gray-600 mt-2">Browse published events and apply for a booth.</p>

        <div className="mt-6 grid md:grid-cols-3 gap-4">
          <input
            className="border rounded-xl px-4 py-3"
            placeholder="Search by event name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <input
            className="border rounded-xl px-4 py-3"
            placeholder="City, state, or venue…"
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
          />
          <div className="border rounded-xl px-4 py-3 text-gray-500">
            {filtered.length} results
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-8 border rounded-2xl p-8 text-gray-600">
            No events found.
          </div>
        ) : (
          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((ev) => {
              const id = String(ev.id);
              const hero = safeStr(ev.heroImageUrl) || asArray(ev.imageUrls)[0] || "";
              const title = safeStr(ev.title) || "Untitled event";
              const city = safeStr(ev.city);
              const state = safeStr(ev.state);

              return (
                <Link
                  key={id}
                  to={`/events/${id}`}
                  className="rounded-2xl overflow-hidden shadow hover:shadow-lg transition bg-white"
                >
                  <div className="h-44 bg-gray-200">
                    {hero ? (
                      <img
                        src={hero}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="p-4">
                    <div className="text-xl font-semibold">{title}</div>

                    <div className="text-sm text-gray-600 mt-1">
                      {city}
                      {city && state ? ", " : ""}
                      {state}
                    </div>

                    <div className="text-sm text-gray-500 mt-1">
                      {formatDateRange(ev.start_date, ev.end_date)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
