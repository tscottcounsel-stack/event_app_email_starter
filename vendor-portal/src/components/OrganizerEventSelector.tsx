// src/components/OrganizerEventSelector.tsx
import React, { useEffect, useState } from "react";
import {
  listOrganizerEvents,
  type OrganizerEventSummary,
} from "../api/organizerEvents";
import {
  getStoredEventId,
  setStoredEventId,
} from "../api/organizerApplications";

type OrganizerEventSelectorProps = {
  value: number | null;
  onChange: (id: number) => void;
};

const OrganizerEventSelector: React.FC<OrganizerEventSelectorProps> = ({
  value,
  onChange,
}) => {
  const [events, setEvents] = useState<OrganizerEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listOrganizerEvents()
      .then((data) => {
        if (cancelled) return;
        setEvents(data ?? []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load events");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize selected event when events load
  useEffect(() => {
    if (!events.length) return;

    // If caller already has a valid value, leave it alone
    if (value && events.some((e) => e.id === value)) return;

    const stored = getStoredEventId();
    const initial =
      (stored && events.some((e) => e.id === stored) && stored) ||
      events[0].id;

    setStoredEventId(initial);
    onChange(initial);
  }, [events, value, onChange]);

  if (loading && !events.length) {
    return <div className="text-xs text-gray-500">Loading events…</div>;
  }

  if (error && !events.length) {
    return (
      <div className="text-xs text-red-600">Failed to load events</div>
    );
  }

  if (!events.length) {
    return <div className="text-xs text-gray-500">No events found</div>;
  }

  const selected = value ?? getStoredEventId() ?? events[0].id;

  return (
    <div className="flex flex-col text-xs text-gray-700">
      <span className="mb-1 font-medium">Event</span>
      <select
        className="min-w-[220px] rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        value={selected}
        onChange={(e) => {
          const id = parseInt(e.target.value, 10);
          if (!Number.isFinite(id)) return;
          setStoredEventId(id);
          onChange(id);
        }}
      >
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.title}{" "}
            {ev.date ? `— ${new Date(ev.date).toLocaleDateString()}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
};

export default OrganizerEventSelector;
export { OrganizerEventSelector };
