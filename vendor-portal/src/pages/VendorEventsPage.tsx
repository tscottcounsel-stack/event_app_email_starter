import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventModel = {
  id: number;
  title?: string;
  description?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  start_date?: string;
  end_date?: string;
  published?: boolean;
};

export default function VendorEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/public/events`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        console.error("Failed to load events:", res.status);
        setEvents([]);
        return;
      }

      const data = await res.json();
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (err) {
      console.error("Error loading events:", err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  function formatDateRange(e: EventModel) {
    const parse = (s?: string) => {
      if (!s) return null;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      if (d.getFullYear() <= 1971) return null; // treat epoch placeholder as unset
      return d;
    };

    const start = parse(e.start_date);
    const end = parse(e.end_date);

    const fmt = (d: Date) => d.toLocaleDateString();

    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return fmt(start);
    if (end) return fmt(end);
    return "Dates TBD";
  }

  function handleViewEvent(id: number) {
    // IMPORTANT: flyer page should use /public/events/{id}
    navigate(`/events/${id}`);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Available Events</h1>

      {loading && <p>Loading events...</p>}

      {!loading && events.length === 0 && (
        <p className="text-gray-500">No published events available.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {events.map((e) => (
          <div
            key={e.id}
            className="border rounded-lg p-4 shadow-sm bg-white"
          >
            <h2 className="text-lg font-semibold">
              {e.title || "Untitled event"}
            </h2>

            <p className="text-sm text-gray-600">
              {e.venue_name || "Location TBD"}
              {e.city && e.state ? ` • ${e.city}, ${e.state}` : ""}
            </p>

            <p className="text-sm text-gray-500">
              {formatDateRange(e)}
            </p>

            <button
              onClick={() => handleViewEvent(e.id)}
              className="mt-3 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              View Event
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
