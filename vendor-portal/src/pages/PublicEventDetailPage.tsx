// vendor-portal/src/pages/PublicEventDetailPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type EventModel = {
  id: number | string;

  title?: string;
  description?: string;

  venue_name?: string;
  address?: string;
  city?: string;
  state?: string;

  start_date?: string;
  end_date?: string;

  heroImageUrl?: string;
  imageUrls?: string[];
  videoUrls?: string[];

  ticketUrl?: string;
  googleMapsUrl?: string;
};

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function asArray(x: any): string[] {
  return Array.isArray(x) ? x : [];
}

function isSafeHttpUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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

function buildMapsSearchUrl(parts: string[]) {
  const q = parts.map((p) => safeStr(p)).filter(Boolean).join(" ");
  if (!q) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default function PublicEventDetailPage() {
  const { eventId } = useParams();
  const nav = useNavigate();

  const [event, setEvent] = useState<EventModel | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="min-h-screen bg-white p-10">Loading…</div>;

  if (!event) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto p-6">
          <Link to="/events" className="text-sm text-gray-600">
            ← Back to events
          </Link>
          <div className="mt-6 border rounded-2xl p-8">
            <h1 className="text-2xl font-bold">Event not found</h1>
            <p className="text-gray-600 mt-2">
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

  return (
    // ✅ dark background under hero so white cards pop
    <div className="min-h-screen bg-slate-100">
      {/* HERO */}
      <div className="relative h-[360px] md:h-[420px] overflow-hidden">
        {heroUrl ? (
          <img
            src={heroUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-purple-800 to-slate-900" />
        )}

        {/* ✅ clean overlay (NO white fade) */}
        <div className="absolute inset-0 bg-black/45" />

        <div className="relative max-w-6xl mx-auto px-6 h-full flex flex-col justify-end pb-12">
          <Link to="/events" className="text-sm text-white/85 hover:text-white">
            ← Back to events
          </Link>

          <h1 className="text-5xl md:text-6xl font-extrabold text-white mt-4 tracking-tight">
            {title}
          </h1>

          <div className="mt-4 text-white/90 text-base md:text-lg">
            {locationLine || "Location TBD"}
          </div>

          <div className="text-white/80 mt-1">{dateLine}</div>

          <div className="mt-6 flex gap-3 flex-wrap">
            {hasTicket ? (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-white text-gray-900 px-5 py-2.5 font-semibold hover:bg-gray-100 transition shadow-sm"
              >
                Purchase Tickets
              </a>
            ) : null}

            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-white/10 text-white border border-white/20 px-5 py-2.5 font-semibold hover:bg-white/15 transition"
              >
                Open in Google Maps
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {/* BODY */}
      {/* ✅ pull cards down a bit, but keep the “float” */}
      <div className="max-w-6xl mx-auto px-6 mt-12 md:mt-16 relative z-10 pb-20"><div className="grid lg:grid-cols-3 gap-8">
          {/* Flyer content */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
              <h2 className="text-2xl font-bold">Event details</h2>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500">WHEN</div>
                  <div className="mt-1 font-semibold text-slate-900">{dateLine}</div>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500">WHERE</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {locationLine || "Location TBD"}
                  </div>
                  {mapsHref ? (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-sm font-semibold text-indigo-700 hover:text-indigo-800"
                    >
                      Open in Google Maps →
                    </a>
                  ) : null}
                </div>
              </div>

              {description ? (
                <>
                  <h3 className="text-lg font-bold mt-8">About</h3>
                  <p className="mt-2 text-slate-700 leading-relaxed whitespace-pre-line">
                    {description}
                  </p>
                </>
              ) : null}
            </div>

            {gallery.length > 0 ? (
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
                <h3 className="text-xl font-bold">Gallery</h3>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                  {gallery.map((u) => (
                    <div
                      key={u}
                      className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200"
                    >
                      <img src={u} alt="Event" className="w-full h-40 object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Vendor CTA */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 h-fit lg:sticky lg:top-6">
            <div className="text-lg font-bold">Vendors</div>
            <div className="mt-2 text-sm text-slate-600">
              Booth selection and approval required before payment.
            </div>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                className="w-full rounded-xl bg-indigo-600 text-white px-5 py-3 font-semibold hover:bg-indigo-700 transition"
                onClick={() => nav(`/vendor/events/${id}/map`)}
              >
                View Floorplan
              </button>

              <button
                type="button"
                className="w-full rounded-xl bg-green-600 text-white px-5 py-3 font-semibold hover:bg-green-700 transition"
                onClick={() => nav(`/vendor/events/${id}/apply`)}
              >
                Apply for a Booth
              </button>

              <button
                type="button"
                className="w-full rounded-xl bg-slate-100 text-slate-900 px-5 py-3 font-semibold hover:bg-slate-200 transition"
                onClick={() => nav(`/vendor/events/${id}/requirements`)}
              >
                View Requirements
              </button>
            </div>

            <div className="mt-6 text-xs text-slate-500">
              Tip: Start with the floorplan to confirm availability before applying.
            </div>
          </div>
        </div>
      </div>

      {/* ✅ optional footer spacing */}
      <div className="h-10" />
    </div>
  );
}
