// src/pages/OrganizerCreateEventPage.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganizerEvent,
  type EventCreatePayload,
} from "../api/organizerEvents";

const OrganizerCreateEventPage: React.FC = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState<EventCreatePayload>({
    title: "",
    description: "",
    date: "",
    location: "",
    city: "",
    kind: "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    try {
      const payload: EventCreatePayload = {
        title: form.title.trim(),
        description: form.description?.trim() || undefined,
        date: form.date || undefined, // "YYYY-MM-DD"
        location: form.location?.trim() || undefined,
        city: form.city?.trim() || undefined,
        kind: form.kind?.trim() || undefined,
      };

      const created = await createOrganizerEvent(payload);

      // ✅ After creation, jump straight to the map editor
      navigate(`/organizer/events/${created.id}/diagram/edit`, {
        replace: true,
      });
    } catch (err) {
      console.error("[OrganizerCreateEventPage] create failed", err);
      setError("Could not create event. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Create a new event
          </h1>
          <p className="text-sm text-slate-600">
            Set up the basics now. After creating the event, you&apos;ll go
            straight to the map editor to lay out your booths.
          </p>
        </div>

        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => navigate("/organizer/events")}
        >
          Back to events
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-lg border bg-white p-5 shadow-sm"
      >
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Title<span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              placeholder="Test Festival"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              City
            </label>
            <input
              type="text"
              name="city"
              value={form.city}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              placeholder="Atlanta"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Location / venue
            </label>
            <input
              type="text"
              name="location"
              value={form.location}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              placeholder="Downtown Park"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Kind
            </label>
            <input
              type="text"
              name="kind"
              value={form.kind}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
              placeholder="Festival, market, trade show…"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={4}
            className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
            placeholder="Short description of your event…"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-xs text-slate-500">
            After you create this event, you&apos;ll immediately lay out booths
            on the map.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => navigate("/organizer/events")}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Creating…" : "Create event"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default OrganizerCreateEventPage;
