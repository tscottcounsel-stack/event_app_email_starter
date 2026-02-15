import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type VendorEvent = {
  id: number | string;
  title?: string;
  name?: string;
  status?: string; // draft/published/etc
  venue_name?: string;
  city?: string;
  state?: string;
  start_date?: string;
  end_date?: string;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function pickList(data: any): VendorEvent[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function prettyStatus(s?: string) {
  const v = String(s || "").toLowerCase();
  if (!v) return null;
  if (v.includes("draft")) return "Draft";
  if (v.includes("publish")) return "Published";
  if (v.includes("archive")) return "Archived";
  return s;
}

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return await res.json();
}

export default function VendorAvailableEventsPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<VendorEvent[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      // Try the most likely endpoints.
      // NOTE: We are intentionally NOT using "/api/..." because that hits Vite (5173),
      // not FastAPI (8002).
      const candidates = [
        "/vendor/events",
        "/public/events",
        "/events",
        "/api/vendor/events", // in case your FastAPI actually uses /api prefix
        "/api/events",
      ];

      let data: any = null;
      let lastErr: any = null;

      for (const p of candidates) {
        try {
          data = await getJson(p);
          const list = pickList(data);
          if (list.length) {
            setEvents(list);
            setLoading(false);
            return;
          }

          // If endpoint returns an empty array, still accept it as a valid endpoint.
          if (Array.isArray(data) || Array.isArray(data?.events) || Array.isArray(data?.items)) {
            setEvents(list);
            setLoading(false);
            return;
          }
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error("No vendor events endpoint returned data.");
    } catch (e: any) {
      setError(e?.message || "Unable to load events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const cards = useMemo(() => {
    return (events || []).map((ev) => {
      const id = normalizeId(ev.id);
      const title = ev.title || ev.name || `Event ${id}`;
      const status = prettyStatus(ev.status);
      const venueLine = [ev.venue_name, ev.city, ev.state].filter(Boolean).join(" • ");
      return { id, title, status, venueLine };
    });
  }, [events]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-3xl font-black text-slate-900">Available Events</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Browse events and continue your application.
            </div>
            <div className="mt-1 text-xs text-slate-500">
              API: <span className="font-mono">{API_BASE}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {error}
              <div className="mt-2 text-xs text-rose-700">
                If you see requests going to <span className="font-mono">localhost:5173</span>, that’s the Vite dev
                server. Vendor events must come from <span className="font-mono">127.0.0.1:8002</span>.
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
              Loading…
            </div>
          ) : null}

          {!loading && cards.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No events are available yet.
              <div className="mt-1 text-xs text-slate-500">
                If your organizer event is still “Draft”, it may not be published to vendors (depending on backend rules).
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {cards.map((c) => (
              <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-black text-slate-900">{c.title}</div>
                    {c.venueLine ? (
                      <div className="mt-1 text-sm font-semibold text-slate-600">{c.venueLine}</div>
                    ) : null}
                  </div>

                  {c.status ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                      {c.status}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 text-sm font-semibold text-orange-600">
                  Draft saved — continue where you left off.
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => navigate(`/vendor/events/${encodeURIComponent(c.id)}`)}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3 text-base font-black text-white hover:opacity-95"
                  >
                    Continue Application
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
