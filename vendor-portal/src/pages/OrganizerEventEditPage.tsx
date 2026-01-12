import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

type EventOut = {
  id: number;
  title?: string | null;
  description?: string | null;
  date?: string | null;
  city?: string | null;
  location?: string | null;

  // extra fields may exist on the server; we ignore them for PATCH (contract)
  kind?: string | null;
};

function toDateInput(v?: string | null) {
  if (!v) return "";
  // handles: "2026-04-01", "2026-04-01T00:00:00", "2026-04-01T00:00:00-05:00"
  return v.toString().slice(0, 10);
}

export default function OrganizerEventEditPage() {
  const nav = useNavigate();
  const params = useParams();

  const eventId = useMemo(() => {
    const raw = (params as any).eventId ?? (params as any).id; // support both route styles
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<Required<Pick<EventOut, "id" | "title" | "description" | "date" | "city" | "location">>>({
    id: 0,
    title: "",
    description: "",
    date: "",
    city: "",
    location: "",
  });

  async function load() {
    if (!eventId) {
      setError("Invalid event id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // 1) Try detail endpoint first
    try {
      const data = (await apiFetch(`/organizer/events/${eventId}`, { method: "GET" })) as EventOut;

      setForm({
        id: data.id,
        title: data.title ?? "",
        description: data.description ?? "",
        date: toDateInput(data.date),
        city: data.city ?? "",
        location: data.location ?? "",
      });

      setLoading(false);
      return;
    } catch (e1: any) {
      // If server says 401, the apiFetch shim should already throw with status; show it.
      const msg1 = e1?.message || "";
      const status1 = e1?.status;

      // 2) Fallback: list endpoint + find the event (handles 405/404 on detail)
      try {
        const list = (await apiFetch(`/organizer/events`, { method: "GET" })) as any;
        const items: EventOut[] = Array.isArray(list) ? list : (list?.items || []);
        const found = items.find((x) => x.id === eventId);

        if (!found) {
          setError(
            `Could not find event ${eventId}. Detail endpoint failed (${status1 || "?"}). ${msg1}`.trim(),
          );
          setLoading(false);
          return;
        }

        setForm({
          id: found.id,
          title: found.title ?? "",
          description: found.description ?? "",
          date: toDateInput(found.date),
          city: found.city ?? "",
          location: found.location ?? "",
        });

        setLoading(false);
        return;
      } catch (e2: any) {
        const msg2 = e2?.message || "";
        const status2 = e2?.status;

        setError(
          `Failed to load event. Detail error: ${status1 || "?"} ${msg1}. List error: ${status2 || "?"} ${msg2}`.trim(),
        );
        setLoading(false);
        return;
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;

    setError(null);

    // ✅ CONTRACT-SAFE PATCH ONLY
    const payload = {
      title: form.title,
      description: form.description,
      date: form.date,
      city: form.city,
      location: form.location,
    };

    try {
      await apiFetch(`/organizer/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      nav("/organizer/events", { replace: true });
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      const status = e?.status || "?";
      setError(`Failed to save (${status}). ${msg}`);
    }
  }

  if (loading) {
    return <div className="p-8 text-slate-300">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link to="/organizer/events" className="text-sm text-slate-200 hover:underline">
            ← Back to events
          </Link>

          {eventId && (
            <button
              onClick={() => nav(`/organizer/events/${eventId}/diagram/map-editor`)}
              className="rounded-full border border-slate-400/60 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-950/70"
            >
              Open map editor
            </button>
          )}
        </div>

        <h1 className="text-3xl font-semibold">Edit event</h1>

        {error && (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {error}{" "}
            <button className="ml-2 underline" onClick={load}>
              Retry
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-5 rounded-xl bg-white p-6 text-black">
          <div>
            <label className="block text-sm font-semibold">Title *</label>
            <input
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Location</label>
            <input
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">City</label>
            <input
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              className="mt-2 h-32 w-full rounded border px-3 py-2"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => nav("/organizer/events")}
              className="rounded border px-5 py-2"
            >
              Cancel
            </button>

            <button type="submit" className="rounded bg-indigo-600 px-6 py-2 text-white">
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
