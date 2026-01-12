// vendor-portal/src/pages/OrganizerApplicationsPage.tsx
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ApiError,
  apiPatch,
  organizerListEventApplications,
  getAccessToken,
} from "../api";

function toInt(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function errToString(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || "Error";
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

type AppRow = {
  id: number;
  vendor_profile_id?: number | null;
  status?: string | null;
  payment_status?: string | null;
  assigned_slot_id?: number | null;
};

export default function OrganizerApplicationsPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const eventId = toInt(sp.get("eventId"));
  const token = getAccessToken();

  const [items, setItems] = React.useState<AppRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    // Always reset UI first
    setLoading(true);
    setError(null);

    if (!token) {
      setItems([]);
      setError("Organizer token missing. Please login.");
      setLoading(false);
      return;
    }
    if (!eventId) {
      setItems([]);
      setError("Missing eventId. Go to Organizer Events and click Applications.");
      setLoading(false);
      return;
    }

    try {
      const res: any = await organizerListEventApplications(eventId, 200, token);
      const list = Array.isArray(res?.items) ? res.items : [];
      setItems(list);
    } catch (e: any) {
      // Prefer ApiError formatting if available
      if (e instanceof ApiError) {
        setError(`${e.message} (HTTP ${e.status})`);
      } else if (e?.message) {
        setError(String(e.message));
      } else {
        setError(errToString(e));
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function act(appId: number, patch: Record<string, any>) {
    if (!token || !eventId) return;

    setBusyId(appId);
    setError(null);

    try {
      // Keep your existing assumption; if backend differs, we’ll adjust later.
      await apiPatch(`/organizer/events/${eventId}/applications/${appId}`, patch, token);
      await load();
    } catch (e: any) {
      if (e instanceof ApiError) setError(`${e.message} (HTTP ${e.status})`);
      else if (e?.message) setError(String(e.message));
      else setError(errToString(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">
            Applications for Event #{eventId ?? "—"}
          </div>
          <div className="text-sm text-slate-500">
            Uses{" "}
            <span className="font-mono">/organizer/events/{`{event_id}`}/applications</span>
          </div>

          {/* Debug line (remove later) */}
          <div className="mt-1 text-xs text-slate-400">
            Debug: token={token ? "yes" : "no"}, eventId={eventId ?? "—"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => nav("/organizer/events")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            ← Back to events
          </button>
          <button
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <div className="mt-6 text-sm text-slate-500">Loading…</div>}

      {!loading && error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
          No applications yet for this event.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-12 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
            <div className="col-span-4">Application</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Payment</div>
            <div className="col-span-2">Booth</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {items.map((a) => (
            <div key={a.id} className="grid grid-cols-12 items-center px-4 py-3 text-sm">
              <div className="col-span-4">
                <div className="font-semibold">#{a.id}</div>
                <div className="text-xs text-slate-500">
                  vendor_profile_id: {a.vendor_profile_id ?? "—"}
                </div>
              </div>

              <div className="col-span-2">{a.status ?? "—"}</div>
              <div className="col-span-2">{a.payment_status ?? "—"}</div>
              <div className="col-span-2">{a.assigned_slot_id ?? "—"}</div>

              <div className="col-span-2 flex justify-end gap-2">
                <button
                  disabled={busyId === a.id}
                  onClick={() => void act(a.id, { status: "approved" })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  disabled={busyId === a.id}
                  onClick={() => void act(a.id, { status: "rejected" })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
