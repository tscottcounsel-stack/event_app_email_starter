// vendor-portal/src/pages/OrganizerEventsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, fetchOrganizerEvents, getAccessToken, type OrganizerEventListItem } from "../api";

export default function OrganizerEventsPage() {
  const nav = useNavigate();

  const token = useMemo(() => getAccessToken(), []);
  const [items, setItems] = useState<OrganizerEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!token) {
      setError("Not logged in as organizer.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await fetchOrganizerEvents(token, 50, signal);
      setItems(res?.items ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load organizer events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Organizer Events</h1>
          <p className="text-sm text-slate-500">
            Manage events and jump into applications or the map editor.
          </p>
        </div>

        <button
          className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
          onClick={() => load()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500">No events found.</div>
      ) : (
        <div className="space-y-4">
          {items.map((e) => (
            <div key={e.id} className="rounded-xl border bg-white p-4">
              <div className="font-semibold">{e.title}</div>
              <div className="mt-1 text-sm text-slate-600">
                {e.date ? <span>{String(e.date).slice(0, 10)}</span> : <span>—</span>}
                <span className="mx-2">•</span>
                <span>
                  {e.location ? e.location : "Location TBD"}
                  {e.city ? ` • ${e.city}` : ""}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {/* ✅ Uses your existing route */}
                <button
                  className="rounded-md border px-3 py-2 hover:bg-slate-50"
                  onClick={() => nav(`/organizer/applications?eventId=${e.id}`)}
                >
                  Applications
                </button>

                {/* ✅ Uses your existing route */}
                <button
                  className="rounded-md border px-3 py-2 hover:bg-slate-50"
                  onClick={() => nav(`/organizer/events/${e.id}/map`)}
                >
                  Map Editor
                </button>

                {/* ✅ Opens the backend JSON since the frontend route isn't defined */}
                <a
                  className="rounded-md border px-3 py-2 hover:bg-slate-50"
                  href={`${API_BASE}/public/events/${e.id}/diagram`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Public Diagram (JSON)
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
