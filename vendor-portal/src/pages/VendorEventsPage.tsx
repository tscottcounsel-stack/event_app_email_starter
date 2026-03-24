import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "https://event-app-api-production-f382.up.railway.app";

type VendorEvent = {
  id?: number | string;
  event_id?: number | string;
  eventId?: number | string;
  _id?: number | string;
  uuid?: string;
  slug?: string;
  title?: string;
  name?: string;
  description?: string;
  venue_name?: string;
  venue?: string;
  city?: string;
  state?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  event_date?: string;
  date?: string;
  image_url?: string | null;
  banner_url?: string | null;
  published?: boolean;
  status?: string;
  [key: string]: any;
};

function normalizeEventId(event: VendorEvent): string {
  const raw =
    event?.id ??
    event?.event_id ??
    event?.eventId ??
    event?._id ??
    event?.uuid ??
    event?.slug ??
    "";

  return String(raw).trim();
}

function formatDateRange(start?: string, end?: string, fallback?: string) {
  if (!start && !end && fallback) return String(fallback);
  if (!start && !end) return "Dates TBD";

  const fmt = (value?: string) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };

  const s = fmt(start);
  const e = fmt(end);

  if (s && e) return `${s} – ${e}`;
  return s || e || fallback || "Dates TBD";
}

function locationLine(event: VendorEvent) {
  if (event?.location) return String(event.location);

  const venue = String(event?.venue_name ?? event?.venue ?? "").trim();
  const city = String(event?.city ?? "").trim();
  const state = String(event?.state ?? "").trim();

  const parts = [venue, [city, state].filter(Boolean).join(", ")]
    .map((v) => v.trim())
    .filter(Boolean);

  return parts.join(" • ") || "Location TBD";
}

export default function VendorEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<VendorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const session = useMemo(() => readSession(), []);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        setLoading(true);
        setError(null);

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (session?.accessToken) {
          headers["Authorization"] = `Bearer ${session.accessToken}`;
        }
        if (session?.email) {
          headers["x-user-email"] = session.email;
        }

        console.log("VendorEventsPage API_BASE:", API_BASE);

        const candidateUrls = [`${API_BASE}/vendor/events`, `${API_BASE}/events`];

        let loaded: VendorEvent[] = [];
        let lastMessage = "Failed to load events.";
        let foundSuccessfulResponse = false;
        let foundSuccessfulEmptyResponse = false;

        for (const url of candidateUrls) {
          try {
            console.log("Fetching events from:", url);

            const res = await fetch(url, { method: "GET", headers });
            const text = await res.text();

            let data: any = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch {
                data = null;
              }
            }

            console.log("Events response status:", url, res.status);
            console.log("Events response data:", url, data);

            if (!res.ok) {
              lastMessage =
                (data && (data.detail || data.message)) ||
                `Failed to load events (${res.status}).`;
              continue;
            }

            const nextEvents = Array.isArray(data)
              ? data
              : Array.isArray(data?.events)
                ? data.events
                : [];

            console.log("Normalized events:", nextEvents);

            if (nextEvents.length > 0) {
              loaded = nextEvents;
              foundSuccessfulResponse = true;
              foundSuccessfulEmptyResponse = false;
              lastMessage = "";
              break;
            }

            foundSuccessfulEmptyResponse = true;
            lastMessage = "";
          } catch (err) {
            console.warn("Failed URL:", url, err);
            lastMessage = "Failed to load events.";
          }
        }

        if (cancelled) return;

        setEvents(loaded);
        setError(foundSuccessfulResponse || foundSuccessfulEmptyResponse ? null : lastMessage);
      } catch (err: any) {
        if (!cancelled) {
          setEvents([]);
          setError(err?.message || "Failed to load events.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, session?.email]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-black text-slate-900">Available Events</h1>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-slate-600">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-600">
          No events available right now.
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {events.map((event) => {
            const eventId = normalizeEventId(event);
            const title = String(event?.title ?? event?.name ?? "Untitled Event");
            const location = locationLine(event);
            const dates = formatDateRange(
              event?.start_date,
              event?.end_date,
              String(event?.event_date ?? event?.date ?? "Dates TBD")
            );

            console.log("EVENT CARD:", event);
            console.log("EVENT ID USED:", eventId);

            return (
              <div
                key={eventId || `${title}-${dates}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="text-3xl font-black text-slate-900">{title}</div>

                <div className="mt-2 text-lg text-slate-600">{location}</div>

                <div className="mt-1 text-lg text-slate-600">{dates}</div>

                {event?.description ? (
                  <div className="mt-3 text-sm text-slate-600">{String(event.description)}</div>
                ) : null}

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => navigate(`/vendor/events/${eventId}`)}
                    disabled={!eventId}
                    className="rounded-lg bg-violet-600 px-5 py-3 font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    View Event
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
