// src/pages/VendorAvailableEventsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type VendorEvent = {
  id: number | string;

  title?: string;
  name?: string;

  status?: string;

  venue_name?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;

  start_date?: string | null;
  end_date?: string | null;

  published?: boolean;
  archived?: boolean;

  heroImageUrl?: string | null;
  imageUrls?: string[] | null;

  category?: string | null;
  industry?: string | null;
  event_type?: string | null;
  type?: string | null;

  basePrice?: number | null;
  boothPrice?: number | null;
  minBoothPrice?: number | null;
  startingPrice?: number | null;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function pickList(data: any): VendorEvent[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function prettyStatus(s?: string) {
  const v = String(s || "").toLowerCase();
  if (!v) return null;
  if (v.includes("draft")) return "Draft";
  if (v.includes("submit")) return "Submitted";
  if (v.includes("approve")) return "Approved";
  if (v.includes("reject")) return "Rejected";
  if (v.includes("publish")) return "Published";
  if (v.includes("archive")) return "Archived";
  return s || null;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
}

function fmtDateRange(start?: string | null, end?: string | null) {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (!s && !e) return "";
  if (s && e) return `${s}`;
  return s || e;
}

function pickCategory(ev: VendorEvent) {
  const v = ev.category || ev.industry || ev.event_type || ev.type || "";
  const out = String(v || "").trim();
  return out || null;
}

function pickImage(ev: VendorEvent) {
  const hero = String(ev.heroImageUrl || "").trim();
  if (hero) return hero;

  const arr = Array.isArray(ev.imageUrls) ? ev.imageUrls : [];
  const first = String(arr[0] || "").trim();
  if (first) return first;

  return null;
}

function pickStartingPrice(ev: VendorEvent) {
  const candidates = [
    ev.startingPrice,
    ev.minBoothPrice,
    ev.basePrice,
    ev.boothPrice,
    (ev as any).starting_price,
    (ev as any).min_booth_price,
    (ev as any).base_price,
    (ev as any).booth_price,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (!Number.isFinite(n)) continue;
    if (n <= 0) continue;
    return n;
  }
  return null;
}

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return await res.json();
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M7 3v2M17 3v2M4 8h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M12 22s7-4.5 7-12a7 7 0 1 0-14 0c0 7.5 7 12 7 12Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function VendorAvailableEventsPage() {
  const navigate = useNavigate();
  const didLoadRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<VendorEvent[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      let data: any;
      try {
        data = await getJson("/vendor/events");
      } catch {
        data = await getJson("/public/events");
      }

      setEvents(pickList(data));
    } catch (e: any) {
      setError(e?.message || "Unable to load events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => {
    return (events || []).map((ev) => {
      const id = normalizeId(ev.id);
      const title = ev.title || ev.name || `Event ${id}`;

      const status =
        prettyStatus(ev.status) || (ev.archived ? "Archived" : ev.published ? "Published" : null);

      const category = pickCategory(ev);
      const locationLine = [ev.venue_name, ev.city, ev.state].filter(Boolean).join(", ").trim();
      const dateLine = fmtDateRange(ev.start_date, ev.end_date);

      const image = pickImage(ev);
      const startingPrice = pickStartingPrice(ev);

      return { id, title, status, category, locationLine, dateLine, image, startingPrice };
    });
  }, [events]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-3xl font-black text-slate-900">Available Events</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Browse events and continue your application.
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-100 disabled:opacity-60"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* Body */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {error}
              <div className="mt-2 text-xs text-rose-700">
                Backend should be reachable at <span className="font-mono">127.0.0.1:8002</span>.
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
              Loading…
            </div>
          ) : null}

          {!loading && cards.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No events are available yet.
            </div>
          ) : null}

          {/* Cards (denser + smaller) */}
          <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vendor/events/${encodeURIComponent(c.id)}`)}
                onKeyDown={(e)=>{ if(e.key==="Enter") navigate(`/vendor/events/${encodeURIComponent(c.id)}`); }}
                className="group w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
              >
                {/* Image: normalized via 16:9 aspect */}
                <div className="relative w-full bg-slate-100 aspect-[16/9]">
                  {c.image ? (
                    <img
                      src={c.image}
                      alt={c.title}
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-100 via-white to-purple-100">
                      <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-2 text-xs font-black text-slate-700">
                        No image yet
                      </div>
                    </div>
                  )}

                  {/* Polished overlay */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />

                  {/* Optional status badge */}
                  {c.status ? (
                    <div className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-slate-800 shadow-sm">
                      {c.status}
                    </div>
                  ) : null}
                </div>

                {/* Content (smaller) */}
                <div className="p-5">
                  {c.category ? (
                    <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                      {c.category}
                    </div>
                  ) : null}

                  <div className={c.category ? "mt-3" : ""}>
                    <div className="text-lg font-black text-slate-900">{c.title}</div>

                    {c.dateLine ? (
                      <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <span className="text-slate-500">
                          <IconCalendar />
                        </span>
                        <span>{c.dateLine}</span>
                      </div>
                    ) : null}

                    {c.locationLine ? (
                      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <span className="text-slate-500">
                          <IconPin />
                        </span>
                        <span className="truncate">{c.locationLine}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 h-px w-full bg-slate-100" />

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-emerald-700">
                      {typeof c.startingPrice === "number" ? (
                        <>
                          ${Math.round(c.startingPrice)}+{" "}
                          <span className="font-extrabold text-slate-600">per booth</span>
                        </>
                      ) : (
                        <span className="text-slate-500"> </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/vendor/events/${encodeURIComponent(c.id)}`);
                      }}
                      className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-black text-white hover:opacity-95"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-xs font-semibold text-slate-400">
            Tip: For real card images, store <span className="font-mono">heroImageUrl</span> or{" "}
            <span className="font-mono">imageUrls[0]</span>.
          </div>
        </div>
      </div>
    </div>
  );
}
