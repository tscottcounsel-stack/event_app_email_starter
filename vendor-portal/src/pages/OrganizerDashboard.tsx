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
  published?: boolean;
};

type ActivityRow = {
  title?: string;
  message?: string;
  type?: string;
  event_name?: string;
  time?: string;
};

type EarningsSummary = {
  gross_sales: number;
  platform_fees: number;
  net_earnings: number;
  payouts_paid: number;
  payouts_owed: number;
};

type PayoutStatusCounts = {
  unpaid?: number;
  scheduled?: number;
  paid?: number;
};

type EarningsEventRow = {
  event_id: number;
  event_title?: string;
  gross_sales: number;
  platform_fees: number;
  net_earnings: number;
  payouts_paid: number;
  payouts_owed: number;
  payout_status_counts?: PayoutStatusCounts;
};

type OrganizerEarningsResponse = {
  summary?: Partial<EarningsSummary>;
  events?: EarningsEventRow[];
};

const EMPTY_EARNINGS_SUMMARY: EarningsSummary = {
  gross_sales: 0,
  platform_fees: 0,
  net_earnings: 0,
  payouts_paid: 0,
  payouts_owed: 0,
};

function formatMoney(value?: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function GoldVerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-2 border-amber-300 bg-gradient-to-br from-yellow-100 via-amber-50 to-yellow-200 px-3 py-1.5 text-xs font-black text-amber-900 shadow-[0_2px_10px_rgba(245,158,11,0.18)]">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">
        ✓
      </span>
      Verified Organizer
    </span>
  );
}

