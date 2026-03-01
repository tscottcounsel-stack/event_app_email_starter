// src/pages/OrganizerEventsPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventRow = {
  id: number;
  title?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  start_date?: string;
  published?: boolean;
};

export default function OrganizerEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    setLoading(true);
    setError(null);

    try {
      const headers = buildAuthHeaders();
      const res = await fetch(`${API_BASE}/organizer/events`, { headers });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to load events (${res.status})`);
      }

      const data = await res.json();
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

  function openDetails(id: number) {
    navigate(`/organizer/events/${id}/details`);
  }

  function openRequirements(id: number) {
    navigate(`/organizer/events/${id}/requirements`);
  }

  function openLayout(id: number) {
    navigate(`/organizer/events/${id}/layout`);
  }

  function openApplications(id: number) {
    navigate(`/organizer/events/${id}/applications`);
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading events…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
          onClick={() => navigate("/organizer/events/create")}
        >
          + Create Event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-gray-600">
          No events yet. Create your first event to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 md:flex-row md:items-center"
            >
              <div>
                <div className="text-lg font-semibold">{ev.title || "Untitled Event"}</div>
                <div className="text-sm text-gray-500">
                  {ev.venue_name || "No venue"}
                  {ev.city && ev.state ? ` • ${ev.city}, ${ev.state}` : ""}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {ev.published ? "Published" : "Draft"}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* ✅ OPEN always goes to Details */}
                <button
                  className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
                  onClick={() => openDetails(ev.id)}
                >
                  Open
                </button>

                <button
                  className="rounded-lg border px-4 py-2 text-sm"
                  onClick={() => openRequirements(ev.id)}
                >
                  Requirements
                </button>

                <button
                  className="rounded-lg border px-4 py-2 text-sm"
                  onClick={() => openLayout(ev.id)}
                >
                  Layout
                </button>

                <button
                  className="rounded-lg border px-4 py-2 text-sm"
                  onClick={() => openApplications(ev.id)}
                >
                  Applications
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
