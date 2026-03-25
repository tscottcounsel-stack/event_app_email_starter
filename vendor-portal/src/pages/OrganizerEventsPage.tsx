// src/pages/OrganizerEventsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type EventRow = {
  id: number;
  title?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  start_date?: string;
  published?: boolean;
};

type EarningsEvent = {
  event_id: number;
  gross_sales: number;
  platform_fees: number;
  net_earnings: number;
  payouts_paid: number;
  payouts_owed: number;
  payout_status_counts?: {
    paid?: number;
    unpaid?: number;
  };
};

type EarningsResponse = {
  summary?: {
    payouts_paid?: number;
    payouts_owed?: number;
  };
  events?: EarningsEvent[];
};

function formatEventDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(n: number) {
  return `$${(n || 0).toLocaleString()}`;
}

function payoutBadge(earnings?: EarningsEvent) {
  if (!earnings) {
    return {
      label: "No earnings yet",
      classes: "bg-slate-50 text-slate-500 border-slate-200",
    };
  }

  const paid = Number(earnings.payouts_paid || 0);
  const owed = Number(earnings.payouts_owed || 0);

  if (owed > 0 && paid > 0) {
    return {
      label: `⏳ ${formatCurrency(owed)} pending payout`,
      classes: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }

  if (owed > 0) {
    return {
      label: `⏳ ${formatCurrency(owed)} pending payout`,
      classes: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }

  if (paid > 0) {
    return {
      label: `✅ ${formatCurrency(paid)} paid out`,
      classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }

  return {
    label: "No earnings yet",
    classes: "bg-slate-50 text-slate-500 border-slate-200",
  };
}

export default function OrganizerEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [earningsMap, setEarningsMap] = useState<Record<number, EarningsEvent>>(
    {}
  );
  const [summary, setSummary] = useState({
    payouts_paid: 0,
    payouts_owed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {

const headers = buildAuthHeaders();

const [eventsRes, earningsRes] = await Promise.all([
  fetch(`${API_BASE}/organizer/events`, { headers }),
  fetch(`${API_BASE}/organizer/earnings`, { headers })
]);

if (!eventsRes.ok) {
  const text = await eventsRes.text().catch(() => "");
  throw new Error(text || `Failed to load events (${eventsRes.status})`);
}

if (!earningsRes.ok) {
  const text = await earningsRes.text().catch(() => "");
  throw new Error(text || `Failed to load earnings (${earningsRes.status})`);
}

const eventsData = await eventsRes.json();
const earningsData = await earningsRes.json();

const eventsList = Array.isArray(eventsData?.events)
  ? eventsData.events
  : [];

const earningsList = Array.isArray(earningsData?.events)
  ? earningsData.events
  : [];

const nextMap: Record<number, EarningsEvent> = {};
earningsList.forEach((row) => {
  const id = Number(row?.event_id || 0);
  nextMap[id] = {
    event_id: id,
    gross_sales: Number(row?.gross_sales || 0),
    platform_fees: Number(row?.platform_fees || 0),
    net_earnings: Number(row?.net_earnings || 0),
    payouts_paid: Number(row?.payouts_paid || 0),
    payouts_owed: Number(row?.payouts_owed || 0),
    payout_status_counts: {
      paid: Number(row?.payout_status_counts?.paid || 0),
      unpaid: Number(row?.payout_status_counts?.unpaid || 0),
    },
  };
});
      setEvents(eventsList);
      setEarningsMap(nextMap);
      setSummary({
        payouts_paid: Number(earningsData?.summary?.payouts_paid || 0),
        payouts_owed: Number(earningsData?.summary?.payouts_owed || 0),
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aNet = Number(earningsMap[a.id]?.net_earnings || 0);
      const bNet = Number(earningsMap[b.id]?.net_earnings || 0);
      if (bNet !== aNet) return bNet - aNet;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }, [events, earningsMap]);

  const topEventId = useMemo(() => {
    if (!sortedEvents.length) return null;
    const top = sortedEvents[0];
    const topNet = Number(earningsMap[top.id]?.net_earnings || 0);
    return topNet > 0 ? top.id : null;
  }, [sortedEvents, earningsMap]);

  function openDetails(id: number) {
    navigate(`/organizer/events/${id}/details`);
  }

  function openRequirements(id: number) {
    navigate(`/organizer/events/${id}/requirements`);
  }

  function openLayout(id: number) {
    navigate(`/organizer/events/${id}/layout`);
  }

  function openApplications(id: number) {
    navigate(`/organizer/events/${id}/applications`);
  }

  function openMessages(id: number) {
    navigate(`/organizer/events/${id}/messages`);
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading events…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create and manage events and their details.
          </p>
        </div>

        <button
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
          onClick={() => navigate("/organizer/events/create")}
        >
          + Create Event
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-6 text-sm font-medium">
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-700">
          ✅ Paid Out: {formatCurrency(summary.payouts_paid)}
        </div>
        <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-amber-700">
          ⏳ Pending: {formatCurrency(summary.payouts_owed)}
        </div>
      </div>

      {sortedEvents.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-gray-600">
          No events yet. Create your first event to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedEvents.map((ev) => {
            const earnings = earningsMap[ev.id];
            const badge = payoutBadge(earnings);
            const isTopEarner = topEventId === ev.id;

            return (
              <div
                key={ev.id}
                className={[
                  "rounded-xl border bg-white p-5 shadow-sm transition",
                  isTopEarner
                    ? "border-amber-300 ring-2 ring-amber-100 shadow-md"
                    : "",
                ].join(" ")}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold">
                        {ev.title || "Untitled Event"}
                      </div>

                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                          ev.published
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700",
                        ].join(" ")}
                      >
                        {ev.published ? "Published" : "Draft"}
                      </span>

                      {isTopEarner ? (
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          🔥 Top Earner
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 text-sm text-gray-500">
                      {ev.venue_name || "No venue"}
                      {ev.city && ev.state ? ` • ${ev.city}, ${ev.state}` : ""}
                    </div>

                    {ev.start_date ? (
                      <div className="mt-1 text-xs text-gray-400">
                        {formatEventDate(ev.start_date)}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-6 text-sm font-medium">
                      <div className="text-green-600">
                        💰 {formatCurrency(earnings?.gross_sales || 0)}
                      </div>
                      <div className="text-gray-500">
                        🏦 {formatCurrency(earnings?.platform_fees || 0)}
                      </div>
                      <div className="text-blue-600">
                        📈 {formatCurrency(earnings?.net_earnings || 0)}
                      </div>
                    </div>

                    <div className="mt-3">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
                      onClick={() => openDetails(ev.id)}
                    >
                      Open
                    </button>

                    <button
                      className="rounded-lg border px-4 py-2 text-sm"
                      onClick={() => openRequirements(ev.id)}
                    >
                      Requirements
                    </button>

                    <button
                      className="rounded-lg border px-4 py-2 text-sm"
                      onClick={() => openLayout(ev.id)}
                    >
                      Layout
                    </button>

                    <button
                      className="rounded-lg border px-4 py-2 text-sm"
                      onClick={() => openApplications(ev.id)}
                    >
                      Applications
                    </button>

                    <button
                      className="rounded-lg border px-4 py-2 text-sm"
                      onClick={() => openMessages(ev.id)}
                    >
                      Messages
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}