function StatCard(props: {
  label: string;
  value: number | string;
  helper?: string;
  icon?: string;
}) {
  const { label, value, helper, icon } = props;

  return (
    <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {label}
        </div>
        {icon ? <div className="text-lg opacity-80">{icon}</div> : null}
      </div>

      <div className="mt-3 whitespace-nowrap text-xl font-extrabold leading-tight tracking-tight text-slate-900 xl:text-2xl">
        {value}
      </div>

      {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
    </div>
  );
}

function activityBadgeClasses(type?: string) {
  const t = String(type || "").toLowerCase();

  if (t === "payment" || t === "paid") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (t === "approved") {
    return "bg-indigo-100 text-indigo-700";
  }
  if (t === "application" || t === "new") {
    return "bg-amber-100 text-amber-700";
  }
  if (t === "reserved") {
    return "bg-sky-100 text-sky-700";
  }

  return "bg-slate-100 text-slate-700";
}

function payoutBadgeClasses(event?: EarningsEventRow | null) {
  const counts = event?.payout_status_counts || {};
  const unpaid = Number(counts.unpaid ?? 0);
  const scheduled = Number(counts.scheduled ?? 0);
  const paid = Number(counts.paid ?? 0);

  if (unpaid > 0) return "bg-amber-100 text-amber-700";
  if (scheduled > 0) return "bg-sky-100 text-sky-700";
  if (paid > 0) return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function payoutBadgeLabel(event?: EarningsEventRow | null) {
  const counts = event?.payout_status_counts || {};
  const unpaid = Number(counts.unpaid ?? 0);
  const scheduled = Number(counts.scheduled ?? 0);
  const paid = Number(counts.paid ?? 0);

  if (unpaid > 0) return "Payout Owed";
  if (scheduled > 0) return "Payout Scheduled";
  if (paid > 0) return "Paid Out";
  return "No Payouts Yet";
}

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [freshActivityKeys, setFreshActivityKeys] = useState<string[]>([]);
  const [earningsSummary, setEarningsSummary] =
    useState<EarningsSummary>(EMPTY_EARNINGS_SUMMARY);
  const [earningsEvents, setEarningsEvents] = useState<EarningsEventRow[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [verificationStatus, setVerificationStatus] =
    useState<"verified" | "pending" | "rejected" | "unverified">("unverified");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      try {
        setEarningsLoading(true);

        const [eventsRes, earningsRes] = await Promise.all([
          fetch(`${API_BASE}/organizer/events`, {
            headers: buildAuthHeaders(),
          }),
          fetch(`${API_BASE}/organizer/earnings`, {
            headers: buildAuthHeaders(),
          }),
        ]);

        const [eventsData, earningsData]: [any, OrganizerEarningsResponse | null] =
          await Promise.all([
            eventsRes.json().catch(() => null),
            earningsRes.json().catch(() => null),
          ]);

        if (cancelled) return;

        setEvents(Array.isArray(eventsData?.events) ? eventsData.events : []);

        const safeSummary: EarningsSummary = {
          gross_sales: Number(earningsData?.summary?.gross_sales ?? 0),
          platform_fees: Number(earningsData?.summary?.platform_fees ?? 0),
          net_earnings: Number(earningsData?.summary?.net_earnings ?? 0),
          payouts_paid: Number(earningsData?.summary?.payouts_paid ?? 0),
          payouts_owed: Number(earningsData?.summary?.payouts_owed ?? 0),
        };

        const safeEvents = Array.isArray(earningsData?.events)
          ? earningsData!.events.map((row) => ({
              event_id: Number(row.event_id ?? 0),
              event_title: row.event_title || "Untitled Event",
              gross_sales: Number(row.gross_sales ?? 0),
              platform_fees: Number(row.platform_fees ?? 0),
              net_earnings: Number(row.net_earnings ?? 0),
              payouts_paid: Number(row.payouts_paid ?? 0),
              payouts_owed: Number(row.payouts_owed ?? 0),
              payout_status_counts: {
                unpaid: Number(row.payout_status_counts?.unpaid ?? 0),
                scheduled: Number(row.payout_status_counts?.scheduled ?? 0),
                paid: Number(row.payout_status_counts?.paid ?? 0),
              },
            }))
          : [];

        setEarningsSummary(safeSummary);
        setEarningsEvents(safeEvents);
      } catch {
        if (!cancelled) {
          setEvents([]);
          setEarningsSummary(EMPTY_EARNINGS_SUMMARY);
          setEarningsEvents([]);
        }
      } finally {
        if (!cancelled) {
          setEarningsLoading(false);
        }
      }
    }

    loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      try {
        const res = await fetch(`${API_BASE}/organizer/activity`, {
          headers: buildAuthHeaders(),
        });

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        setActivity((prev) => {
          const next = Array.isArray(data?.activity) ? data.activity : [];

          const prevKeys = new Set(
            prev.map((item) => `${item.type}-${item.title}-${item.time}`)
          );

          const newKeys = next
            .map((item: ActivityRow) => `${item.type}-${item.title}-${item.time}`)
            .filter((key: string) => !prevKeys.has(key));

          if (newKeys.length) {
            setFreshActivityKeys(newKeys);

            window.setTimeout(() => {
              setFreshActivityKeys([]);
            }, 2500);
          }

          return next;
        });
      } catch {
        if (!cancelled) setActivity([]);
      }
    }

    loadActivity();
    const timer = window.setInterval(loadActivity, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadVerification() {
      try {
        const res = await fetch(`${API_BASE}/verification/me`, {
          headers: buildAuthHeaders(),
        });

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        const raw =
          data?.verification?.status ||
          data?.verification_status ||
          "";

        const normalized = String(raw || "").toLowerCase();

        if (normalized === "approved" || normalized === "verified") {
          setVerificationStatus("verified");
        } else if (normalized === "pending") {
          setVerificationStatus("pending");
        } else if (normalized === "rejected") {
          setVerificationStatus("rejected");
        } else {
          setVerificationStatus("unverified");
        }
      } catch {
        if (!cancelled) setVerificationStatus("unverified");
      }
    }

    loadVerification();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalEvents = events.length;
  const completeEvents = events.filter((ev) => !!ev.published).length;
  const draftInProgress = Math.max(totalEvents - completeEvents, 0);

  const topEarningEvent = useMemo(() => {
    if (!earningsEvents.length) return null;

    return [...earningsEvents].sort(
      (a, b) => Number(b.net_earnings ?? 0) - Number(a.net_earnings ?? 0)
    )[0];
  }, [earningsEvents]);

  return (
    <div className="space-y-8 p-6">
      <div className="ml-1 rounded-[2rem] bg-gradient-to-r from-slate-950 via-indigo-900 to-violet-700 p-7 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
              Organizer Portal
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black tracking-tight md:text-5xl">
                Organizer Dashboard
              </h1>

              {verificationStatus === "verified" && <GoldVerifiedBadge />}

              {verificationStatus === "pending" && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                  Pending Verification
                </span>
              )}

              {verificationStatus === "rejected" && (
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">
                  Verification Rejected
                </span>
              )}
            </div>

            <p className="mt-3 max-w-3xl text-sm text-white/80 md:text-base">
              Manage events, review vendor applications, and track marketplace
              activity.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>

            <button
              className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              onClick={() => navigate("/")}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {topEarningEvent ? (
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-indigo-50 p-6 shadow-sm transition hover:shadow-md">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Top Earning Event
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 md:text-3xl">
                {topEarningEvent.event_title || "Untitled Event"}
              </h2>
              <p className="mt-2 text-sm text-slate-600 md:text-base">
                Leading your dashboard with {formatMoney(topEarningEvent.net_earnings)} in
                net earnings.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[430px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Gross Sales
                </div>
                <div className="mt-1 text-xl font-black text-slate-900">
                  {formatMoney(topEarningEvent.gross_sales)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Paid Out
                </div>
                <div className="mt-1 text-xl font-black text-slate-900">
                  {formatMoney(topEarningEvent.payouts_paid)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    Payout Status
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${payoutBadgeClasses(
                      topEarningEvent
                    )}`}
                  >
                    {payoutBadgeLabel(topEarningEvent)}
                  </span>
                </div>
                <div className="mt-1 text-xl font-black text-slate-900">
                  {formatMoney(topEarningEvent.payouts_owed)}
                </div>
                <div className="mt-1 text-xs text-slate-500">Currently owed</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Events"
          value={totalEvents}
          helper="All organizer events."
          icon="📅"
        />
        <StatCard
          label="Complete"
          value={completeEvents}
          helper="Published events."
          icon="🚀"
        />
        <StatCard
          label="Draft / In Progress"
          value={draftInProgress}
          helper={`${draftInProgress} in progress.`}
          icon="🛠"
        />
        <StatCard
          label="Net Earnings"
          value={earningsLoading ? "..." : formatMoney(earningsSummary.net_earnings)}
          helper="After platform fees."
          icon="💰"
        />
        <StatCard
          label="Pending Payouts"
          value={earningsLoading ? "..." : formatMoney(earningsSummary.payouts_owed)}
          helper="Outstanding balance."
          icon="⏳"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-slate-900">Your Events</h2>
              <p className="mt-1 text-base text-slate-600">
                Jump back into what you were building.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                onClick={() => navigate("/organizer/events")}
              >
                View All
              </button>

              <button
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                onClick={() => navigate("/organizer/events/create")}
              >
                + Create Event
              </button>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-sm text-slate-500">
              No events yet. Create your first event.
            </div>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 3).map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-slate-900">
                        {ev.title || "Untitled Event"}
                      </div>

                      {ev.published ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Published
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Draft
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-500">
                      {[
                        ev.venue_name,
                        [ev.city, ev.state].filter(Boolean).join(", "),
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-lg bg-black px-3 py-1 text-sm text-white transition hover:bg-slate-800"
                      onClick={() => navigate(`/organizer/events/${ev.id}/details`)}
                    >
                      Open
                    </button>

                    <button
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-sm text-white transition hover:bg-indigo-700"
                      onClick={() => navigate(`/organizer/events/${ev.id}/layout`)}
                    >
                      Layout
                    </button>

                    <button
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-sm text-white transition hover:bg-emerald-700"
                      onClick={() => navigate(`/organizer/events/${ev.id}/dashboard`)}
                    >
                      Dashboard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <h2 className="text-2xl font-black text-slate-900">Next Up</h2>
          <p className="mt-1 text-base text-slate-600">
            What you can do right now.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 p-4">
            <div className="text-xl font-bold text-slate-900">
              Pending Applications
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Review vendor applications for your next active event.
            </p>

            <button
              className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              onClick={() => navigate("/organizer/events")}
            >
              Go to Applications
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xl font-bold text-slate-900">Earnings Snapshot</div>
                <p className="mt-2 text-sm text-slate-600">
                  Quick view of sales, net earnings, and amounts still owed.
                </p>
              </div>
              <div className="text-3xl">📈</div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Gross
                </div>
                <div className="mt-1 text-lg font-black text-slate-900">
                  {formatMoney(earningsSummary.gross_sales)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Net
                </div>
                <div className="mt-1 text-lg font-black text-slate-900">
                  {formatMoney(earningsSummary.net_earnings)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  Owed
                </div>
                <div className="mt-1 text-lg font-black text-slate-900">
                  {formatMoney(earningsSummary.payouts_owed)}
                </div>
              </div>
            </div>

            <button
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              onClick={() => navigate("/organizer/events")}
            >
              View Earnings by Event
            </button>
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
        <div className="mb-4">
          <h2 className="text-2xl font-black text-slate-900">Live Activity</h2>
          <p className="mt-1 text-base text-slate-600">
            Recent marketplace actions across your organizer workflow.
          </p>
        </div>

        {activity.length === 0 ? (
          <div className="text-sm text-slate-500">
            No recent activity yet.
          </div>
        ) : (
          <div className="space-y-3">
            {activity.map((item, i) => {
              const rowKey = `${item.type}-${item.title}-${item.time}`;
              const isFresh = freshActivityKeys.includes(rowKey);

              return (
                <div
                  key={rowKey || i}
                  className={`flex items-start justify-between rounded-2xl border border-slate-200 p-4 transition-all duration-500 ${
                    isFresh ? "bg-indigo-50 ring-1 ring-indigo-200" : "bg-white"
                  }`}
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      {item.title || "Activity"}
                    </div>

                    <div className="text-sm text-slate-500">
                      {item.event_name && <>{item.event_name} • </>}
                      {item.message || "Recent marketplace update."}
                    </div>

                    {item.time && (
                      <div className="mt-1 text-xs text-slate-400">
                        {new Date(item.time).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activityBadgeClasses(
                      item.type
                    )}`}
                  >
                    {item.type || "update"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}





