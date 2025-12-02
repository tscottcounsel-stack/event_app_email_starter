// src/pages/OrganizerEventEditPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getOrganizerEvent,
  updateOrganizerEvent,
  type OrganizerEvent,
} from "../api/organizerEvents";

const OrganizerEventEditPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<OrganizerEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(""); // local "YYYY-MM-DD"
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const evt = await getOrganizerEvent(Number(eventId));
        if (cancelled) return;

        setEvent(evt);
        setTitle(evt.title ?? "");
        setDescription(evt.description ?? "");
        setLocation(evt.location ?? "");
        setCity(evt.city ?? "");
        setKind(evt.kind ?? "");

        if (evt.date) {
          const d = new Date(evt.date);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          setDate(`${yyyy}-${mm}-${dd}`);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("Failed to load event", err);
          setError("Could not load event.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;

    try {
      setSaving(true);
      setError(null);

      // Only send fields we actually care to update
      const payload: any = {
        title,
        description: description || null,
        location: location || null,
        city: city || null,
        kind: kind || null,
      };

      if (date) {
        // Let backend store timezone; we just send an ISO date string
        payload.date = date;
      }

      await updateOrganizerEvent(Number(eventId), payload);

      // Navigate back to events list (or dashboard if you prefer)
      navigate("/organizer/events");
    } catch (err: any) {
      console.error("Failed to update event", err);
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    navigate("/organizer/events");
  }

  if (loading || !event) {
    return (
      <div className="p-4">
        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <p className="text-gray-600">Loading event…</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">Edit event</h1>

      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Title
          </label>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Date
            </label>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              City
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Location (venue)
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Kind (festival, expo, etc.)
            </label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end space-x-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default OrganizerEventEditPage;
