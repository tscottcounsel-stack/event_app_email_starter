// vendor-portal/src/pages/VendorEventsPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export interface VendorEvent {
  id: number;
  name: string;
  location: string;
  date: string;
  description: string;
}

const VendorEventsPage: React.FC = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState<VendorEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[VendorEventsPage] RENDERING VENDOR EVENTS PAGE");

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // TODO: replace with real API call
        // For now, fake data so the page loads and we can debug routing.
        const fakeEvents: VendorEvent[] = [
          {
            id: 52,
            name: "Winter Party",
            location: "home",
            date: "2025-01-27",
            description: "",
          },
          {
            id: 49,
            name: "Atlanta Fall Festival",
            location: "Atlanta, GA",
            date: "2025-11-10",
            description: "Food, art, music.",
          },
        ];

        if (!cancelled) {
          setEvents(fakeEvents);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Unable to load events.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleViewDiagram(eventId: number) {
    navigate(`/vendor/events/${eventId}/diagram`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              EP
            </div>
            <span className="font-semibold text-slate-900">Event Portal</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              Vendor view
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-2">Events for you</h1>
        <p className="text-sm text-slate-600 mb-4">
          Browse events you can apply to. Once you've applied, they'll
          eventually show up under "My events" with your application status.
        </p>

        {loading && <p className="text-sm text-slate-500">Loading events…</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="space-y-4 mt-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-2xl border border-emerald-400 bg-white shadow-sm p-4 cursor-pointer"
              onClick={() => handleViewDiagram(event.id)}
            >
              <div className="text-xs text-slate-500 mb-1">
                {new Date(event.date).toLocaleDateString()}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">
                    {event.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {event.location}
                  </div>
                  {event.description && (
                    <div className="mt-1 text-xs text-slate-600">
                      {event.description}
                    </div>
                  )}
                </div>
                <div className="text-sm text-emerald-600 font-medium">
                  View map &amp; apply →
                </div>
              </div>
            </div>
          ))}

          {!loading && !error && events.length === 0 && (
            <p className="text-sm text-slate-500">
              No events are available right now.
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

export default VendorEventsPage;
