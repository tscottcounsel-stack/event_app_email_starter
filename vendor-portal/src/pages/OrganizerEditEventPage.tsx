// src/pages/OrganizerEditEventPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api";

type OrganizerEvent = {
  id: number;
  title?: string;
  description?: string;
  date?: string; // could be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS-05" or ISO
  city?: string;
  location?: string;
};

function toDateInputValue(dateStr?: string) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 10);
}

/**
 * If backend stored a datetime (with time/tz), keep the time/tz portion
 * and replace only the date part with the user's chosen YYYY-MM-DD.
 */
function coerceDateForApi(dateYYYYMMDD: string, existing?: string) {
  if (!dateYYYYMMDD) return dateYYYYMMDD;

  const ex = String(existing || "");
  // If existing looks like it has time info, keep the tail
  // Examples:
  //  - "2026-12-05 09:00:00-05"
  //  - "2026-12-05T09:00:00-05:00"
  if (ex.length >= 10 && (ex.includes("T") || ex.includes(":") || ex.includes(" "))) {
    const tail = ex.slice(10); // keep " ...time/tz"
    return `${dateYYYYMMDD}${tail}`;
  }

  // Otherwise just send YYYY-MM-DD
  return dateYYYYMMDD;
}

export default function OrganizerEditEventPage() {
  const nav = useNavigate();
  const { eventId: eventIdParam } = useParams();
  const eventId = Number(eventIdParam || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [event, setEvent] = useState<OrganizerEvent | null>(null);

  // form state (safe fields)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");

  // UI-only “future” fields (don’t submit yet)
  const [ticketUrl, setTicketUrl] = useState("");
  const [expectedAttendees, setExpectedAttendees] = useState("");
  const [setupTime, setSetupTime] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [stateValue, setStateValue] = useState("GA");
  const [zip, setZip] = useState("");

  async function load() {
    if (!eventId) {
      setErr("Invalid event id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      // Keep using the list endpoint (you already rely on it elsewhere)
      const data = await apiGet("/organizer/events");
      const items: OrganizerEvent[] = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : Array.isArray(data?.events)
        ? data.events
        : [];

      const found = items.find((e) => Number(e.id) === eventId) || null;
      setEvent(found);

      if (!found) {
        setErr("Event not found.");
        return;
      }

      setTitle(found.title || "");
      setDescription(found.description || "");
      setDate(toDateInputValue(found.date));
      setLocation(found.location || "");
      setCity(found.city || "");
    } catch (e: any) {
      setErr(e?.message || "Failed to load event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const canSave = useMemo(() => {
    return !!title.trim() && !!date.trim();
  }, [title, date]);

  async function onSave() {
    if (!eventId) return;

    setSaving(true);
    setErr(null);

    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        date: coerceDateForApi(date.trim(), event?.date),
        location: location.trim() || null,
        city: city.trim() || null,
      };

      await apiPatch(`/organizer/events/${eventId}`, payload);

      // Reload to ensure UI reflects server state
      await load();

      // Go back to detail
      nav(`/organizer/events/${eventId}`, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      {/* Top bar */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <button
          onClick={() => nav(`/organizer/events/${eventId}`)}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          ← Back
        </button>

        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold text-slate-900">Edit Event</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">Loading…</div>
      ) : err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{err}</div>
      ) : (
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="rounded-2xl border bg-white p-6">
            <div className="text-lg font-semibold text-slate-900">Edit Event Details</div>
            <div className="mt-1 text-sm text-slate-600">Update your event information below.</div>

            <div className="mt-6 rounded-2xl border bg-slate-50 p-6">
              <div className="text-base font-semibold text-slate-900">Basic Information</div>

              <div className="mt-4">
                <label className="text-sm font-medium text-slate-700">
                  Event Name <span className="text-red-600">*</span>
                </label>
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event name"
                />
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-slate-700">Event Description</label>
                <textarea
                  className="mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your event for vendors and attendees…"
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700">
                    Start Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    className="mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <div className="mt-1 text-xs text-slate-500">
                    We keep your existing time/tz if the backend stored a datetime.
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">City</label>
                  <input
                    className="mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Atlanta"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-slate-700">Venue / Location</label>
                <input
                  className="mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Convention Center / Park / Venue name"
                />
              </div>
            </div>
          </div>

          {/* Event Location (UI-only for now) */}
          <div className="rounded-2xl border bg-white p-6">
            <div className="text-base font-semibold text-slate-900">Event Location</div>
            <div className="mt-1 text-sm text-slate-600">(UI ready) Wire these to backend fields later.</div>

            <div className="mt-4 grid gap-4">
              <input
                className="w-full rounded-xl border px-4 py-3 text-sm"
                value={streetAddress}
                onChange={(e) => setStreetAddress(e.target.value)}
                placeholder="Street Address"
              />
              <div className="grid gap-4 md:grid-cols-3">
                <input
                  className="w-full rounded-xl border px-4 py-3 text-sm"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                />
                <input
                  className="w-full rounded-xl border px-4 py-3 text-sm"
                  value={stateValue}
                  onChange={(e) => setStateValue(e.target.value)}
                  placeholder="State"
                />
                <input
                  className="w-full rounded-xl border px-4 py-3 text-sm"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="ZIP Code"
                />
              </div>
            </div>
          </div>

          {/* Vendor-facing extras (UI-only for now) */}
          <div className="rounded-2xl border bg-white p-6">
            <div className="text-base font-semibold text-slate-900">Event Details</div>
            <div className="mt-1 text-sm text-slate-600">
              These help vendors decide to apply (attendance, setup time, ticket link).
            </div>

            <div className="mt-4 grid gap-4">
              <input
                className="w-full rounded-xl border px-4 py-3 text-sm"
                value={expectedAttendees}
                onChange={(e) => setExpectedAttendees(e.target.value)}
                placeholder="Expected Attendees (e.g. 500)"
              />
              <input
                className="w-full rounded-xl border px-4 py-3 text-sm"
                value={setupTime}
                onChange={(e) => setSetupTime(e.target.value)}
                placeholder="Setup Time (e.g. 6am)"
              />
              <input
                className="w-full rounded-xl border px-4 py-3 text-sm"
                value={ticketUrl}
                onChange={(e) => setTicketUrl(e.target.value)}
                placeholder="Ticket Sales Link (URL)"
              />
              <textarea
                className="w-full rounded-xl border px-4 py-3 text-sm"
                rows={4}
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="Additional notes for vendors (parking, load-in, special requirements.)"
              />
            </div>

            <div className="mt-3 text-xs text-slate-500">
              Not submitted to backend yet (to avoid validation errors).
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pb-8">
            <button
              onClick={() => nav(`/organizer/events/${eventId}`)}
              className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Cancel
            </button>

            <button
              disabled={!canSave || saving}
              onClick={onSave}
              className={`rounded-full px-6 py-3 text-sm font-medium text-white ${
                !canSave || saving ? "bg-slate-300" : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
