// src/pages/PublicEventsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventModel = {
  id: number | string;
  title?: string;
  description?: string;

  city?: string;
  state?: string;
  venue_name?: string;
  category?: string;

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

function formatDates(start?: string, end?: string) {
  if (!start && !end) return "Dates TBD";

  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;

  const sStr = s && !isNaN(s.getTime()) ? s.toLocaleDateString() : "";
  const eStr = e && !isNaN(e.getTime()) ? e.toLocaleDateString() : "";

  if (sStr && eStr) return `${sStr} — ${eStr}`;
  return sStr || eStr || "Dates TBD";
}

export default function PublicEventsPage() {
  const { eventId } = useParams();
  const isDetail = !!eventId;

  const [events, setEvents] = useState<EventModel[]>([]);
  const [event, setEvent] = useState<EventModel | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      if (isDetail) {
        const res = await fetch(`${API_BASE}/public/events/${eventId}`);
        const data = await res.json();
        if (!cancelled) setEvent(data);
      } else {
        const res = await fetch(`${API_BASE}/public/events`);
        const data = await res.json();

        let list: any[] = [];

        if (Array.isArray(data?.events)) list = data.events;
        else if (Array.isArray(data)) list = data;
        else if (data?.id) list = [data];

        if (!cancelled) setEvents(list);
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isDetail, eventId]);

  if (loading) return <div className="p-10">Loading…</div>;

  // =====================================
  // DETAIL VIEW
  // =====================================
  if (isDetail && event) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-64 bg-gray-200 flex items-end">
          <div className="max-w-6xl mx-auto w-full p-6 text-white">
            <h1 className="text-4xl font-bold">{safeStr(event.title)}</h1>
            <div className="text-sm mt-1 opacity-90">
              {safeStr(event.city)}, {safeStr(event.state)} •{" "}
              {formatDates(event.start_date, event.end_date)}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto p-6">
          <div className="border rounded-xl p-6">
            <h2 className="text-xl font-semibold">About</h2>
            <p className="mt-2 text-gray-700">
              {safeStr(event.description) || "No description available yet."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =====================================
  // LIST VIEW (VENUES STYLE)
  // =====================================

  const filtered = events.filter((ev) => {
    const title = safeStr(ev.title).toLowerCase();
    const loc =
      `${safeStr(ev.city)} ${safeStr(ev.state)}`.toLowerCase();

    return (
      title.includes(search.toLowerCase()) &&
      loc.includes(locationSearch.toLowerCase())
    );
  });

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/" className="text-sm text-gray-600">
          ← Back
        </Link>

        <h1 className="text-4xl font-bold mt-4">Find Events</h1>
        <p className="text-gray-600 mt-2">
          Discover events happening near you.
        </p>

        {/* Search Bar Section (matches venues layout) */}
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          <input
            className="border rounded-xl px-4 py-3"
            placeholder="Search events by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            className="border rounded-xl px-4 py-3"
            placeholder="City, State, or ZIP Code..."
            value={locationSearch}
            onChange={(e) => setLocationSearch(e.target.value)}
          />
          <button className="bg-green-600 text-white rounded-xl px-6 py-3 font-semibold">
            Filters
          </button>
        </div>

        <h2 className="text-3xl font-bold mt-8">
          {filtered.length} Events Found
        </h2>

        {/* Card Grid */}
        <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((ev) => {
            const hero =
              safeStr(ev.heroImageUrl) ||
              asArray(ev.imageUrls)[0] ||
              "";

            return (
              <Link
                key={ev.id}
                to={`/events/${ev.id}`}
                className="rounded-2xl overflow-hidden shadow hover:shadow-lg transition"
              >
                <div className="h-48 bg-gray-200">
                  {hero && (
                    <img
                      src={hero}
                      alt={ev.title}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="p-4 bg-white">
                  <div className="text-xl font-semibold">
                    {safeStr(ev.title)}
                  </div>

                  <div className="text-sm text-gray-600 mt-1">
                    {safeStr(ev.city)}, {safeStr(ev.state)}
                  </div>

                  <div className="text-sm text-gray-500 mt-1">
                    {formatDates(ev.start_date, ev.end_date)}
                  </div>

                  {ev.category && (
                    <div className="mt-3 inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs">
                      {ev.category}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
