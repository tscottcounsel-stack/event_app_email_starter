// src/pages/OrganizerEventsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiGet } from "../api";

type OrganizerEvent = {
  id: number;
  title?: string;
  date?: string;
  city?: string;
  location?: string;
};

function formatDate(d?: string) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}

export default function OrganizerEventsPage() {
  const nav = useNavigate();

  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return copy;
  }, [events]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res: any = await apiGet<any>("/organizer/events");
      const list: OrganizerEvent[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.events)
        ? res.events
        : [];
      setEvents(list);
    } catch (e: any) {
      setErr(e?.message || "Failed to load organizer events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organizer Events</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage events and jump into applications or the map editor.
          </p>
        </div>

        <button
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
          onClick={() => load()}
        >
          Refresh
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="text-sm text-slate-600">No events found.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((e) => (
            <div key={e.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold">{e.title || `Event #${e.id}`}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    <span>{formatDate(e.date)}</span>
                    <span className="mx-2">•</span>
                    <span>{e.location || "—"}</span>
                    <span className="mx-2">•</span>
                    <span>{e.city || "—"}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-sm sm:mt-0">
                  {/* ✅ Open = Event Detail page */}
                  <button
                    className="rounded-full bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
                    onClick={() => nav(`/organizer/events/${e.id}`)}
                  >
                    Open
                  </button>

                  {/* ✅ Uses your existing route */}
                  <button
                    className="rounded-full border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50"
                    onClick={() => nav(`/organizer/applications?eventId=${e.id}`)}
                  >
                    Applications
                  </button>

                  <button
                    className="rounded-full border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50"
                    onClick={() => nav(`/organizer/events/${e.id}/map`)}
                  >
                    Map Editor
                  </button>

                  <a
                    className="rounded-full border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50"
                    href={`${API_BASE}/public/events/${e.id}/diagram`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Public Diagram (JSON)
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
