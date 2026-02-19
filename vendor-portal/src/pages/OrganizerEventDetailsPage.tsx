import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventRecord = {
  id: number | string;
  title?: string;
  description?: string;

  start_date?: string;
  end_date?: string;

  venue_name?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;

  category?: string;
  google_maps_url?: string;

  published?: boolean;
  archived?: boolean;

  requirements_published?: boolean;
  layout_published?: boolean;
};

type ApplicationRecord = {
  id: number | string;
  event_id?: number | string;
  vendor_name?: string;
  booth_label?: string;
  status?: string;
  created_at?: string;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

function fmtDate(d?: string) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function fmtDateRange(start?: string, end?: string) {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s === "—" && e === "—") return "—";
  if (s !== "—" && e !== "—") return `${s} – ${e}`;
  return s !== "—" ? s : e;
}

function pillClass(kind: "complete" | "draft" | "archived") {
  switch (kind) {
    case "archived":
      return "bg-slate-100 text-slate-700";
    case "complete":
      return "bg-emerald-50 text-emerald-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

export default function OrganizerEventDetailsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const id = eventId ? String(eventId) : "";

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [apps, setApps] = useState<ApplicationRecord[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingApps, setLoadingApps] = useState(true);
  const [errEvent, setErrEvent] = useState<string | null>(null);
  const [errApps, setErrApps] = useState<string | null>(null);

  async function loadEvent() {
    if (!id) return;

    setLoadingEvent(true);
    setErrEvent(null);

    const candidates = [
      `/organizer/events/${id}`,
      `/organizer/events/${id}/details`,
      `/events/${id}`,
    ];

    for (const path of candidates) {
      try {
        const data = await getJson<any>(path);
        const ev: EventRecord =
          data?.event && typeof data.event === "object" ? data.event : data;
        setEvent(ev);
        setLoadingEvent(false);
        return;
      } catch {
        // try next
      }
    }

    setErrEvent("Could not load event details (endpoint not found).");
    setEvent(null);
    setLoadingEvent(false);
  }

  async function loadApplications() {
    if (!id) return;

    setLoadingApps(true);
    setErrApps(null);

    const candidates = [
      `/organizer/events/${id}/applications`,
      `/organizer/applications?event_id=${encodeURIComponent(id)}`,
    ];

    for (const path of candidates) {
      try {
        const data = await getJson<any>(path);
        const list: ApplicationRecord[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.applications)
          ? data.applications
          : Array.isArray(data?.items)
          ? data.items
          : [];
        setApps(list);
        setLoadingApps(false);
        return;
      } catch {
        // try next
      }
    }

    // apps not wired yet => empty state (don’t show error)
    setApps([]);
    setErrApps(null);
    setLoadingApps(false);
  }

  useEffect(() => {
    loadEvent();
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const statusKind = useMemo(() => {
    if (event?.archived) return "archived" as const;
    if (event?.published) return "complete" as const;
    return "draft" as const;
  }, [event]);

  const statusLabel = useMemo(() => {
    if (statusKind === "archived") return "Archived";
    if (statusKind === "complete") return "Complete";
    return "Draft / In Progress";
  }, [statusKind]);

  const locationLine = useMemo(() => {
    const parts = [event?.venue_name, event?.city, event?.state, event?.zip_code].filter(Boolean);
    return parts.length ? parts.join(" • ") : "—";
  }, [event]);

  return (
    <div className="w-full">
      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate("/organizer/dashboard")}
            className="text-sm font-black text-slate-700 hover:text-slate-900"
          >
            ← Back to Dashboard
          </button>

          <div className="mt-4 text-4xl font-black tracking-tight text-slate-900">
            {loadingEvent ? "Loading…" : event?.title || `Event ${id}`}
          </div>

          <div className="mt-2 text-sm font-semibold text-slate-600">
            {loadingEvent ? "—" : `${fmtDateRange(event?.start_date, event?.end_date)} • ${locationLine}`}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-black ${pillClass(statusKind)}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {errEvent && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {errEvent}
        </div>
      )}

      {/* Actions */}
<button
  type="button"
  className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700"
  onClick={async () => {
    if (!window.confirm("Delete this event and all applications?")) return;

    const res = await fetch(`${API_BASE}/organizer/events/${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      navigate("/organizer");
    } else {
      alert("Failed to delete event.");
    }
  }}
>
  Delete Event
</button>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigate(`/organizer/events/${id}/details`)}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
        >
          Details
        </button>

        <button
          type="button"
          onClick={() => navigate(`/organizer/events/${id}/layout`)}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
        >
          Edit Layout
        </button>

        <button
          type="button"
          onClick={() => navigate(`/organizer/events/${id}/requirements`)}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
        >
          Edit Requirements
        </button>

        <button
          type="button"
          onClick={() => navigate(`/organizer/events/${id}/applications`)}
          className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700"
        >
          Applications
        </button>
      </div>

      {/* Content grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-black text-slate-900">Event Details</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              What vendors and the public will see.
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase text-slate-500">Date Range</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {loadingEvent ? "—" : fmtDateRange(event?.start_date, event?.end_date)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase text-slate-500">Venue / Location</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {loadingEvent ? "—" : locationLine}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                <div className="text-xs font-black uppercase text-slate-500">Address</div>
                <div className="mt-2 text-sm font-black text-slate-900">
                  {loadingEvent
                    ? "—"
                    : [event?.street_address, event?.city, event?.state, event?.zip_code]
                        .filter(Boolean)
                        .join(", ") || "—"}
                </div>

                {event?.google_maps_url && (
                  <a
                    className="mt-2 inline-block text-sm font-black text-indigo-700 hover:text-indigo-900"
                    href={event.google_maps_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps →
                  </a>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                <div className="text-xs font-black uppercase text-slate-500">Description</div>
                <div className="mt-2 text-sm font-semibold text-slate-800 whitespace-pre-wrap">
                  {loadingEvent ? "—" : event?.description || "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-black text-slate-900">Applications</div>
                <div className="mt-1 text-sm font-semibold text-slate-600">
                  Vendors applying to this event.
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/organizer/events/${id}/applications`)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              >
                View All
              </button>
            </div>

            {errApps && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {errApps}
              </div>
            )}

            <div className="mt-5 space-y-3">
              {loadingApps && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                  Loading applications…
                </div>
              )}

              {!loadingApps && apps.length === 0 && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                  No applications yet.
                  <div className="mt-2 text-xs font-semibold text-slate-500">
                    Once vendors submit applications, they’ll show up here.
                  </div>
                </div>
              )}

              {!loadingApps &&
                apps.slice(0, 5).map((a) => (
                  <div key={String(a.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-black text-slate-900">
                      {a.vendor_name || `Application ${a.id}`}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-600">
                      {a.booth_label ? `Booth: ${a.booth_label} • ` : ""}
                      {a.status ? `Status: ${a.status}` : "Status: —"}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-black text-slate-900">Vendor Preview</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              See what vendors see for this event.
            </div>
            <button
              type="button"
              onClick={() => navigate(`/vendor/events/${id}`)}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
            >
              Open Vendor View
            </button>
          </div>
        </div>
      </div>

      <div className="h-10" />
    </div>
  );
}
