import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type EventRow = {
  id: number;
  name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  venue_name?: string;
  city?: string;
  state?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8002";

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function label(ev: EventRow) {
  return ev.name || ev.title || `Event #${ev.id}`;
}

export default function VendorEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setError("");
        setLoading(true);
        const data: any = await apiGet("/events");
        const list = data?.events || data?.data || data || [];
        setEvents(Array.isArray(list) ? list : []);
      } catch (e: any) {
        setError(e?.message || "Failed to load events");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Events</h1>
          <p className="mt-1 text-slate-600">Browse events and apply.</p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="text-slate-600">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-slate-600">No events found.</div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {label(ev)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {ev.venue_name || ""}{" "}
                    {[ev.city, ev.state].filter(Boolean).join(", ")}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => navigate(`/vendor/events/${ev.id}`)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  >
                    View
                  </button>
                  <button
                    onClick={() => navigate(`/vendor/events/${ev.id}/apply`)}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
