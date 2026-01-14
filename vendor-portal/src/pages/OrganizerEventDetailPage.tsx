// vendor-portal/src/pages/OrganizerEventDetailPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE, fetchOrganizerEvents, getAccessToken, type OrganizerEventListItem } from "../api";

function isAbortError(e: any) {
  const msg = String(e?.message || "").toLowerCase();
  return e?.name === "AbortError" || msg.includes("aborted");
}

export default function OrganizerEventDetailPage() {
  const nav = useNavigate();
  const { eventId: eventIdParam } = useParams();
  const eventId = Number(eventIdParam || "");

  const token = useMemo(() => getAccessToken(), []);
  const [event, setEvent] = useState<OrganizerEventListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!token) {
      setError("Not logged in as organizer.");
      setLoading(false);
      return;
    }
    if (!Number.isFinite(eventId) || eventId <= 0) {
      setError("Invalid event id.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Reuse your working list endpoint for stability
      const res = await fetchOrganizerEvents(token, 200, signal);
      const found = (res?.items ?? []).find((x) => Number(x.id) === eventId) ?? null;
      setEvent(found);
    } catch (e: any) {
      if (isAbortError(e)) return;
      setError(e?.message || "Failed to load event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            className="text-sm text-slate-600 hover:text-slate-900"
            onClick={() => nav("/organizer/events")}
          >
            ← Back to events
          </button>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {event?.title || `Event #${eventId}`}
          </h1>

          <div className="mt-1 text-sm text-slate-600">
            {event?.date ? `${String(event.date).slice(0, 10)} • ` : ""}
            {event?.location || "Location TBD"}
            {event?.city ? ` • ${event.city}` : ""}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={() => load()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Applicants</div>
            <div className="mt-1 text-sm text-slate-600">
              Review and approve vendor applications for this event.
            </div>

            <button
              className="mt-4 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => nav(`/organizer/applications?eventId=${eventId}`)}
            >
              Open Applicants
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Map Editor</div>
            <div className="mt-1 text-sm text-slate-600">
              Edit booth layout and slot settings.
            </div>

            <button
              className="mt-4 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              onClick={() => nav(`/organizer/events/${eventId}/map`)}
            >
              Open Map Editor
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-base font-semibold">Map Layout</div>
            <div className="mt-1 text-sm text-slate-600">
              Current diagram output (JSON for now).
            </div>

            <a
              className="mt-4 inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              href={`${API_BASE}/public/events/${eventId}/diagram`}
              target="_blank"
              rel="noreferrer"
            >
              Open Diagram (JSON)
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
