import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type DashboardStat = {
  label: string;
  value: string | number;
  helper?: string;
};

type ActivityItem = {
  id: string | number;
  type: string;
  summary: string;
  actor?: string | null;
  created_at?: string | null;
  status?: string | null;
};

type VerificationItem = {
  id: string | number;
  name: string;
  role: "vendor" | "organizer";
  submitted_at?: string | null;
  status?: string | null;
  company_name?: string | null;
};

type PaymentItem = {
  id: string | number;
  vendor_name?: string | null;
  organizer_name?: string | null;
  event_title?: string | null;
  amount?: number | string | null;
  platform_fee?: number | string | null;
  organizer_payout?: number | string | null;
  status?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

type DashboardResponse = {
  stats?: {
    total_vendors?: number;
    total_organizers?: number;
    live_events?: number;
    applications_submitted?: number;
    approved_awaiting_payment?: number;
    paid_applications?: number;
    pending_verifications?: number;
    platform_revenue?: number;
  };
  recent_activity?: ActivityItem[];
  pending_verifications?: VerificationItem[];
  recent_payments?: PaymentItem[];
};

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCurrency(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function badgeClass(status?: string | null): string {
  const s = String(status ?? "").toLowerCase();

  if (["paid", "verified", "approved", "active", "completed"].includes(s)) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (["pending", "awaiting_payment", "under_review", "processing", "submitted"].includes(s)) {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (["failed", "rejected", "expired", "cancelled", "canceled", "suspended"].includes(s)) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }

  return "bg-slate-50 text-slate-700 border-slate-200";
}

function roleBadgeClass(role?: string | null): string {
  return String(role ?? "").toLowerCase() === "organizer"
    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
}

function initials(label?: string | null): string {
  const text = String(label ?? "").trim();
  if (!text) return "VC";
  const parts = text.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "VC";
}

const mockStats: DashboardStat[] = [
  { label: "Total Vendors", value: 248, helper: "Accounts on the marketplace" },
  { label: "Total Organizers", value: 37, helper: "Hosts using the platform" },
  { label: "Live Events", value: 18, helper: "Public events currently visible" },
  { label: "Applications Submitted", value: 426, helper: "Across all organizer events" },
  { label: "Approved Awaiting Payment", value: 29, helper: "Needs payment follow-through" },
  { label: "Paid Applications", value: 117, helper: "Successfully paid booth placements" },
  { label: "Pending Verifications", value: 11, helper: "Vendors and organizers awaiting review" },
  { label: "Platform Revenue", value: "$4,860", helper: "Collected fees to date" },
];

const mockActivity: ActivityItem[] = [
  {
    id: 1,
    type: "payment_paid",
    summary: "Booth payment completed for Atlanta Art Weekend.",
    actor: "Troy's Custom Art",
    created_at: new Date().toISOString(),
    status: "paid",
  },
  {
    id: 2,
    type: "verification_submitted",
    summary: "New organizer verification submitted.",
    actor: "Peachtree Event Group",
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    status: "pending",
  },
  {
    id: 3,
    type: "application_submitted",
    summary: "Vendor application submitted for Spring Makers Market.",
    actor: "Canvas & Clay Studio",
    created_at: new Date(Date.now() - 1000 * 60 * 110).toISOString(),
    status: "submitted",
  },
  {
    id: 4,
    type: "booth_reserved",
    summary: "Booth B-12 reserved pending payment.",
    actor: "Nashville Vintage Collective",
    created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    status: "awaiting_payment",
  },
];

const mockVerifications: VerificationItem[] = [
  {
    id: 101,
    name: "Canvas & Clay Studio",
    role: "vendor",
    company_name: "Canvas & Clay Studio",
    submitted_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    status: "pending",
  },
  {
    id: 102,
    name: "Peachtree Event Group",
    role: "organizer",
    company_name: "Peachtree Event Group",
    submitted_at: new Date(Date.now() - 1000 * 60 * 220).toISOString(),
    status: "pending",
  },
  {
    id: 103,
    name: "Southern Street Eats",
    role: "vendor",
    company_name: "Southern Street Eats",
    submitted_at: new Date(Date.now() - 1000 * 60 * 400).toISOString(),
    status: "pending",
  },
];

const mockPayments: PaymentItem[] = [
  {
    id: 8001,
    vendor_name: "Troy's Custom Art",
    organizer_name: "Atlanta Arts Council",
    event_title: "Atlanta Art Weekend",
    amount: 250,
    platform_fee: 20,
    organizer_payout: 230,
    status: "paid",
    paid_at: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 8002,
    vendor_name: "Southern Street Eats",
    organizer_name: "Peachtree Event Group",
    event_title: "City Food & Culture Fest",
    amount: 400,
    platform_fee: 32,
    organizer_payout: 368,
    status: "pending",
    created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
  },
  {
    id: 8003,
    vendor_name: "Nashville Vintage Collective",
    organizer_name: "Riverfront Markets",
    event_title: "Vintage Market Pop-Up",
    amount: 180,
    platform_fee: 14.4,
    organizer_payout: 165.6,
    status: "failed",
    created_at: new Date(Date.now() - 1000 * 60 * 210).toISOString(),
  },
];

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, helper }: DashboardStat) {
  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm transition hover:shadow-md">
      <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-3 text-5xl font-extrabold tracking-tight text-slate-950">
        {value}
      </div>
      {helper ? (
        <div className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          {helper}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const session = useMemo(() => readSession(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<DashboardStat[]>(mockStats);
  const [activity, setActivity] = useState<ActivityItem[]>(mockActivity);
  const [verifications, setVerifications] = useState<VerificationItem[]>(mockVerifications);
  const [payments, setPayments] = useState<PaymentItem[]>(mockPayments);


  function handleLogout() {
    try {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("authSession");
      localStorage.removeItem("session");
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("authSession");
      sessionStorage.removeItem("session");
    } catch {}

    navigate("/login", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        setLoading(true);
        setError(null);

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (session?.accessToken) {
          headers.Authorization = `Bearer ${session.accessToken}`;
        }
        if (session?.email) {
          headers["x-user-email"] = session.email;
        }

        const res = await fetch(`${API_BASE}/admin/dashboard`, { headers });

        if (!res.ok) {
          throw new Error(`Dashboard request failed (${res.status})`);
        }

        const data: DashboardResponse = await res.json();

        if (cancelled) return;

        const serverStats: DashboardStat[] = [
          {
            label: "Total Vendors",
            value: formatNumber(data?.stats?.total_vendors ?? 0),
            helper: "Accounts on the marketplace",
          },
          {
            label: "Total Organizers",
            value: formatNumber(data?.stats?.total_organizers ?? 0),
            helper: "Hosts using the platform",
          },
          {
            label: "Live Events",
            value: formatNumber(data?.stats?.live_events ?? 0),
            helper: "Public events currently visible",
          },
          {
            label: "Applications Submitted",
            value: formatNumber(data?.stats?.applications_submitted ?? 0),
            helper: "Across all organizer events",
          },
          {
            label: "Approved Awaiting Payment",
            value: formatNumber(data?.stats?.approved_awaiting_payment ?? 0),
            helper: "Needs payment follow-through",
          },
          {
            label: "Paid Applications",
            value: formatNumber(data?.stats?.paid_applications ?? 0),
            helper: "Successfully paid booth placements",
          },
          {
            label: "Pending Verifications",
            value: formatNumber(data?.stats?.pending_verifications ?? 0),
            helper: "Vendors and organizers awaiting review",
          },
          {
            label: "Platform Revenue",
            value: formatCurrency(data?.stats?.platform_revenue ?? 0),
            helper: "Collected fees to date",
          },
        ];

        setStats(serverStats);
        setActivity(Array.isArray(data?.recent_activity) ? data.recent_activity : []);
        setVerifications(
          Array.isArray(data?.pending_verifications) ? data.pending_verifications : []
        );
        setPayments(Array.isArray(data?.recent_payments) ? data.recent_payments : []);
      } catch (e: any) {
        if (!cancelled) {
          setError(
            e?.message ||
              "Using preview dashboard data until the admin endpoint is connected."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, session?.email]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <div className="rounded-[2rem] border bg-gradient-to-r from-slate-950 via-indigo-950 to-purple-900 p-8 text-white shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-200">
                Admin Control Center
              </div>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
                Marketplace oversight in one place
              </h1>
              <p className="mt-4 text-base font-semibold leading-7 text-slate-200">
                Track vendors, organizers, live events, verifications, payments, and
                platform revenue from a single command page while the new payment
                architecture is being built out.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Link
                to="/admin/verifications"
                className="rounded-2xl bg-emerald-400 px-5 py-3 text-center text-sm font-extrabold text-black transition hover:bg-emerald-300"
              >
                Review Verifications
              </Link>
              <Link
                to="/admin/payments"
                className="rounded-2xl bg-white px-5 py-3 text-center text-sm font-extrabold text-slate-950 transition hover:bg-slate-100"
              >
                Go to Payments
              </Link>
              <Link
                to="/admin/events"
                className="rounded-2xl bg-white/10 px-5 py-3 text-center text-sm font-extrabold text-white backdrop-blur transition hover:bg-white/20"
              >
                Manage Events
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-center text-sm font-extrabold text-white transition hover:bg-white/15"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              helper={stat.helper}
            />
          ))}
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
            <SectionTitle
              eyebrow="Recent activity"
              title="What’s happening right now"
              subtitle="A rolling feed of the most relevant marketplace actions."
            />

            <div className="mt-6 space-y-4">
              {(activity.length ? activity : mockActivity).map((item) => (
                <div
                  key={item.id}
                  className="flex gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-black text-white">
                    {initials(item.actor || item.type)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-slate-950">
                        {item.actor || "System"}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${badgeClass(
                          item.status || item.type
                        )}`}
                      >
                        {String(item.status || item.type || "activity").replaceAll("_", " ")}
                      </span>
                    </div>

                    <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                      {item.summary}
                    </div>

                    <div className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      {formatDateTime(item.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-8">
            <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
              <SectionTitle
                eyebrow="Pending verification queue"
                title="Users awaiting review"
                subtitle="This is where your trust layer becomes the product."
              />

              <div className="mt-6 space-y-4">
                {(verifications.length ? verifications : mockVerifications).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-black text-slate-950">
                          {item.name}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">
                          {item.company_name || "No company name provided"}
                        </div>
                      </div>

                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${roleBadgeClass(
                          item.role
                        )}`}
                      >
                        {item.role}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${badgeClass(
                          item.status
                        )}`}
                      >
                        {String(item.status || "pending").replaceAll("_", " ")}
                      </span>

                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Submitted {formatDateTime(item.submitted_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
              <SectionTitle
                eyebrow="Revenue snapshot"
                title="Payment activity"
                subtitle="A quick pulse check while the new platform payment model is built."
              />

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Total payment rows
                  </div>
                  <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                    {formatNumber((payments.length ? payments : mockPayments).length)}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Paid rows
                  </div>
                  <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                    {formatNumber(
                      (payments.length ? payments : mockPayments).filter(
                        (p) => String(p.status || "").toLowerCase() === "paid"
                      ).length
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Gross shown
                  </div>
                  <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                    {formatCurrency(
                      (payments.length ? payments : mockPayments).reduce((sum, p) => {
                        const value = Number(p.amount ?? 0);
                        return sum + (Number.isFinite(value) ? value : 0);
                      }, 0)
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
          <SectionTitle
            eyebrow="Recent payments"
            title="Latest payment rows"
            subtitle="Use this table to validate booth payments, platform fees, and organizer payouts."
          />

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Payment
                  </th>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Event
                  </th>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Vendor / Organizer
                  </th>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Amounts
                  </th>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Status
                  </th>
                  <th className="px-4 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
                    Timestamp
                  </th>
                </tr>
              </thead>

              <tbody>
                {(payments.length ? payments : mockPayments).map((item) => (
                  <tr key={item.id} className="rounded-3xl bg-slate-50">
                    <td className="rounded-l-3xl px-4 py-4 align-top">
                      <div className="font-black text-slate-950">#{item.id}</div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="font-semibold text-slate-800">
                        {item.event_title || "Untitled event"}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-black text-slate-950">
                        {item.vendor_name || "Unknown vendor"}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-600">
                        Organizer: {item.organizer_name || "Unknown organizer"}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-700">
                        Gross: <span className="font-black">{formatCurrency(item.amount)}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-700">
                        Fee: <span className="font-black">{formatCurrency(item.platform_fee)}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-700">
                        Payout:{" "}
                        <span className="font-black">
                          {formatCurrency(item.organizer_payout)}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4 align-top">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${badgeClass(
                          item.status
                        )}`}
                      >
                        {String(item.status || "pending").replaceAll("_", " ")}
                      </span>
                    </td>

                    <td className="rounded-r-3xl px-4 py-4 align-top text-sm font-semibold text-slate-600">
                      {formatDateTime(item.paid_at || item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {loading ? (
          <div className="pb-2 text-sm font-semibold text-slate-500">
            Loading admin dashboard…
          </div>
        ) : null}
      </div>
    </div>
  );
}





