// src/pages/OrganizerEventDashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type EventRow = {
  id: number;
  title?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  published?: boolean;
};

type ApplicationRow = {
  id?: number | string;
  vendor_email?: string | null;
  vendor_name?: string | null;
  company_name?: string | null;
  booth_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  amount_cents?: number | null;
  updated_at?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  score?: number | null;
  score_tier?: string | null;
  [key: string]: any;
};

type EarningsSummary = {
  gross_sales: number;
  platform_fees: number;
  net_earnings: number;
  payouts_paid: number;
  payouts_owed: number;
};

type EarningsEventRow = {
  event_id: number;
  event_title?: string;
  gross_sales: number;
  platform_fees: number;
  net_earnings: number;
};

type EarningsResponse = {
  summary?: Partial<EarningsSummary>;
  events?: EarningsEventRow[];
};

function StatCard(props: {
  label: string;
  value: number | string;
  helper?: string;
}) {
  const { label, value, helper } = props;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900">
        {value}
      </div>
      {helper ? <div className="mt-2 text-sm text-slate-500">{helper}</div> : null}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function statusBadgeClasses(status?: string | null) {
  const s = String(status || "").toLowerCase();

  if (["approved", "paid", "completed"].includes(s)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (
    ["submitted", "pending", "under_review", "awaiting_payment", "processing"].includes(
      s
    )
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (["rejected", "failed", "expired", "cancelled", "canceled"].includes(s)) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function vendorLabel(app: ApplicationRow) {
  return (
    app.company_name ||
    app.vendor_name ||
    app.vendor_email ||
    `Application #${app.id ?? "—"}`
  );
}

function normalizeMoney(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function OrganizerEventDashboardPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [eventRow, setEventRow] = useState<EventRow | null>(null);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [earningsSummary, setEarningsSummary] = useState<EarningsSummary>({
    gross_sales: 0,
    platform_fees: 0,
    net_earnings: 0,
    payouts_paid: 0,
    payouts_owed: 0,
  });
  const [eventEarnings, setEventEarnings] = useState<EarningsEventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const [eventsRes, appsRes, earningsRes] = await Promise.all([
          fetch(`${API_BASE}/organizer/events`, {
            headers: buildAuthHeaders(),
          }),
          fetch(`${API_BASE}/organizer/events/${eventId}/applications`, {
            headers: buildAuthHeaders(),
          }),
          fetch(`${API_BASE}/organizer/earnings`, {
            headers: buildAuthHeaders(),
          }),
        ]);

        const eventsData = await eventsRes.json().catch(() => null);
        const appsData = await appsRes.json().catch(() => null);
        const earningsData: EarningsResponse | null = await earningsRes
          .json()
          .catch(() => null);

        if (cancelled) return;

        const events = Array.isArray(eventsData?.events) ? eventsData.events : [];
        const foundEvent =
          events.find((ev: EventRow) => String(ev.id) === String(eventId)) || null;

        const appRows = Array.isArray(appsData?.applications)
          ? appsData.applications
          : [];

        const summary = earningsData?.summary || {};
        const earningsEvents = Array.isArray(earningsData?.events)
          ? earningsData?.events || []
          : [];

        const matchedEventEarnings =
          earningsEvents.find((ev) => String(ev.event_id) === String(eventId)) || null;

        setEventRow(foundEvent);
        setApplications(appRows);
        setEarningsSummary({
          gross_sales: normalizeMoney(summary.gross_sales),
          platform_fees: normalizeMoney(summary.platform_fees),
          net_earnings: normalizeMoney(summary.net_earnings),
          payouts_paid: normalizeMoney(summary.payouts_paid),
          payouts_owed: normalizeMoney(summary.payouts_owed),
        });
        setEventEarnings(
          matchedEventEarnings
            ? {
                event_id: Number(matchedEventEarnings.event_id || 0),
                event_title: matchedEventEarnings.event_title,
                gross_sales: normalizeMoney(matchedEventEarnings.gross_sales),
                platform_fees: normalizeMoney(matchedEventEarnings.platform_fees),
                net_earnings: normalizeMoney(matchedEventEarnings.net_earnings),
              }
            : null
        );
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load event dashboard.");
          setEventRow(null);
          setApplications([]);
          setEventEarnings(null);
          setEarningsSummary({
            gross_sales: 0,
            platform_fees: 0,
            net_earnings: 0,
            payouts_paid: 0,
            payouts_owed: 0,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const stats = useMemo(() => {
    const totalApplications = applications.length;

    const approvedCount = applications.filter((app) =>
      ["approved"].includes(String(app.status || "").toLowerCase())
    ).length;

    const submittedCount = applications.filter((app) =>
      ["submitted", "under_review", "in_review"].includes(
        String(app.status || "").toLowerCase()
      )
    ).length;

    const paidCount = applications.filter((app) =>
      String(app.payment_status || "").toLowerCase() === "paid"
    ).length;

    const reservedCount = applications.filter(
      (app) => !!String(app.booth_id || "").trim()
    ).length;

    const revenue = applications.reduce((sum, app) => {
      if (String(app.payment_status || "").toLowerCase() !== "paid") return sum;
      const cents = Number(app.amount_cents || 0);
      if (Number.isFinite(cents) && cents > 0) return sum + cents / 100;
      return sum + 500;
    }, 0);

    return {
      totalApplications,
      approvedCount,
      submittedCount,
      paidCount,
      reservedCount,
      revenue,
    };
  }, [applications]);

  const recentApplications = useMemo(() => {
    return [...applications]
      .sort((a, b) => {
        const ad = new Date(
          String(a.updated_at || a.submitted_at || a.created_at || 0)
        ).getTime();
        const bd = new Date(
          String(b.updated_at || b.submitted_at || b.created_at || 0)
        ).getTime();
        return bd - ad;
      })
      .slice(0, 6);
  }, [applications]);

  const paidApplications = useMemo(() => {
    return applications
      .filter((app) => String(app.payment_status || "").toLowerCase() === "paid")
      .slice(0, 6);
  }, [applications]);

  const title = eventRow?.title || `Event #${eventId}`;
  const location = [
    eventRow?.venue_name,
    [eventRow?.city, eventRow?.state].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="space-y-8 p-6">
      <div className="rounded-[2rem] bg-gradient-to-r from-slate-950 via-indigo-900 to-violet-700 p-7 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
              Organizer Event Dashboard
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-white/80 md:text-base">
              Track applications, approvals, reservations, paid vendors, and event
              revenue from one control center.
            </p>
            {location ? (
              <div className="mt-4 text-sm font-medium text-white/80">{location}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              onClick={() => navigate(`/organizer/events/${eventId}/details`)}
            >
              Event Details
            </button>
            <button
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
              onClick={() => navigate(`/organizer/events/${eventId}/layout`)}
            >
              Booth Layout
            </button>
            <button
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              onClick={() => navigate(`/organizer/events/${eventId}/applications`)}
            >
              View Applications
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Applications"
          value={stats.totalApplications}
          helper="All vendors for this event."
        />
        <StatCard
          label="Approved"
          value={stats.approvedCount}
          helper="Organizer-approved vendors."
        />
        <StatCard
          label="Pending Review"
          value={stats.submittedCount}
          helper="Submitted and awaiting action."
        />
        <StatCard
          label="Booths Reserved"
          value={stats.reservedCount}
          helper="Applications with a booth assigned."
        />
        <StatCard
          label="Revenue"
          value={formatCurrency(stats.revenue)}
          helper={`${stats.paidCount} paid vendor${stats.paidCount === 1 ? "" : "s"}.`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Event Gross Sales"
          value={formatCurrency(eventEarnings?.gross_sales || 0)}
          helper="Total paid vendor sales for this event."
        />
        <StatCard
          label="Platform Fees"
          value={formatCurrency(eventEarnings?.platform_fees || 0)}
          helper="Fees retained by VendorConnect."
        />
        <StatCard
          label="Event Net Earnings"
          value={formatCurrency(eventEarnings?.net_earnings || 0)}
          helper="What this event has earned after fees."
        />
        <StatCard
          label="Organizer Payouts Owed"
          value={formatCurrency(earningsSummary.payouts_owed)}
          helper="Across organizer earnings still awaiting payout."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
        <StatCard
          label="Organizer Total Net"
          value={formatCurrency(earningsSummary.net_earnings)}
          helper="All organizer event earnings combined."
        />
        <StatCard
          label="Organizer Payouts Paid"
          value={formatCurrency(earningsSummary.payouts_paid)}
          helper="Already marked paid to the organizer."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-slate-900">Recent Applications</h2>
              <p className="mt-1 text-sm text-slate-600">
                The latest vendor activity for this event.
              </p>
            </div>

            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              onClick={() => navigate(`/organizer/events/${eventId}/applications`)}
            >
              Open Queue
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Loading applications...</div>
          ) : recentApplications.length === 0 ? (
            <div className="text-sm text-slate-500">No applications yet for this event.</div>
          ) : (
            <div className="space-y-3">
              {recentApplications.map((app) => (
                <div
                  key={String(app.id)}
                  className="rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{vendorLabel(app)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {app.vendor_email || "No email"} • Updated {formatDate(app.updated_at || app.submitted_at || app.created_at)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses(
                          app.status
                        )}`}
                      >
                        {app.status || "draft"}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses(
                          app.payment_status
                        )}`}
                      >
                        {app.payment_status || "unpaid"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
                    <div>Booth: {app.booth_id || "—"}</div>
                    <div>Score: {app.score ?? "—"}</div>
                    <div>Tier: {app.score_tier || "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-slate-900">Paid Vendors</h2>
              <p className="mt-1 text-sm text-slate-600">
                Revenue-producing vendors for this event.
              </p>
            </div>

            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              onClick={() => navigate("/admin/payments")}
            >
              View Payments
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Loading payments...</div>
          ) : paidApplications.length === 0 ? (
            <div className="text-sm text-slate-500">
              No paid vendors yet for this event.
            </div>
          ) : (
            <div className="space-y-3">
              {paidApplications.map((app) => {
                const amount =
                  Number(app.amount_cents || 0) > 0
                    ? Number(app.amount_cents || 0) / 100
                    : 500;

                return (
                  <div
                    key={String(app.id)}
                    className="rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{vendorLabel(app)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Booth {app.booth_id || "—"} • Paid {formatDate(app.paid_at || app.updated_at)}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-bold text-slate-900">
                          {formatCurrency(amount)}
                        </div>
                        <div className="mt-1">
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Paid
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-2xl font-black text-slate-900">Quick Actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            Jump directly into the parts of this event you are most likely to manage next.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <button
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:bg-slate-50"
            onClick={() => navigate(`/organizer/events/${eventId}/applications`)}
          >
            <div className="text-sm font-bold text-slate-900">Applications</div>
            <div className="mt-2 text-sm text-slate-500">
              Review and score vendor submissions.
            </div>
          </button>

          <button
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:bg-slate-50"
            onClick={() => navigate(`/organizer/events/${eventId}/layout`)}
          >
            <div className="text-sm font-bold text-slate-900">Booth Layout</div>
            <div className="mt-2 text-sm text-slate-500">
              Manage booth map reservations and placement.
            </div>
          </button>

          <button
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:bg-slate-50"
            onClick={() => navigate(`/organizer/events/${eventId}/details`)}
          >
            <div className="text-sm font-bold text-slate-900">Event Details</div>
            <div className="mt-2 text-sm text-slate-500">
              Update event settings, publishing, and setup info.
            </div>
          </button>

          <button
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:bg-slate-50"
            onClick={() => navigate("/organizer/events")}
          >
            <div className="text-sm font-bold text-slate-900">All Events</div>
            <div className="mt-2 text-sm text-slate-500">
              Return to the organizer event list.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}



