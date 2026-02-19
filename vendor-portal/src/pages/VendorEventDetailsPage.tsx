// src/pages/VendorEventDetailsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  listVendorApplications,
  type ServerApplication,
  type ListVendorApplicationsResponse,
} from "../components/api/applications";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorEvent = {
  id: number | string;
  title?: string | null;
  name?: string | null;
  description?: string | null;

  start_date?: string | null;
  end_date?: string | null;

  venue_name?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;

  published?: boolean;
  archived?: boolean;
};

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function fmtDateRange(start?: string | null, end?: string | null) {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (!s && !e) return "Dates TBD";
  if (s && e) return `${s} - ${e}`;
  return s || e;
}

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return await res.json();
}

function pickList(data: any): VendorEvent[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function unwrapApps(payload: any): ServerApplication[] {
  // supports:
  // - { applications: [...] }
  // - { data: { applications: [...] } }
  // - [...]  (defensive)
  if (Array.isArray(payload)) return payload as ServerApplication[];
  if (Array.isArray(payload?.applications)) return payload.applications as ServerApplication[];
  if (Array.isArray(payload?.data?.applications)) return payload.data.applications as ServerApplication[];
  return [];
}

export default function VendorEventDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId(params.eventId), [params.eventId]);

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const appIdFromUrl = useMemo(
    () => normalizeId(searchParams.get("appId") || ""),
    [searchParams]
  );

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [eventErr, setEventErr] = useState<string | null>(null);
  const [ev, setEv] = useState<VendorEvent | null>(null);

  const [loadingApps, setLoadingApps] = useState(true);
  const [appsErr, setAppsErr] = useState<string | null>(null);
  const [apps, setApps] = useState<ServerApplication[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadEvent() {
      setLoadingEvent(true);
      setEventErr(null);

      try {
        // Most likely: vendor list endpoint, then find by id
        const candidates = ["/vendor/events", "/public/events", "/events"];
        let found: VendorEvent | null = null;

        for (const p of candidates) {
          try {
            const data = await getJson(p);
            const list = pickList(data);
            const match = list.find((x) => normalizeId(x?.id) === eventId);
            if (match) {
              found = match;
              break;
            }
          } catch {
            // next
          }
        }

        if (!found) throw new Error("Event not found from vendor/public endpoints.");

        if (!cancelled) setEv(found);
      } catch (e: any) {
        if (!cancelled) {
          setEv(null);
          setEventErr(e?.message || "Failed to load event details.");
        }
      } finally {
        if (!cancelled) setLoadingEvent(false);
      }
    }

    async function loadApps() {
      setLoadingApps(true);
      setAppsErr(null);
      try {
        // ✅ listVendorApplications returns { applications: [...] }
        const resp = (await listVendorApplications()) as unknown as
          | ListVendorApplicationsResponse
          | ServerApplication[]
          | any;

        const arr = unwrapApps(resp);
        if (!cancelled) setApps(arr);
      } catch (e: any) {
        if (!cancelled) {
          setApps([]);
          setAppsErr(e?.message || "Failed to load applications.");
        }
      } finally {
        if (!cancelled) setLoadingApps(false);
      }
    }

    loadEvent();
    loadApps();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const eventApps = useMemo(() => {
    return apps.filter((a) => String(a.event_id) === String(eventId));
  }, [apps, eventId]);

  const latestApp = useMemo(() => {
    if (eventApps.length === 0) return null;
    return eventApps
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.updated_at || a.submitted_at || 0).getTime();
        const tb = new Date(b.updated_at || b.submitted_at || 0).getTime();
        return tb - ta;
      })[0];
  }, [eventApps]);

  const statusPill = useMemo(() => {
    const s = String(latestApp?.status || "").toLowerCase();
    if (!s) return null;

    const cls =
      s === "approved"
        ? "bg-emerald-50 text-emerald-700"
        : s === "rejected"
        ? "bg-rose-50 text-rose-700"
        : "bg-amber-50 text-amber-800";

    const label = s === "approved" ? "Approved" : s === "rejected" ? "Rejected" : "Pending";
    return (
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${cls}`}>
        Status: {label}
      </span>
    );
  }, [latestApp]);

  const title = ev?.title || ev?.name || (loadingEvent ? "Loading…" : `Event #${eventId}`);

  const locationLine = useMemo(() => {
    const parts = [ev?.venue_name, ev?.city, ev?.state].filter(Boolean);
    return parts.length ? parts.join(" • ") : "Location TBD";
  }, [ev]);

  const addressLine = useMemo(() => {
    const parts = [ev?.street_address, ev?.zip_code].filter(Boolean);
    return parts.length ? parts.join(" • ") : "";
  }, [ev]);

  function goToMap() {
    const qs = new URLSearchParams();
    if (appIdFromUrl) qs.set("appId", appIdFromUrl);
    const q = qs.toString();
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map${q ? `?${q}` : ""}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/vendor/events")}
          className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition"
        >
          ← Back to Events
        </button>

        <button
          type="button"
          onClick={() => navigate("/vendor/dashboard")}
          className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition"
        >
          My Dashboard
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold text-slate-900">{title}</div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-700">
              <span>📅 {fmtDateRange(ev?.start_date, ev?.end_date)}</span>
              <span>📍 {locationLine}</span>
              {addressLine ? <span>🏠 {addressLine}</span> : null}
            </div>
          </div>

          {statusPill}
        </div>

        {eventErr ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {eventErr}
          </div>
        ) : null}

        {appsErr ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            {appsErr}
          </div>
        ) : null}

        <div className="mt-6 text-sm font-semibold text-slate-700 whitespace-pre-wrap">
          {loadingEvent ? "Loading description…" : ev?.description || "No description provided."}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={goToMap}
            className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2 text-sm font-extrabold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition"
          >
            Apply Now
          </button>

          <button
            type="button"
            onClick={() =>
              navigate(
                `/vendor/events/${encodeURIComponent(eventId)}/requirements${
                  appIdFromUrl ? `?appId=${encodeURIComponent(appIdFromUrl)}` : ""
                }`
              )
            }
            className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition"
          >
            View Requirements
          </button>

          <button
            type="button"
            onClick={() => navigate("/vendor/applications")}
            className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition"
          >
            My Applications
          </button>

          {loadingEvent || loadingApps ? (
            <span className="ml-auto text-xs font-semibold text-slate-500">Syncing…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
