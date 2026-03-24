// vendor-portal/src/pages/PublicEventsListPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Filter,
  ListFilter,
  MapPin,
  Search,
  Store,
  Tag,
} from "lucide-react";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventModel = {
  id: number | string;
  title?: string;
  description?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
  heroImageUrl?: string;
  imageUrls?: string[];
  published?: boolean;
  organizer_email?: string;
  organizerEmail?: string;
  organizer_name?: string;
  organizerName?: string;
  organizer?: {
    email?: string;
    name?: string;
    organizer_email?: string;
    organizer_name?: string;
    verification_status?: string;
    verified?: boolean;
  };
  verification_status?: string;
  organizer_verification_status?: string;
  [key: string]: any;
};

type VerificationStatus = "verified" | "pending" | "rejected" | null;
type VerificationMap = Record<string, VerificationStatus>;

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArray(x: any): string[] {
  return Array.isArray(x) ? x : [];
}

function firstNumber(...values: any[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Pricing varies";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
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
  if (isNaN(dt.getTime())) return s;

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

function normalizeTextList(input: any): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => safeStr(item)).filter(Boolean);
  }
  const raw = safeStr(input);
  if (!raw) return [];
  return raw
    .split(/[|,;/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCategories(ev: EventModel): string[] {
  const direct = normalizeTextList(ev.category);
  const wanted = normalizeTextList(
    ev.vendor_categories ??
      ev.vendorCategories ??
      ev.desired_vendor_categories ??
      ev.desiredVendorCategories ??
      ev.categories
  );
  const combined = [...direct, ...wanted];
  return Array.from(new Set(combined.map((x) => x.toLowerCase()))).map((key) => {
    const match = combined.find((item) => item.toLowerCase() === key);
    return match || key;
  });
}

function getHero(ev: EventModel) {
  return safeStr(ev.heroImageUrl) || asArray(ev.imageUrls)[0] || "";
}

function getLocationLine(ev: EventModel) {
  const venue = safeStr(ev.venue_name);
  const city = safeStr(ev.city);
  const state = safeStr(ev.state);
  const cityState = [city, state].filter(Boolean).join(", ");
  return [venue, cityState].filter(Boolean).join(" • ") || "Location TBD";
}

function getBoothsRemaining(ev: EventModel): number | null {
  return firstNumber(
    ev.spots_left,
    ev.spotsLeft,
    ev.booths_remaining,
    ev.boothsRemaining,
    ev.remaining_booths,
    ev.remainingBooths,
    ev.available_booths,
    ev.availableBooths,
    ev.open_booths,
    ev.openBooths
  );
}

function getBoothPrice(ev: EventModel): number | null {
  return firstNumber(
    ev.booths_from_price,
    ev.boothsFromPrice,
    ev.starting_booth_price,
    ev.startingBoothPrice,
    ev.booth_price,
    ev.boothPrice,
    ev.price,
    ev.min_booth_price,
    ev.minBoothPrice,
    ev.lowest_booth_price,
    ev.lowestBoothPrice
  );
}

function isAcceptingVendors(ev: EventModel): boolean {
  const status = safeStr(ev.status || ev.event_status || ev.eventStatus).toLowerCase();
  if (["accepting vendors", "accepting", "published", "open", "live", "active"].includes(status)) {
    return true;
  }
  if (["closed", "draft", "archived", "cancelled", "canceled", "full"].includes(status)) {
    return false;
  }
  if (typeof ev.accepting_vendors === "boolean") return !!ev.accepting_vendors;
  if (typeof ev.acceptingVendors === "boolean") return !!ev.acceptingVendors;
  if (typeof ev.published === "boolean") return !!ev.published;
  return true;
}

function getSearchBlob(ev: EventModel) {
  return [
    ev.title,
    ev.description,
    ev.venue_name,
    ev.city,
    ev.state,
    ev.category,
    safeStr(ev.organizer_name || ev.organizerName || ev.organizer?.name || ev.organizer?.organizer_name),
    ...(getCategories(ev) || []),
  ]
    .map((value) => safeStr(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function sortEvents(events: EventModel[], sortBy: string) {
  const copy = [...events];

  copy.sort((a, b) => {
    if (sortBy === "price") {
      const ap = getBoothPrice(a);
      const bp = getBoothPrice(b);
      if (ap === null && bp === null) return 0;
      if (ap === null) return 1;
      if (bp === null) return -1;
      return ap - bp;
    }

    if (sortBy === "spots") {
      const ar = getBoothsRemaining(a);
      const br = getBoothsRemaining(b);
      if (ar === null && br === null) return 0;
      if (ar === null) return 1;
      if (br === null) return -1;
      return br - ar;
    }

    if (sortBy === "newest") {
      const at = new Date(safeStr(a.start_date || "9999-12-31")).getTime();
      const bt = new Date(safeStr(b.start_date || "9999-12-31")).getTime();
      return bt - at;
    }

    const at = new Date(safeStr(a.start_date || "9999-12-31")).getTime();
    const bt = new Date(safeStr(b.start_date || "9999-12-31")).getTime();
    return at - bt;
  });

  return copy;
}

function getOrganizerEmail(ev: EventModel): string {
  return safeStr(
    ev.organizer_email || ev.organizerEmail || ev.organizer?.email || ev.organizer?.organizer_email
  );
}

function getOrganizerName(ev: EventModel): string {
  return (
    safeStr(ev.organizer_name || ev.organizerName || ev.organizer?.name || ev.organizer?.organizer_name) ||
    getOrganizerEmail(ev) ||
    "Organizer"
  );
}

function normalizeVerificationStatus(value: any): VerificationStatus {
  const s = safeStr(value).toLowerCase();
  if (s === "verified") return "verified";
  if (s === "pending") return "pending";
  if (s === "rejected") return "rejected";
  return null;
}

function getInlineVerificationStatus(ev: EventModel): VerificationStatus {
  if (ev.organizer?.verified === true) return "verified";
  return normalizeVerificationStatus(
    ev.organizer_verification_status || ev.verification_status || ev.organizer?.verification_status
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-yellow-800">
      <BadgeCheck className="h-3.5 w-3.5" />
      Verified
    </span>
  );
}

export default function PublicEventsListPage() {
  const [events, setEvents] = useState<EventModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");
  const [category, setCategory] = useState("all");
  const [acceptingOnly, setAcceptingOnly] = useState(true);
  const [sortBy, setSortBy] = useState("soonest");
  const [verificationMap, setVerificationMap] = useState<VerificationMap>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/events`);
        const data = await res.json().catch(() => null);

        let list: any[] = [];
        if (Array.isArray((data as any)?.events)) list = (data as any).events;
        else if (Array.isArray(data)) list = data as any[];
        else if (data && typeof data === "object" && (data as any).id) list = [data];

        if (!cancelled) setEvents(list as EventModel[]);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadVerificationStatuses() {
      const uniqueEmails = Array.from(
        new Set(events.map((ev) => getOrganizerEmail(ev)).filter(Boolean))
      );

      if (uniqueEmails.length === 0) return;

      const nextMap: VerificationMap = {};
      uniqueEmails.forEach((email) => {
        nextMap[email] = verificationMap[email] ?? null;
      });

      const emailsToFetch = uniqueEmails.filter((email) => !(email in verificationMap));
      if (emailsToFetch.length === 0) return;

      await Promise.all(
        emailsToFetch.map(async (email) => {
          try {
            const res = await fetch(`${API_BASE}/verification/public/${encodeURIComponent(email)}`);
            if (!res.ok) {
              nextMap[email] = null;
              return;
            }
            const data = await res.json().catch(() => null);
            nextMap[email] = normalizeVerificationStatus(data?.status);
          } catch {
            nextMap[email] = null;
          }
        })
      );

      if (!cancelled) {
        setVerificationMap((prev) => ({ ...prev, ...nextMap }));
      }
    }

    loadVerificationStatuses();
    return () => {
      cancelled = true;
    };
  }, [events, verificationMap]);

  const categoryOptions = useMemo(() => {
    const values = events.flatMap((ev) => getCategories(ev));
    return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [events]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const ll = loc.trim().toLowerCase();

    const next = events.filter((ev) => {
      const blob = getSearchBlob(ev);
      const locationBlob = [ev.venue_name, ev.city, ev.state]
        .map((value) => safeStr(value).toLowerCase())
        .join(" ");
      const categories = getCategories(ev).map((item) => item.toLowerCase());

      if (ql && !blob.includes(ql)) return false;
      if (ll && !locationBlob.includes(ll)) return false;
      if (category !== "all" && !categories.includes(category.toLowerCase())) return false;
      if (acceptingOnly && !isAcceptingVendors(ev)) return false;
      return true;
    });

    return sortEvents(next, sortBy);
  }, [events, q, loc, category, acceptingOnly, sortBy]);

  const acceptingCount = useMemo(
    () => events.filter((ev) => isAcceptingVendors(ev)).length,
    [events]
  );

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-10 text-slate-700">Loading marketplace…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 md:py-14">
          <Link to="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ← Back to home
          </Link>

          <div className="mt-5 grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                <Store className="h-3.5 w-3.5" />
                Vendor marketplace
              </div>
              <h1 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
                Find events to vend at
              </h1>
              <p className="mt-4 max-w-3xl text-base md:text-lg leading-7 text-slate-600">
                Browse live festivals, markets, expos, and trade shows. Compare locations,
                dates, pricing, and booth availability before you apply.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Live listings
                </div>
                <div className="mt-2 text-3xl font-extrabold text-slate-900">{events.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Accepting vendors
                </div>
                <div className="mt-2 text-3xl font-extrabold text-slate-900">{acceptingCount}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Filter className="h-4 w-4" />
            Search and filter
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="relative block xl:col-span-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                placeholder="Search events, venues, organizers, or keywords"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>

            <label className="relative block">
              <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                placeholder="City, state, or venue"
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
              />
            </label>

            <label className="relative block">
              <Tag className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-10 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {categoryOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="relative block">
              <ListFilter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-10 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="soonest">Soonest</option>
                <option value="newest">Newest</option>
                <option value="price">Lowest booth price</option>
                <option value="spots">Most spots left</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={acceptingOnly}
                onChange={(e) => setAcceptingOnly(e.target.checked)}
              />
              Accepting vendors only
            </label>

            <div className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-900">{filtered.length}</span> of {events.length} events
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <Search className="h-6 w-6 text-slate-500" />
            </div>
            <h2 className="mt-4 text-2xl font-bold text-slate-900">No matching events</h2>
            <p className="mt-2 text-slate-600">
              Try broadening your search, changing the city filter, or turning off the
              accepting-vendors filter.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((ev) => {
              const id = String(ev.id);
              const hero = getHero(ev);
              const title = safeStr(ev.title) || "Untitled event";
              const categories = getCategories(ev).slice(0, 3);
              const price = getBoothPrice(ev);
              const boothsRemaining = getBoothsRemaining(ev);
              const accepting = isAcceptingVendors(ev);
              const organizerEmail = getOrganizerEmail(ev);
              const organizerName = getOrganizerName(ev);
              const verificationStatus =
                getInlineVerificationStatus(ev) || (organizerEmail ? verificationMap[organizerEmail] ?? null : null);

              return (
                <article
                  key={id}
                  className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <Link to={`/events/${id}`} className="block">
                    <div className="relative h-52 bg-slate-200">
                      {hero ? (
                        <img src={hero} alt={title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-700 via-violet-700 to-slate-900 px-6 text-center text-lg font-bold text-white">
                          {title}
                        </div>
                      )}

                      <div className="absolute left-4 top-4 inline-flex items-center rounded-full border border-white/25 bg-black/45 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        {accepting ? "Accepting vendors" : "View details"}
                      </div>
                    </div>
                  </Link>

                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link to={`/events/${id}`} className="text-xl font-bold text-slate-900 hover:text-indigo-700">
                          {title}
                        </Link>
                        <div className="mt-2 flex items-start gap-2 text-sm text-slate-600">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{getLocationLine(ev)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                      <CalendarDays className="h-4 w-4 shrink-0" />
                      <span>{formatDateRange(ev.start_date, ev.end_date)}</span>
                    </div>

                    {organizerEmail ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span className="font-semibold text-slate-700">Hosted by</span>
                        <Link
                          to={`/organizers/${encodeURIComponent(organizerEmail)}`}
                          className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
                        >
                          {organizerName}
                        </Link>
                        {verificationStatus === "verified" ? <VerifiedBadge /> : null}
                      </div>
                    ) : null}

                    {categories.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {categories.map((item) => (
                          <span
                            key={`${id}-${item}`}
                            className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Booths from
                        </div>
                        <div className="mt-1 text-lg font-bold text-slate-900">{formatMoney(price)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Spots left
                        </div>
                        <div className="mt-1 text-lg font-bold text-slate-900">
                          {boothsRemaining ?? "TBD"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-3">
                      <div className="text-sm text-slate-500">
                        {accepting ? "Applications open now" : "See event details"}
                      </div>

                      <Link
                        to={`/events/${id}`}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        View details
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
