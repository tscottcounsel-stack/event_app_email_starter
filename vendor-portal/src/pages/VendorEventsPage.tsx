// src/pages/VendorEventsPage.tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPublicEvents, type PublicEventListItem } from "../api";

export default function VendorEventsPage() {
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
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load events");
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Vendor Events</h1>
        <div className="text-sm text-slate-600">
          Events you can browse and open the vendor diagram for.
        </div>
      </div>

      {error && <div className="rounded border bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {loading ? (
        <div className="rounded border p-4 text-sm text-slate-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded border p-4 text-sm text-slate-600">No events found.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.map((e) => (
            <div key={e.id} className="rounded border bg-white p-4 flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">{e.title}</div>
                <div className="text-sm text-slate-600">
                  {e.city} • {e.location}
                </div>
                <div className="text-xs text-slate-500 mt-1">{e.date}</div>
              </div>

              <div className="flex gap-2">
                <Link
                  to={`/vendor/events/${e.id}/diagram`}
                  className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Open Vendor Map
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
