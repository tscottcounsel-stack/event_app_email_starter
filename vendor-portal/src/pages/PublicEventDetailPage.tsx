import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  ShieldCheck,
  Store,
  Ticket,
} from "lucide-react";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type EventModel = {
  id: number | string;
  title?: string;
  description?: string;
  venue_name?: string;
  address?: string;
  city?: string;
  state?: string;
  organizer_email?: string;
  organizer_name?: string;
  verification_status?: "verified" | "pending" | "rejected" | null;
  start_date?: string;
  end_date?: string;
  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  ticketUrl?: string;
  googleMapsUrl?: string;
  vendor_categories?: string[];
  desired_vendor_categories?: string[];
  categories?: string[];
  booth_price?: number | string;
  starting_booth_price?: number | string;
  booths_remaining?: number | string;
  booths_total?: number | string;
  published?: boolean;
  accepting_vendors?: boolean;
  application_deadline?: string;
};

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArray(x: any): string[] {
  return Array.isArray(x) ? x : [];
}

function asNumber(x: any): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isSafeHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveNumericApplicationId(value: any): string {
  const candidates = [
    value?.id,
    value?.application?.id,
    value?.applicationId,
    value?.appId,
    value,
  ];

  for (const candidate of candidates) {
    const s = String(candidate ?? "").trim();
    if (!s) continue;
    if (s === "[object Object]" || s === "undefined" || s === "null") continue;
    if (/^\d+$/.test(s)) return s;
  }

  return "";
}
function formatDateStable(input?: string): string {
  const s = safeStr(input);
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return s;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s;

  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateRange(start?: string, end?: string) {
  const s = formatDateStable(start);
  const e = formatDateStable(end);
  if (!s && !e) return "Dates TBD";
  if (s && e) return `${s} — ${e}`;
  return s || e || "Dates TBD";
}

function formatMoney(value: any) {
  const n = asNumber(value);
  if (n === null) return "Pricing varies";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

function buildMapsSearchUrl(parts: string[]) {
  const q = parts.map((p) => safeStr(p)).filter(Boolean).join(" ");
  if (!q) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function organizerEmailFromEvent(event: any): string {
  return safeStr(
    event?.organizer_email ??
      event?.organizerEmail ??
      event?.organizer?.email ??
      event?.host_email ??
      event?.hostEmail,
  );
}

function organizerNameFromEvent(event: any): string {
  return safeStr(
    event?.organizer_name ??
      event?.organizerName ??
      event?.organizer?.name ??
      event?.host_name ??
      event?.hostName,
  );
}

function organizerVerificationFromEvent(event: any): "verified" | "pending" | "rejected" | null {
  const raw = safeStr(
    event?.verification_status ??
      event?.organizer_verification_status ??
      event?.organizer?.verification_status ??
      event?.organizer?.status,
  ).toLowerCase();

  if (raw === "verified" || raw === "pending" || raw === "rejected") return raw;
  return null;
}

function extractNumericId(value: any, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";

  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    return "";
  }

  if (typeof value !== "object") return "";

  const nestedKeys = [
    "id",
    "appId",
    "applicationId",
    "draftApplicationId",
    "draft_application_id",
    "application_id",
  ];

  for (const key of nestedKeys) {
    const nested = extractNumericId((value as any)?.[key], depth + 1);
    if (nested) return nested;
  }

  return "";
}

function resolveDraftApplicationId(payload: any): string {
  const candidates = [
    payload,
    payload?.id,
    payload?.appId,
    payload?.applicationId,
    payload?.application,
    payload?.application?.id,
    payload?.application?.appId,
    payload?.application?.applicationId,
    payload?.data,
    payload?.data?.id,
    payload?.data?.appId,
    payload?.data?.applicationId,
    payload?.data?.application,
    payload?.draft,
    payload?.draft?.id,
    payload?.draft?.appId,
    payload?.draft?.applicationId,
    payload?.draft?.application,
    payload?.draftApplication,
    payload?.draft_application,
  ];

  for (const candidate of candidates) {
    const resolved = extractNumericId(candidate);
    if (resolved) return resolved;
  }

  return "";
}

function firstNonEmptyArray(...inputs: any[]): string[] {
  for (const value of inputs) {
    const arr = asArray(value)
      .map((x) => safeStr(x))
      .filter(Boolean);
    if (arr.length) return arr;
  }
  return [];
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function PublicEventDetailPage() {
  const { eventId } = useParams();
  const nav = useNavigate();

  const [event, setEvent] = useState<EventModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyErr, setApplyErr] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<"verified" | "pending" | "rejected" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/public/events/${eventId}`);
        const data = await res.json().catch(() => null);

        const ev: EventModel | null =
          data && typeof data === "object"
            ? ((data as any).event ?? (data as any))
            : null;

        if (!cancelled) setEvent(ev);
      } catch {
        if (!cancelled) setEvent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (eventId) load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;

    async function loadVerification() {
      const email = organizerEmailFromEvent(event);
      const embeddedStatus = organizerVerificationFromEvent(event);
      if (embeddedStatus) {
        setVerificationStatus(embeddedStatus);
        return;
      }
      if (!email) {
        setVerificationStatus(null);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/verification/public/${encodeURIComponent(email)}`);
        const data = await res.json().catch(() => null);
        const status = safeStr(data?.status).toLowerCase();
        if (!cancelled) {
          setVerificationStatus(
            status === "verified" || status === "pending" || status === "rejected"
              ? (status as "verified" | "pending" | "rejected")
              : null,
          );
        }
      } catch {
        if (!cancelled) setVerificationStatus(null);
      }
    }

    loadVerification();
    return () => {
      cancelled = true;
    };
  }, [event]);

  const heroUrl = useMemo(() => {
    if (!event) return "";
    return safeStr(event.heroImageUrl) || asArray(event.imageUrls)[0] || "";
  }, [event]);

  const gallery = useMemo(() => {
    if (!event) return [];
    const imgs = asArray(event.imageUrls)
      .map((u) => String(u ?? ""))
      .filter((u) => isSafeHttpUrl(u) || u.startsWith("data:image/"));
    const hero = safeStr(event.heroImageUrl);
    return imgs.filter((u) => !hero || u !== hero).slice(0, 8);
  }, [event]);

  const categories = useMemo(
    () =>
      firstNonEmptyArray(
        (event as any)?.vendor_categories,
        (event as any)?.desired_vendor_categories,
        (event as any)?.categories,
      ).slice(0, 8),
    [event],
  );

  async function handleApply() {
    if (!eventId || applyBusy) return;

    setApplyBusy(true);
    setApplyErr("");

    try {
      nav(`/vendor/events/${encodeURIComponent(String(eventId))}/map`);
    } catch (e: any) {
      setApplyErr(
        e?.message
          ? String(e.message)
          : "Could not start your booth application right now.",
      );
    } finally {
      setApplyBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="animate-pulse space-y-6">
            <div className="h-6 w-36 rounded bg-slate-200" />
            <div className="h-72 rounded-3xl bg-slate-200" />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 h-80 rounded-3xl bg-slate-200" />
              <div className="h-80 rounded-3xl bg-slate-200" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <Link
            to="/events"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to events
          </Link>
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold text-slate-900">Event not found</h1>
            <p className="mt-2 text-slate-600">
              This event may be unpublished or no longer available.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const id = String(event.id);
  const title = safeStr(event.title) || "Untitled event";
  const venue = safeStr(event.venue_name);
  const address = safeStr((event as any).address);
  const city = safeStr(event.city);
  const state = safeStr(event.state);
  const dateLine = formatDateRange(event.start_date, event.end_date);
  const ticketUrl = safeStr((event as any).ticketUrl);
  const googleMapsUrl = safeStr((event as any).googleMapsUrl);
  const mapsHref =
    (isSafeHttpUrl(googleMapsUrl) && googleMapsUrl) ||
    buildMapsSearchUrl([venue, address, city, state]);
  const locationLine = [venue, address, [city, state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" • ");
  const description = safeStr(event.description);
  const hasTicket = isSafeHttpUrl(ticketUrl);
  const boothPrice = formatMoney((event as any).starting_booth_price ?? (event as any).booth_price);
  const boothsRemaining = asNumber((event as any).booths_remaining);
  const boothsTotal = asNumber((event as any).booths_total);
  const eventStatus =
    boothsRemaining === 0
      ? "Full"
      : (event as any)?.accepting_vendors === false
        ? "Closed"
        : (event as any)?.published === false
          ? "Draft"
          : "Accepting vendors";
  const applicationDeadline = formatDateStable((event as any).application_deadline);
  const organizerEmail = organizerEmailFromEvent(event);
  const organizerName = organizerNameFromEvent(event) || organizerEmail || "Organizer";
  const showVerifiedBadge = verificationStatus === "verified";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="relative overflow-hidden border-b border-slate-200 bg-slate-950">
        {heroUrl ? (
          <img
            src={heroUrl}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-slate-900 to-slate-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-900/40" />

        <div className="relative mx-auto max-w-6xl px-6 py-8 md:py-14">
          <Link
            to="/events"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur hover:bg-white/15"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to events
          </Link>

          <div className="mt-8 max-w-4xl">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">
                {eventStatus}
              </span>
              {categories.length > 0 ? (
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/80">
                  {categories.length} vendor categories wanted
                </span>
              ) : null}
            </div>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white md:text-6xl">
              {title}
            </h1>

            <div className="mt-4 flex flex-col gap-3 text-white/85 md:text-lg">
              <div className="inline-flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{locationLine || "Location TBD"}</span>
              </div>
              <div className="inline-flex items-center gap-3">
                <CalendarDays className="h-5 w-5 shrink-0" />
                <span>{dateLine}</span>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={<Store className="h-5 w-5" />} label="Booths from" value={boothPrice} />
              <StatCard
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Availability"
                value={
                  boothsRemaining !== null
                    ? boothsTotal !== null
                      ? `${boothsRemaining} of ${boothsTotal} left`
                      : `${boothsRemaining} spots left`
                    : "Check floorplan"
                }
              />
              <StatCard
                icon={<CalendarDays className="h-5 w-5" />}
                label="Apply by"
                value={applicationDeadline || "See requirements"}
              />
              <StatCard
                icon={<Ticket className="h-5 w-5" />}
                label="Public access"
                value={hasTicket ? "Tickets available" : "Vendor applications open"}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
          <div className="space-y-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm md:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Event overview
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">Everything vendors need to know</h2>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
                    <CalendarDays className="h-4 w-4" />
                    Date
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{dateLine}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
                    <MapPin className="h-4 w-4" />
                    Location
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">
                    {locationLine || "Location TBD"}
                  </div>
                  {mapsHref ? (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-800"
                    >
                      Open in Google Maps
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              {categories.length > 0 ? (
                <div className="mt-8">
                  <h3 className="text-lg font-bold text-slate-900">Vendor categories wanted</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {categories.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-8">
                <h3 className="text-lg font-bold text-slate-900">About this event</h3>
                <p className="mt-3 whitespace-pre-line text-slate-700 leading-7">
                  {description || "More event details will be shared soon."}
                </p>
              </div>
            </div>

            {gallery.length > 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm md:p-8">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-slate-500" />
                  <h3 className="text-xl font-bold text-slate-900">Event gallery</h3>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {gallery.map((u, index) => (
                    <div
                      key={`${u}-${index}`}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                    >
                      <img src={u} alt={`Event gallery ${index + 1}`} className="h-44 w-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-6 lg:sticky lg:top-6 h-fit">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Vendor actions
              </div>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Ready to apply?</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Review the floorplan, check event requirements, and start your booth application.
              </p>

              {applyErr ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {applyErr}
                </div>
              ) : null}

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleApply}
                  disabled={applyBusy}
                >
                  {applyBusy ? "Starting application..." : "Apply for a booth"}
                  {!applyBusy ? <ChevronRight className="h-4 w-4" /> : null}
                </button>

                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                  onClick={() => nav(`/vendor/events/${id}/map`)}
                >
                  View floorplan
                </button>

                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                  onClick={() => nav(`/vendor/events/${id}/requirements`)}
                >
                  View requirements
                </button>

                {hasTicket ? (
                  <a
                    href={ticketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-3.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
                  >
                    Purchase tickets
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </div>

            {organizerEmail ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Organizer
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    to={`/organizers/${encodeURIComponent(organizerEmail)}`}
                    className="text-lg font-bold text-slate-900 hover:text-indigo-700 hover:underline"
                  >
                    {organizerName}
                  </Link>
                  {showVerifiedBadge ? (
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      Verified
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  View the organizer profile for ratings, reviews, and verification details.
                </p>
              </div>
            ) : null}

            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                Quick facts
              </div>
              <div className="mt-4 space-y-4 text-sm text-slate-700">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <span className="text-slate-500">Booth pricing</span>
                  <span className="text-right font-semibold text-slate-900">{boothPrice}</span>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <span className="text-slate-500">Availability</span>
                  <span className="text-right font-semibold text-slate-900">
                    {boothsRemaining !== null
                      ? boothsTotal !== null
                        ? `${boothsRemaining} / ${boothsTotal} left`
                        : `${boothsRemaining} spots left`
                      : "See floorplan"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <span className="text-slate-500">Event status</span>
                  <span className="text-right font-semibold text-slate-900">{eventStatus}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-500">Application path</span>
                  <span className="text-right font-semibold text-slate-900">Apply → Approval → Payment</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}





