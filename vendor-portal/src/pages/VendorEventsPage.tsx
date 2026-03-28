import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

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
  heroImageUrl?: string | null;
  published?: boolean;
  archived?: boolean;
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

function isPublishedEvent(event: VendorEvent) {
  if (event?.archived === true) return false;
  if (event?.published === true) return true;

  const status = String(event?.status ?? "").trim().toLowerCase();
  return status === "published" || status === "live";
}

function dedupeEvents(items: VendorEvent[]) {
  const seen = new Set<string>();
  const out: VendorEvent[] = [];

  for (const item of items) {
    const key = normalizeEventId(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
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

async function tryFetchEvents(
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; events: VendorEvent[]; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const text = await res.text();
    let data: any = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        events: [],
        message:
          (data && (data.detail || data.message)) ||
          `Failed to load events (${res.status}).`,
      };
    }

    const rawEvents = Array.isArray(data)
      ? data
      : Array.isArray(data?.events)
        ? data.events
        : [];

    const normalized = dedupeEvents(
      rawEvents.filter((event: VendorEvent) => !!normalizeEventId(event))
    );

    return { ok: true, events: normalized };
  } catch {
    return { ok: false, events: [], message: "Failed to load events." };
  }
}

export default function VendorEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<VendorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        setLoading(true);
        setError(null);

        const session = readSession();

        const authedHeaders: Record<string, string> = {
          Accept: "application/json",
        };

        if (session?.accessToken) {
          authedHeaders.Authorization = `Bearer ${session.accessToken}`;
        }
        if (session?.email) {
          authedHeaders["x-user-email"] = session.email;
        }

        const publicHeaders: Record<string, string> = {
          Accept: "application/json",
        };

        const candidateRequests: Array<{
          url: string;
          headers: Record<string, string>;
          preferPublishedOnly?: boolean;
        }> = [
          { url: `${API_BASE}/vendor/events`, headers: authedHeaders, preferPublishedOnly: true },
          { url: `${API_BASE}/public/events`, headers: publicHeaders, preferPublishedOnly: false },
          { url: `${API_BASE}/events`, headers: authedHeaders, preferPublishedOnly: true },
        ];

        let loaded: VendorEvent[] = [];
        let lastMessage = "Failed to load events.";

        for (const request of candidateRequests) {
          const result = await tryFetchEvents(request.url, request.headers);

          if (!result.ok) {
            lastMessage = result.message || lastMessage;
            continue;
          }

          const nextEvents = request.preferPublishedOnly
            ? result.events.filter(isPublishedEvent)
            : result.events;

          if (nextEvents.length > 0) {
            loaded = nextEvents;
            lastMessage = "";
            break;
          }

          if (!loaded.length) {
            lastMessage = "";
          }
        }

        if (cancelled) return;

        setEvents(loaded);
        setError(lastMessage || null);
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
  }, []);

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
            const imageUrl =
              String(event?.heroImageUrl ?? event?.image_url ?? event?.banner_url ?? "").trim();

            return (
              <div
                key={eventId || `${title}-${dates}`}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={title}
                    className="h-48 w-full object-cover"
                  />
                ) : null}

                <div className="p-5">
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
