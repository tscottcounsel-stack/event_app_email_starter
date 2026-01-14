// vendor-portal/src/pages/OrganizerApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_BASE, getAccessToken } from "../api";

type ApplicationItem = {
  id: number;
  status?: string;
  created_at?: string;
  vendor_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
};

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function isAbortError(e: any) {
  const msg = String(e?.message || "").toLowerCase();
  return e?.name === "AbortError" || msg.includes("aborted");
}

export default function OrganizerApplicationsPage() {
  const nav = useNavigate();
  const q = useQuery();

  const token = useMemo(() => getAccessToken(), []);
  const eventId = Number(q.get("eventId") || "");
  const hasEventId = Number.isFinite(eventId) && eventId > 0;

  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!token) {
      setError("Not logged in as organizer.");
      return;
    }
    if (!hasEventId) {
      setItems([]);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${API_BASE}/organizer/events/${eventId}/applications`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to load applications (${res.status})`);
      }

      const data: any = await res.json().catch(() => null);
      const list: ApplicationItem[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.applications)
        ? data.applications
        : [];

      setItems(list);
    } catch (e: any) {
      if (isAbortError(e)) return;
      setError(e?.message || "Failed to load applications");
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
          <h1 className="text-2xl font-semibold tracking-tight">Applicants</h1>
          <p className="mt-1 text-sm text-slate-600">
            {hasEventId ? (
              <>Applications for Event #{eventId}</>
            ) : (
              <>Applicants are managed inside an event.</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={() => nav("/organizer/events")}
          >
            Back to Events
          </button>

          {hasEventId && (
            <button
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => nav(`/organizer/events/${eventId}`)}
              title="Back to event details"
            >
              Back to Event
            </button>
          )}

          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={() => load()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {!hasEventId && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          Missing <span className="font-mono">eventId</span>. Open applications from an Event card.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {hasEventId && loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : hasEventId && items.length === 0 && !error ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No applications yet.
        </div>
      ) : hasEventId ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="text-base font-semibold">Applications</div>
            <div className="text-sm text-slate-500">{items.length} total</div>
          </div>

          <div className="divide-y divide-slate-100">
            {items.map((a) => (
              <div key={a.id} className="px-6 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      {a.business_name || a.vendor_name || `Application #${a.id}`}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {a.email ? <span>{a.email}</span> : null}
                      {a.email && a.phone ? <span className="mx-2">•</span> : null}
                      {a.phone ? <span>{a.phone}</span> : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                      {a.status || "pending"}
                    </span>
                    {/* Approval/deny actions can be wired later — we keep it stable for now */}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
