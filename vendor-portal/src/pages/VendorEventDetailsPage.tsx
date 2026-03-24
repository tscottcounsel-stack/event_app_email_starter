import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";
import { getAppIdFromSearch } from "../utils/applicationId";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://127.0.0.1:8002";

type EventModel = {
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
  location?: string;
  city?: string;
  state?: string;
  start_date?: string;
  end_date?: string;
  event_date?: string;
  date?: string;
  banner_url?: string | null;
  image_url?: string | null;
};

function formatDateRange(start?: string, end?: string, single?: string) {
  if (single && String(single).trim()) {
    const d = new Date(single);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
    return String(single);
  }

  if (!start && !end) return "Dates TBD";

  const fmt = (value?: string) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };

  const s = fmt(start);
  const e = fmt(end);

  if (s && e) return `${s} – ${e}`;
  return s || e;
}

function locationLine(e: EventModel) {
  if (e?.location && String(e.location).trim()) {
    return String(e.location).trim();
  }

  const venue = e?.venue_name ?? e?.venue ?? "";
  const city = e?.city ?? "";
  const state = e?.state ?? "";

  const parts = [venue, [city, state].filter(Boolean).join(", ")]
    .map((v) => String(v).trim())
    .filter(Boolean);

  return parts.join(" • ") || "Location TBD";
}

function matchesEventId(event: EventModel, eventId: string) {
  const candidates = [
    event?.id,
    event?.event_id,
    event?.eventId,
    event?._id,
    event?.uuid,
    event?.slug,
  ]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => String(v));

  return candidates.includes(String(eventId));
}

export default function VendorEventDetailsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [search] = useSearchParams();

  const session = useMemo(() => readSession(), []);

  const [event, setEvent] = useState<EventModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const appId = getAppIdFromSearch(search);

  useEffect(() => {
    if (eventId && appId) {
      navigate(
        `/vendor/events/${encodeURIComponent(String(eventId))}/requirements?appId=${encodeURIComponent(appId)}`,
        { replace: true }
      );
      return;
    }

    let cancelled = false;

    async function loadEvent() {
      try {
        setLoading(true);
        setError(null);

        if (!eventId) {
          throw new Error("Missing event id.");
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (session?.accessToken) {
          headers["Authorization"] = `Bearer ${session.accessToken}`;
        }

        if (session?.email) {
          headers["x-user-email"] = session.email;
        }

        console.log("VendorEventDetailsPage API_BASE:", API_BASE);
        console.log("VendorEventDetailsPage eventId:", eventId);

        const detailRes = await fetch(`${API_BASE}/events/${encodeURIComponent(String(eventId))}`, {
          headers,
        });

        const detailText = await detailRes.text();
        const detailData = detailText
          ? (() => {
              try {
                return JSON.parse(detailText);
              } catch {
                return null;
              }
            })()
          : null;

        if (detailRes.ok) {
          if (!cancelled) {
            setEvent(detailData);
          }
          return;
        }

        console.warn("Direct event lookup failed, falling back to /events list:", detailRes.status, detailData);

        const listRes = await fetch(`${API_BASE}/events`, { headers });
        const listText = await listRes.text();
        const listData = listText
          ? (() => {
              try {
                return JSON.parse(listText);
              } catch {
                return null;
              }
            })()
          : null;

        if (!listRes.ok) {
          throw new Error(detailData?.detail || listData?.detail || "Failed to load event.");
        }

        const events: EventModel[] = Array.isArray(listData)
          ? listData
          : Array.isArray(listData?.events)
            ? listData.events
            : [];

        console.log("Fallback /events payload:", events);

        let resolved: EventModel | null = events.find((e) => matchesEventId(e, String(eventId))) ?? null;

        if (!resolved) {
          const numericIndex = Number(String(eventId));
          if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= events.length) {
            resolved = events[numericIndex - 1] ?? null;
          }
        }

        if (!resolved) {
          throw new Error("Event not found");
        }

        if (!cancelled) {
          setEvent(resolved);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load event.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadEvent();

    return () => {
      cancelled = true;
    };
  }, [appId, eventId, navigate, session?.accessToken, session?.email]);


  function goToBoothMap() {
    if (!eventId) return;

    const qs = appId ? `?appId=${encodeURIComponent(appId)}` : "";
    navigate(`/vendor/events/${eventId}/map${qs}`);
  }

  if (loading) {
    return <div className="p-6 text-slate-600">Loading event…</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!event) {
    return <div className="p-6">Event not found.</div>;
  }

  const title = event.title ?? event.name ?? "Untitled Event";
  const banner = event.banner_url ?? event.image_url ?? "";

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/vendor/events")}
        className="border px-4 py-2 rounded-lg"
      >
        ← Back to Events
      </button>

      {banner ? (
        <img
          src={banner}
          alt={title}
          className="rounded-xl w-full max-h-[300px] object-cover"
        />
      ) : null}

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <h1 className="text-4xl font-black text-slate-900">{title}</h1>

        <div className="text-lg text-slate-600">{locationLine(event)}</div>

        <div className="text-lg text-slate-600">
          {formatDateRange(event.start_date, event.end_date, event.event_date ?? event.date)}
        </div>

        <div className="text-slate-700">
          {event.description || "No description provided."}
        </div>

        <div className="flex gap-3 pt-3">
          <button
            type="button"
            onClick={goToBoothMap}
            className="bg-purple-600 text-white px-5 py-2 rounded-lg hover:bg-purple-700 transition"
          >
            Apply Now
          </button>
        </div>
      </div>
    </div>
  );
}
