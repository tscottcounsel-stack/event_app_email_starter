// src/pages/OrganizerEventsPage.tsx
//
// Organizer events list + control center.
// - Lists all organizer events from /organizer/events
// - Buttons on each row navigate to Applications, Diagram, Map editor, Edit event
// - Top-right is reserved for "Create new event" + Organizer profile

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";

type OrganizerEvent = {
  id: number;
  title: string;
  description?: string | null;
  date?: string | null;
  city?: string | null;
  location?: string | null;
};

function formatEventDate(date?: string | null): string {
  if (!date) return "Date TBA";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const OrganizerEventsPage: React.FC = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await apiGet<OrganizerEvent[]>("/organizer/events");
        if (!cancelled) {
          setEvents(Array.isArray(data) ? data : []);
        }
      } catch (err: any) {
        console.error("Failed to load organizer events", err);
        if (!cancelled) {
          setError(
            err?.detail ??
              err?.message ??
              "Failed to load events. Please try again."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenProfile = () => {
    navigate("/organizer/profile");
  };

  const handleCreateEvent = () => {
    // NOTE: this assumes you’ll have a route like /organizer/events/new.
    // If you prefer /organizer/events/create or a different path,
    // just change this one line.
    navigate("/organizer/events/new");
  };

  const handleOpenApplications = (eventId: number) => {
    navigate(`/organizer/events/${eventId}/applications`);
  };

  const handleOpenDiagram = (eventId: number) => {
    // Read-only diagram / overview
    navigate(`/organizer/events/${eventId}/diagram`);
  };

  const handleOpenMapEditor = (eventId: number) => {
    // Full map editor (if you have a dedicated editor route)
    // If everything lives on /diagram, you can point this there instead.
    navigate(`/organizer/events/${eventId}/diagram/editor`);
  };

  const handleEditEvent = (eventId: number) => {
    navigate(`/organizer/events/${eventId}/edit`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Top header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
              Organizer · Events
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-50">
              Your events
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage applications, diagrams, invites, and capacity plans.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Create event – you can wire this up now or later */}
            <button
              type="button"
              onClick={handleCreateEvent}
              className="inline-flex items-center rounded-full border border-violet-500/70 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-100 hover:bg-violet-500/20 active:scale-[0.98] transition"
            >
              + Create new event
            </button>

            <button
              type="button"
              onClick={handleOpenProfile}
              className="inline-flex items-center rounded-full bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 active:scale-[0.98] transition"
            >
              Organizer profile
            </button>
          </div>
        </div>

        {/* Loading / error states */}
        {loading && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-6 text-sm text-slate-300">
            Loading events…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-600/60 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-10 text-sm text-slate-300">
            <p className="font-medium">No events yet.</p>
            <p className="mt-2">
              When you’re ready, click{" "}
              <span className="font-semibold">“Create new event”</span> to set
              up your first event.
            </p>
          </div>
        )}

        {/* Events list */}
        {!loading && !error && events.length > 0 && (
          <div className="space-y-4">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 md:flex-row md:items-center md:justify-between"
              >
                {/* Left: event info */}
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-slate-50">
                      {ev.title || "Untitled event"}
                    </h2>
                    <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                      ID: {ev.id}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400">
                    {formatEventDate(ev.date)}
                    {ev.location && (
                      <>
                        {" · "}
                        <span>{ev.location}</span>
                      </>
                    )}
                    {ev.city && (
                      <>
                        {" · "}
                        <span>{ev.city}</span>
                      </>
                    )}
                  </div>
                  {ev.description && (
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {ev.description}
                    </p>
                  )}
                </div>

                {/* Right: actions – ALL CLICKABLE */}
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    onClick={() => handleOpenApplications(ev.id)}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 active:scale-[0.98] transition"
                  >
                    Applications
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenDiagram(ev.id)}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 active:scale-[0.98] transition"
                  >
                    Diagram
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenMapEditor(ev.id)}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 active:scale-[0.98] transition"
                  >
                    Map editor
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditEvent(ev.id)}
                    className="rounded-full border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 active:scale-[0.98] transition"
                  >
                    Edit event
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizerEventsPage;
