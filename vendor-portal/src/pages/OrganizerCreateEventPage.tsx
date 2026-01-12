import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

type CreatePayload = {
  title: string;
  description?: string | null;
  date: string;
  location?: string | null;
  city?: string | null;

  // contract-safe defaults
  kind?: string | null;
  business_only?: boolean;
  badge_required?: boolean;

  // keep present but default to 0; capacity UI comes later under your contract
  max_vendor_slots?: number;
};

export default function OrganizerCreateEventPage() {
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (!date) {
      setErr("Date is required.");
      return;
    }

    const payload: CreatePayload = {
      title: title.trim(),
      date,
      location: location.trim() || null,
      city: city.trim() || null,
      description: description.trim() || null,

      // keep stable defaults
      kind: "general",
      business_only: false,
      badge_required: false,
      max_vendor_slots: 0,
    };

    setSaving(true);
    try {
      const created = await apiFetch("/organizer/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const id = (created as any)?.id;
      if (!id) {
        setErr("Event created, but response did not include an id.");
        setSaving(false);
        return;
      }

      // Go straight into the workflow that matters
      nav(`/organizer/events/${id}/diagram/map-editor`, { replace: true });
    } catch (e2: any) {
      const msg = e2?.message || "Unknown error";
      const status = e2?.status || "?";
      setErr(`Failed to create event (${status}). ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/organizer/events" className="text-sm text-slate-200 hover:underline">
          ← Back to events
        </Link>

        <h1 className="mt-6 text-3xl font-semibold">Create a new event</h1>
        <p className="mt-2 text-slate-300">
          Start with the basics. After you create the event, you’ll be taken to the Map Editor.
        </p>

        {err && (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-5 rounded-xl bg-white p-6 text-black">
          <div>
            <label className="block text-sm font-semibold">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
              placeholder="e.g., Spring Festival"
              required
              disabled={saving}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
              required
              disabled={saving}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
              placeholder="e.g., Piedmont Park"
              disabled={saving}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-2 w-full rounded border px-3 py-2"
              placeholder="e.g., Atlanta"
              disabled={saving}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 h-32 w-full rounded border px-3 py-2"
              placeholder="Optional details…"
              disabled={saving}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Link to="/organizer/events" className="rounded border px-5 py-2">
              Cancel
            </Link>

            <button
              type="submit"
              className="rounded bg-indigo-600 px-6 py-2 text-white disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Creating…" : "Create event"}
            </button>
          </div>

          <div className="pt-2 text-xs text-slate-500">
            Note: Capacity planning and category-by-category vendor counts come next (per your capacity contract).
          </div>
        </form>
      </div>
    </div>
  );
}
