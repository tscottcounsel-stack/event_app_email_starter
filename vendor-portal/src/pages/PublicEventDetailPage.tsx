// src/pages/PublicEventDetailPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { API_BASE, apiGet, getAccessToken } from "../api";

type PublicEvent = {
  id: number;
  title?: string;
  date?: string; // ISO-ish
  location?: string;
  city?: string;
  description?: string;

  // future-friendly fields (may not exist yet)
  address?: string;
  state?: string;
  zip?: string;
  ticket_url?: string;
  event_url?: string;
  expected_attendance?: number;
  setup_time?: string;
  additional_notes?: string;
};

type PublicDiagram = {
  event_id: number;
  version?: number;
  grid_px?: number;
  slots: Array<{
    id?: number;
    label?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    status?: string; // available|pending|booked etc
    kind?: string;
    price_cents?: number;
    category_id?: number | null;
    category_name?: string | null;
  }>;
};

function safeDate(value?: string) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function dollars(cents?: number) {
  const n = Number(cents ?? 0);
  return (n / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function isVendorLoggedIn(): boolean {
  // We only have one token helper; role-specific check may exist elsewhere.
  // For now: if you have any token, treat as logged in and let server enforce role.
  return Boolean(getAccessToken());
}

export default function PublicEventDetailPage() {
  const nav = useNavigate();
  const { eventId: eventIdParam } = useParams();
  const eventId = Number(eventIdParam || "");

  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [diagram, setDiagram] = useState<PublicDiagram | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingDiagram, setLoadingDiagram] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [diagramError, setDiagramError] = useState<string | null>(null);

  const isValidId = useMemo(() => Number.isFinite(eventId) && eventId > 0, [eventId]);

  const vendorLoggedIn = useMemo(() => isVendorLoggedIn(), []);

  const computed = useMemo(() => {
    const slots = diagram?.slots || [];
    const priced = slots
      .map((s) => Number(s.price_cents ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);

    const min = priced.length ? Math.min(...priced) : null;
    const max = priced.length ? Math.max(...priced) : null;

    const availableCount = slots.filter((s) => (s.status || "").toLowerCase() === "available").length;

    return {
      slotsCount: slots.length,
      availableCount,
      priceMinCents: min,
      priceMaxCents: max,
    };
  }, [diagram]);

  async function loadEvent() {
    if (!isValidId) {
      setError("Invalid event id.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Public events list -> filter
      const res: any = await apiGet<any>("/public/events?limit=200");
      const items: PublicEvent[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.events)
        ? res.events
        : [];

      const found = items.find((x) => Number(x.id) === eventId) ?? null;
      setEvent(found);

      if (!found) setError("Event not found.");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load event.");
    } finally {
      setLoading(false);
    }
  }

  async function tryLoadDiagram() {
    if (!isValidId) {
      setLoadingDiagram(false);
      return;
    }

    try {
      setLoadingDiagram(true);
      setDiagramError(null);

      // Your system has used /public/events/:id/diagram in a few forms over time.
      // We'll try a couple common ones and accept the first that works.
      const candidates = [
        `/public/events/${eventId}/diagram`,
        `/public/events/${eventId}/diagram.json`,
        `/public/events/${eventId}/diagram_json`,
      ];

      let lastErr: any = null;

      for (const path of candidates) {
        try {
          const d = await apiGet<PublicDiagram>(path);
          if (d && (d as any).slots) {
            setDiagram(d);
            return;
          }
        } catch (e: any) {
          lastErr = e;
        }
      }

      setDiagram(null);
      setDiagramError(lastErr?.message || "Diagram not available yet.");
    } finally {
      setLoadingDiagram(false);
    }
  }

  useEffect(() => {
    void loadEvent();
    void tryLoadDiagram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIdParam]);

  const ticketUrl = (event as any)?.ticket_url || "";
  const googleMapsQuery = encodeURIComponent(
    [
      (event as any)?.location || "",
      (event as any)?.address || "",
      (event as any)?.city || "",
      (event as any)?.state || "",
      (event as any)?.zip || "",
    ]
      .filter(Boolean)
      .join(" ")
  );
  const googleMapsUrl = googleMapsQuery ? `https://www.google.com/maps/search/?api=1&query=${googleMapsQuery}` : "";

  function goApply() {
    if (!vendorLoggedIn) {
      nav("/vendor/login", { replace: false });
      return;
    }
    nav(`/vendor/events/${eventId}/apply`);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
          ← Back to Events
        </Link>

        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            onClick={() => {
              void loadEvent();
              void tryLoadDiagram();
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* HERO */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight">{event?.title || (loading ? "Loading…" : "Event")}</h1>

            <div className="mt-2 text-sm text-slate-600">
              {safeDate(event?.date) ? `${safeDate(event?.date)} • ` : ""}
              {(event as any)?.location || "Location TBD"}
              {(event as any)?.city ? ` • ${(event as any)?.city}` : ""}
            </div>

            {event?.description ? (
              <p className="mt-4 text-sm leading-6 text-slate-700">{event.description}</p>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Vendors: reserve your booth spot early. View the booth layout and apply in minutes.
              </p>
            )}

            {/* quick stats */}
            <div className="mt-5 flex flex-wrap gap-2">
              <Pill>
                Booths: <span className="font-semibold">{computed.slotsCount || "—"}</span>
              </Pill>
              <Pill>
                Available: <span className="font-semibold">{computed.availableCount || "—"}</span>
              </Pill>
              <Pill>
                Price range:{" "}
                <span className="font-semibold">
                  {computed.priceMinCents != null && computed.priceMaxCents != null
                    ? `$${dollars(computed.priceMinCents)} – $${dollars(computed.priceMaxCents)}`
                    : "TBD"}
                </span>
              </Pill>
            </div>
          </div>

          {/* CTA column */}
          <div className="w-full max-w-sm space-y-3">
            <button
              className="w-full rounded-full bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={goApply}
              disabled={!isValidId || loading}
            >
              Apply for a Booth
            </button>

            <Link
              to={`/vendor/events/${eventId}/diagram`}
              className="block w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-center text-sm hover:bg-slate-50"
            >
              View Booth Layout
            </Link>

            {ticketUrl ? (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noreferrer"
                className="block w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-center text-sm hover:bg-slate-50"
              >
                Ticket Sales
              </a>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                Ticket sales link will appear here once the organizer publishes it.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CONTENT GRID */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left (2 columns) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Location */}
          <Card title="Location & Logistics" subtitle="Where to show up, when to load-in, and how to prepare.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoRow label="Venue" value={(event as any)?.location || "TBD"} />
              <InfoRow label="City" value={(event as any)?.city || "TBD"} />

              <InfoRow label="Address" value={(event as any)?.address || "TBD"} />
              <InfoRow label="State / ZIP" value={`${(event as any)?.state || ""} ${(event as any)?.zip || ""}`.trim() || "TBD"} />

              <InfoRow label="Setup Time" value={(event as any)?.setup_time || "TBD"} />
              <InfoRow label="Event Date" value={safeDate(event?.date) || "TBD"} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {googleMapsUrl && (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Open in Google Maps
                </a>
              )}

              <a
                href={`${API_BASE}/public/events/${eventId}/diagram`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              >
                View Public Diagram (JSON)
              </a>
            </div>

            {(event as any)?.additional_notes && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="text-xs font-semibold uppercase text-slate-600">Additional Notes</div>
                <div className="mt-2 whitespace-pre-wrap">{String((event as any).additional_notes)}</div>
              </div>
            )}
          </Card>

          {/* Booth + pricing summary */}
          <Card title="Booths & Pricing" subtitle="Pick a booth category and reserve your spot.">
            {loadingDiagram ? (
              <div className="text-sm text-slate-500">Loading booth layout…</div>
            ) : diagram ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniStat label="Total booths" value={computed.slotsCount || "—"} />
                  <MiniStat label="Available" value={computed.availableCount || "—"} />
                  <MiniStat
                    label="Price range"
                    value={
                      computed.priceMinCents != null && computed.priceMaxCents != null
                        ? `$${dollars(computed.priceMinCents)} – $${dollars(computed.priceMaxCents)}`
                        : "TBD"
                    }
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/vendor/events/${eventId}/diagram`}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                  >
                    View Layout
                  </Link>

                  <button
                    onClick={goApply}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Apply Now
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Booth layout isn’t published yet. Check back soon.
                {diagramError ? <div className="mt-1 text-xs text-slate-500">{diagramError}</div> : null}
              </div>
            )}
          </Card>

          {/* Vendor requirements (future-ready UI) */}
          <Card
            title="Vendor Requirements"
            subtitle="These help organizers keep events safe, compliant, and high quality."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CheckRow label="Business license or permit (if applicable)" checked={false} note="Organizer will confirm during approval." />
              <CheckRow label="Insurance / liability coverage (if required)" checked={false} note="Upload proof in your vendor profile when enabled." />
              <CheckRow label="Food handling / health permits (food vendors)" checked={false} note="Required for food & beverage vendors in many cities." />
              <CheckRow label="Power needs / special setup" checked={false} note="Add requests in your application notes." />
            </div>
            <div className="mt-3 text-xs text-slate-500">
              (These are placeholders — we’ll wire them to real checkboxes once the event requirements model is finalized.)
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Card title="Ticket Sales" subtitle="Drive traffic and validate demand.">
            {ticketUrl ? (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              >
                Open ticket page
              </a>
            ) : (
              <div className="text-sm text-slate-600">
                Ticket link not published yet.
                <div className="mt-1 text-xs text-slate-500">
                  Once the organizer adds it, it will appear here automatically.
                </div>
              </div>
            )}
          </Card>

          <Card title="Organizer" subtitle="Who’s hosting this event.">
            <div className="text-sm text-slate-700">
              <div className="font-semibold">Organizer</div>
              <div className="mt-1 text-slate-600">Profile details will appear here (verified badge, story, photos).</div>

              <div className="mt-4 flex gap-2">
                <Link
                  to="/organizer/login"
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Organizer Login
                </Link>

                <Link
                  to="/vendor/login"
                  className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Vendor Login
                </Link>
              </div>
            </div>
          </Card>

          <Card title="Ready to Apply?" subtitle="Reserve your booth and get approved.">
            <button
              className="w-full rounded-full bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={goApply}
              disabled={!isValidId || loading}
            >
              Apply for a Booth
            </button>
            <div className="mt-3 text-xs text-slate-500">
              Vendors are approved by the organizer. Some categories may have limited availability.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** UI helpers */
function Pill(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
      {props.children}
    </span>
  );
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-base font-semibold">{props.title}</div>
      {props.subtitle ? <div className="mt-1 text-sm text-slate-600">{props.subtitle}</div> : null}
      <div className="mt-4">{props.children}</div>
    </div>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase text-slate-600">{props.label}</div>
      <div className="mt-1 text-sm text-slate-800">{props.value || "—"}</div>
    </div>
  );
}

function MiniStat(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase text-slate-600">{props.label}</div>
      <div className="mt-1 text-lg font-semibold">{props.value}</div>
    </div>
  );
}

function CheckRow(props: { label: string; checked: boolean; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 h-4 w-4 rounded border border-slate-300 bg-white" />
        <div>
          <div className="text-sm font-medium text-slate-800">{props.label}</div>
          {props.note ? <div className="mt-1 text-xs text-slate-500">{props.note}</div> : null}
        </div>
      </div>
    </div>
  );
}
