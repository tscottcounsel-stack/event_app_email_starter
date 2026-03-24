// src/pages/PublicEventsMarketplacePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventItem = {
  id: number;
  title?: string;
  name?: string;
  description?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
  city?: string;
  state?: string;
  status?: string;
  banner_url?: string;
};

export default function PublicEventsMarketplacePage() {
  const navigate = useNavigate();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    async function loadEvents() {
      try {
        const res = await fetch(`${API_BASE}/events`);
        const data = await res.json();
        setEvents(Array.isArray(data) ? data : data?.events ?? []);
      } catch (err) {
        console.error("Failed loading events", err);
      } finally {
        setLoading(false);
      }
    }

    loadEvents();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.category) set.add(e.category);
    });
    return Array.from(set);
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const title = e.title || e.name || "";
      const matchesSearch = title.toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        category === "all" || e.category === category;

      return matchesSearch && matchesCategory;
    });
  }, [events, search, category]);

  function goToEvent(id: number) {
    navigate(`/events/${id}`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            Vendor Marketplace
          </h1>
          <p className="text-slate-600 mt-2">
            Discover events and apply as a vendor.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">

          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-slate-200 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Event Grid */}
        {loading ? (
          <div className="text-center text-slate-500 py-20">
            Loading events...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center text-slate-500 py-20">
            No events found.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {filteredEvents.map((event) => {
              const title = event.title || event.name || "Untitled Event";

              return (
                <div
                  key={event.id}
                  className="rounded-3xl border bg-white p-6 shadow-sm hover:shadow-md transition cursor-pointer"
                  onClick={() => goToEvent(event.id)}
                >
                  {/* Banner */}
                  {event.banner_url && (
                    <img
                      src={event.banner_url}
                      className="rounded-xl mb-4 h-40 w-full object-cover"
                    />
                  )}

                  {/* Title */}
                  <h3 className="text-xl font-bold text-slate-900 mb-2">
                    {title}
                  </h3>

                  {/* Location */}
                  <p className="text-sm text-slate-500 mb-2">
                    {event.city} {event.state}
                  </p>

                  {/* Dates */}
                  {(event.start_date || event.end_date) && (
                    <p className="text-sm text-slate-500 mb-3">
                      {event.start_date} {event.end_date && `– ${event.end_date}`}
                    </p>
                  )}

                  {/* Category */}
                  {event.category && (
                    <span className="inline-block text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                      {event.category}
                    </span>
                  )}

                  {/* Status */}
                  {event.status && (
                    <div className="mt-3 text-xs text-slate-400 uppercase tracking-wider">
                      {event.status}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
