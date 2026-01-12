// src/pages/OrganizerDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  listOrganizerEvents,
  type OrganizerEvent,
  getOrganizerEventDashboardStats,
  type OrganizerEventDashboardStats,
} from "../api/organizerEvents";

import {
  getStoredEventId,
  setStoredEventId,
} from "../api/organizerApplications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function parseEventDate(ev: OrganizerEvent): Date | null {
  const raw: any = (ev as any).date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatEventDate(ev: OrganizerEvent): string {
  const d = parseEventDate(ev);
  if (!d) return "Date TBA";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getEventLocation(ev: OrganizerEvent): string {
  const anyEv = ev as any;
  if (anyEv.city && anyEv.location) {
    return `${anyEv.city} — ${anyEv.location}`;
  }
  if (anyEv.city) return String(anyEv.city);
  if (anyEv.location) return String(anyEv.location);
  return "Location TBA";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const OrganizerDashboard: React.FC = () => {
  const navigate = useNavigate();

  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [eventStats, setEventStats] = useState<
    Record<number, OrganizerEventDashboardStats>
  >({});
  const [statsLoading, setStatsLoading] = useState(false);

  // We still track a "focused" event id for when you click actions on a card
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null);

  // -------------------------------------------------------------------------
  // Load events
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        setEventsLoading(true);
        setEventsError(null);

        const list = await listOrganizerEvents();
        if (cancelled) return;

        setEvents(list);

        if (!list.length) {
          setFocusedEventId(null);
          return;
        }

        // Try to use a previously focused event if it still exists
        const storedId = getStoredEventId();
        let initialId: number | null = null;

        if (
          storedId != null &&
          list.some((ev) => ev.id === Number(storedId))
        ) {
          initialId = Number(storedId);
        } else {
          // Prefer the next upcoming event if possible
          const now = new Date();
          const upcomingSorted = [...list]
            .map((ev) => ({ ev, d: parseEventDate(ev) }))
            .filter((x) => x.d && x.d >= now)
            .sort((a, b) => a.d!.getTime() - b.d!.getTime());
          if (upcomingSorted.length > 0) {
            initialId = upcomingSorted[0].ev.id;
          } else {
            initialId = list[0].id;
          }
        }

        setFocusedEventId(initialId);
        if (initialId != null) setStoredEventId(initialId);
      } catch (err) {
        console.error("Failed to load organizer events", err);
        if (!cancelled) {
          setEvents([]);
          setEventsError("Could not load events.");
          setFocusedEventId(null);
        }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Load stats for all events whenever the events list changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!events.length) {
      setEventStats({});
      return;
    }

    let cancelled = false;

    async function loadAllStats() {
      try {
        setStatsLoading(true);

        const results = await Promise.all(
          events.map(async (ev) => {
            try {
              const stats = await getOrganizerEventDashboardStats(ev.id);
              return { id: ev.id, stats };
            } catch (err) {
              console.error(
                `Failed to load stats for event ${ev.id}`,
                err
              );
              return {
                id: ev.id,
                stats: null as OrganizerEventDashboardStats | null,
              };
            }
          })
        );

        if (cancelled) return;

        const map: Record<number, OrganizerEventDashboardStats> = {};
        for (const { id, stats } of results) {
          if (stats) map[id] = stats;
        }
        setEventStats(map);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    void loadAllStats();

    return () => {
      cancelled = true;
    };
  }, [events]);

  // -------------------------------------------------------------------------
  // Derived values (global aggregates + upcoming events)
  // -------------------------------------------------------------------------

  const hasEvents = events.length > 0;
  const globalLoading = eventsLoading || statsLoading;

  const aggregates = useMemo(() => {
    const initial = {
      totalEvents: events.length,
      totalApplications: 0,
      totalPending: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalDueCents: 0,
      totalPaidCents: 0,
      totalOutstandingCents: 0,
    };

    return events.reduce((acc, ev) => {
      const stats = eventStats[ev.id];
      if (!stats) return acc;

      const totalApps = stats.total_applications ?? 0;
      const pending = stats.pending ?? 0;
      const approved = stats.approved ?? 0;
      const rejected = stats.rejected ?? 0;
      const due = stats.total_due_cents ?? 0;
      const paid = stats.total_paid_cents ?? 0;
      const outstanding = stats.outstanding_cents ?? due - paid ?? 0;

      acc.totalApplications += totalApps;
      acc.totalPending += pending;
      acc.totalApproved += approved;
      acc.totalRejected += rejected;
      acc.totalDueCents += due;
      acc.totalPaidCents += paid;
      acc.totalOutstandingCents += outstanding;

      return acc;
    }, initial);
  }, [events, eventStats]);

  const now = new Date();
  const upcomingEvents = useMemo(() => {
    return [...events]
      .map((ev) => ({ ev, d: parseEventDate(ev) }))
      .filter((x) => x.d && x.d >= now)
      .sort((a, b) => a.d!.getTime() - b.d!.getTime())
      .slice(0, 3)
      .map((x) => x.ev);
  }, [events, now]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleManageEvents = () => {
    navigate("/organizer/events");
  };

  const handleCreateEvent = () => {
    navigate("/organizer/events/new");
  };

  const handleViewApplications = (eventId: number) => {
    setFocusedEventId(eventId);
    setStoredEventId(eventId);
    navigate(`/organizer/applications?event_id=${eventId}`);
  };

  const handleViewEventDashboard = (eventId: number) => {
    setFocusedEventId(eventId);
    setStoredEventId(eventId);
    navigate(`/organizer/events/${eventId}/dashboard`);
  };

  const handleEditMap = (eventId: number) => {
    setFocusedEventId(eventId);
    setStoredEventId(eventId);
    navigate(`/organizer/events/${eventId}/diagram/edit`);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Organizer dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            Overview of your events, vendor applications, and payments
            across your entire account.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="border px-3 py-1 rounded-lg bg-white hover:bg-slate-50 text-sm text-slate-700"
            onClick={handleManageEvents}
          >
            Manage events
          </button>
          <button
            type="button"
            className="border px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-sm text-white"
            onClick={handleCreateEvent}
          >
            Create event
          </button>
        </div>
      </header>

      {/* Global stats row */}
      <section className="rounded-2xl border bg-white p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Account overview
          </h2>
          {globalLoading && (
            <span className="text-[11px] text-slate-400">
              Updating…
            </span>
          )}
        </div>

        {eventsError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-2">
            {eventsError}
          </div>
        )}

        {hasEvents ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500">
                EVENTS
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {globalLoading ? "…" : aggregates.totalEvents}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {upcomingEvents.length} upcoming
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500">
                APPLICATIONS
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {globalLoading ? "…" : aggregates.totalApplications}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {globalLoading
                  ? "—"
                  : `${aggregates.totalPending} pending • ${aggregates.totalApproved} approved`}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500">
                REVENUE RECEIVED
              </div>
              <div className="mt-1 text-2xl font-semibold text-emerald-600">
                {globalLoading
                  ? "…"
                  : formatMoney(aggregates.totalPaidCents)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Across all events
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500">
                OUTSTANDING BALANCE
              </div>
              <div className="mt-1 text-2xl font-semibold text-amber-600">
                {globalLoading
                  ? "…"
                  : formatMoney(aggregates.totalOutstandingCents)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Awaiting payment from vendors
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            You haven&apos;t created any events yet. Use{" "}
            <button
              type="button"
              onClick={handleManageEvents}
              className="underline underline-offset-2 text-emerald-600 hover:text-emerald-700"
            >
              Manage events
            </button>{" "}
            to create your first event.
          </div>
        )}
      </section>

      {/* Upcoming events + events grid */}
      {hasEvents && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          {/* Upcoming events */}
          <div className="rounded-2xl border bg-white p-4 sm:p-5 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Upcoming events
              </h2>
              {upcomingEvents.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  Next {upcomingEvents.length} event
                  {upcomingEvents.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-slate-500">
                No upcoming events on the calendar yet.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map((ev) => {
                  const stats = eventStats[ev.id];
                  const pending = stats?.pending ?? 0;
                  const approved = stats?.approved ?? 0;
                  const paid = stats?.total_paid_cents ?? 0;

                  const date = parseEventDate(ev);
                  let daysAway: string | null = null;
                  if (date) {
                    const diffMs = date.getTime() - now.getTime();
                    const diffDays = Math.round(
                      diffMs / (1000 * 60 * 60 * 24)
                    );
                    if (diffDays >= 0) {
                      daysAway =
                        diffDays === 0
                          ? "Today"
                          : diffDays === 1
                          ? "In 1 day"
                          : `In ${diffDays} days`;
                    }
                  }

                  const isFocused = focusedEventId === ev.id;

                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        setFocusedEventId(ev.id);
                        setStoredEventId(ev.id);
                      }}
                      className={[
                        "w-full text-left rounded-xl border px-3 py-3 text-xs transition-colors",
                        isFocused
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/60",
                      ].join(" ")}
                    >
                      <div className="flex justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {ev.title || `Event #${ev.id}`}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {formatEventDate(ev)} • {getEventLocation(ev)}
                          </div>
                          {daysAway && (
                            <div className="mt-0.5 text-[11px] text-emerald-700">
                              {daysAway}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-[11px] text-slate-600">
                          <div>
                            Pending:{" "}
                            <span className="font-semibold">
                              {pending}
                            </span>
                          </div>
                          <div>
                            Approved:{" "}
                            <span className="font-semibold">
                              {approved}
                            </span>
                          </div>
                          <div className="mt-1">
                            Paid:{" "}
                            <span className="font-semibold text-emerald-600">
                              {formatMoney(paid)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Events grid */}
          <div className="rounded-2xl border bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Events overview
              </h2>
              <span className="text-[11px] text-slate-500">
                {events.length} event{events.length !== 1 ? "s" : ""} total
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {events.map((ev) => {
                const stats = eventStats[ev.id];
                const totalApps = stats?.total_applications ?? 0;
                const pending = stats?.pending ?? 0;
                const approved = stats?.approved ?? 0;
                const rejected = stats?.rejected ?? 0;
                const due = stats?.total_due_cents ?? 0;
                const paid = stats?.total_paid_cents ?? 0;
                const outstanding =
                  stats?.outstanding_cents ?? due - paid ?? 0;

                const isFocused = focusedEventId === ev.id;

                return (
                  <div
                    key={ev.id}
                    className={[
                      "flex flex-col rounded-xl border px-4 py-3 text-xs bg-slate-50/60",
                      isFocused
                        ? "border-emerald-500 shadow-sm"
                        : "border-slate-200",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {ev.title || `Event #${ev.id}`}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {formatEventDate(ev)} • {getEventLocation(ev)}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        ID: {ev.id}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Applications
                        </div>
                        <div className="mt-0.5 text-sm font-semibold">
                          {totalApps}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Pending
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-amber-600">
                          {pending}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Approved
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-emerald-600">
                          {approved}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Due
                        </div>
                        <div className="mt-0.5 text-sm font-semibold">
                          {formatMoney(due)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Paid
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-emerald-600">
                          {formatMoney(paid)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                        <div className="text-[10px] text-slate-500">
                          Outstanding
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-amber-600">
                          {formatMoney(outstanding)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        className="border rounded-lg px-2.5 py-1 text-[11px] bg-white hover:bg-slate-50"
                        onClick={() => handleViewEventDashboard(ev.id)}
                      >
                        Dashboard
                      </button>
                      <button
                        type="button"
                        className="border rounded-lg px-2.5 py-1 text-[11px] bg-white hover:bg-slate-50"
                        onClick={() => handleEditMap(ev.id)}
                      >
                        Diagram
                      </button>
                      <button
                        type="button"
                        className="border rounded-lg px-2.5 py-1 text-[11px] bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => handleViewApplications(ev.id)}
                      >
                        Applications
                      </button>
                    </div>

                    {rejected > 0 && (
                      <div className="mt-2 text-[10px] text-slate-500">
                        Rejected applications:{" "}
                        <span className="font-semibold text-red-600">
                          {rejected}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default OrganizerDashboard;
