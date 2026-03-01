// VendorEventDetailsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { listVendorApplications } from "../components/api/applications";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorEvent = any;

type ServerApplication = {
  id: number;
  event_id: number;
  status?: string;
  payment_status?: string;
  submitted_at?: string;
  updated_at?: string;
  [k: string]: any;
};

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function coerceNumericAppId(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  // legacy: app_71_1771975163 -> 71
  const m = s.match(/^app_(\d+)_/i) || s.match(/^app(\d+)_/i) || s.match(/^app(\d+)$/i);
  if (m?.[1]) return m[1];
  return s;
}

async function fetchPublicEventById(eventId: string): Promise<VendorEvent | null> {
  const eid = String(eventId || "").trim();
  if (!eid) return null;

  // Preferred: dedicated detail endpoint (if published).
  try {
    const r = await fetch(`${API_BASE}/public/events/${encodeURIComponent(eid)}`);
    if (r.ok) return await r.json();
  } catch {
    // ignore, fallback to list
  }

  // Fallback: list and find (handles older servers that only had /public/events)
  const r2 = await fetch(`${API_BASE}/public/events`);
  if (!r2.ok) throw new Error("Failed to load public events.");
  const all = await r2.json();
  const arr = Array.isArray(all) ? all : [];
  return (arr.find((x: any) => String(x?.id) === String(eid)) as any) || null;
}

export default function VendorEventDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId(params.eventId), [params.eventId]);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const rawAppIdFromUrl = useMemo(() => normalizeId(searchParams.get("appId") || ""), [searchParams]);
  const appIdFromUrl = useMemo(() => coerceNumericAppId(rawAppIdFromUrl), [rawAppIdFromUrl]);

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
        const found = await fetchPublicEventById(eventId);
        if (cancelled) return;
        setEv(found || null);
        if (!found) setEventErr("Event not found (it may not be published yet).");
      } catch (e: any) {
        if (!cancelled) setEventErr(e?.message || "Failed to load event.");
      } finally {
        if (!cancelled) setLoadingEvent(false);
      }
    }

    async function loadApps() {
      setLoadingApps(true);
      setAppsErr(null);

      try {
        const res = await listVendorApplications();
        if (cancelled) return;
        setApps(Array.isArray(res) ? res : []);
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

    // If the URL specifies an application, prefer that one.
    if (appIdFromUrl) {
      const byId = eventApps.find((a) => String(a.id) === String(appIdFromUrl));
      if (byId) return byId;

      // Also support legacy app refs (e.g., app_71_...) when they leak into the URL.
      const byRef = eventApps.find(
        (a) =>
          String((a as any).ref || (a as any).app_ref || (a as any).application_ref || "") === String(rawAppIdFromUrl)
      );
      if (byRef) return byRef;
    }

    return eventApps
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.updated_at || a.submitted_at || 0).getTime();
        const tb = new Date(b.updated_at || b.submitted_at || 0).getTime();
        return tb - ta;
      })[0];
  }, [eventApps, appIdFromUrl, rawAppIdFromUrl]);

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
    const appId = latestApp ? String((latestApp as any).id ?? "") : appIdFromUrl;
    if (appId) qs.set("appId", appId);
    const q = qs.toString();
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map${q ? `?${q}` : ""}`);
  }

  const appStatus = String((latestApp as any)?.status || "");
  const paymentStatus = String((latestApp as any)?.payment_status || (latestApp as any)?.paymentStatus || "");
  const isApproved = appStatus.toLowerCase() === "approved";
  const isPaid = paymentStatus.toLowerCase() === "paid";
  const shouldPay = Boolean(latestApp && isApproved && !isPaid);

  function goToRequirements() {
    const qs = new URLSearchParams();
    const appId = latestApp ? String((latestApp as any).id ?? "") : appIdFromUrl;
    if (appId) qs.set("appId", appId);
    const q = qs.toString();
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/requirements${q ? `?${q}` : ""}`);
  }

  function primaryCta() {
    if (shouldPay) return goToRequirements;
    return goToMap;
  }

  function primaryCtaLabel() {
    if (shouldPay) return "Pay Now";
    return "Apply Now";
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-4xl font-black text-slate-900">{title}</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              {locationLine} • {ev?.start_date || "Dates TBD"}
              {ev?.end_date ? ` - ${ev.end_date}` : ""}
            </div>
            {addressLine ? <div className="mt-1 text-sm font-semibold text-slate-500">{addressLine}</div> : null}
          </div>

          <div className="flex items-center gap-2">{statusPill}</div>
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
            onClick={primaryCta()}
            className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2 text-sm font-extrabold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition"
          >
            {primaryCtaLabel()}
          </button>

          <button
            type="button"
            onClick={goToRequirements}
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
