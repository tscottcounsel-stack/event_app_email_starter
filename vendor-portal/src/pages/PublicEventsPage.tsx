// src/pages/PublicEventsPage.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPublicEvents, type PublicEventListItem } from "../api";

export default function PublicEventsPage() {
  const [items, setItems] = useState<PublicEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await listPublicEvents(50, ac.signal);
        setItems(res.items ?? []);
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load public events");
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Public Events</h1>
          <div className="text-sm text-slate-600">Browse events (public feed)</div>
        </div>
        <Link to="/roles" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
          Choose Role
        </Link>
      </div>

      {error && <div className="rounded border bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {loading ? (
        <div className="rounded border p-4 text-sm text-slate-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded border p-4 text-sm text-slate-600">No events found.</div>
      ) : (
        <div className="divide-y rounded border bg-white">
          {items.map((e) => (
            <div key={e.id} className="p-4 flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">{e.title}</div>
                <div className="text-sm text-slate-600">
                  {e.city} • {e.location}
                </div>
                <div className="text-xs text-slate-500 mt-1">{e.date}</div>
              </div>

              {/* Safe navigation: doesn't call phantom endpoints */}
              <div className="flex gap-2">
                <Link
                  to={`/vendor/events/${e.id}/diagram`}
                  className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
                  title="Requires vendor auth for vendor diagram endpoint"
                >
                  View Vendor Map
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
