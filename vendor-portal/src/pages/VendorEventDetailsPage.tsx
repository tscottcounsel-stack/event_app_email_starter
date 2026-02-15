import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

type VendorApplication = {
  id: string;
  eventId: string;
  status: "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | string;
  updatedAt?: string;
  createdAt?: string;
};

type VendorAppsIndexItem = {
  eventId: string;
  appId: string;
  status: "draft" | "submitted";
  updatedAt: string;
};

type EventCard = {
  id: string;
  title: string;
  start: string;
  end: string;
};

const LS_APPS_KEY = "vendor_applications_v1";
const LS_APPS_INDEX_KEY = "vendor_apps_index_v1";

/** Figma-ish button styles */
const BTN_PRIMARY =
  "rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2 text-sm font-extrabold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition";
const BTN_PRIMARY_DARK =
  "rounded-full bg-slate-900 px-6 py-2 text-sm font-extrabold text-white shadow-sm hover:bg-slate-800 active:scale-[0.99] transition";
const BTN_SECONDARY =
  "rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50 active:scale-[0.99] transition";

const PILL_SUBMITTED = "bg-indigo-50 text-indigo-700 ring-indigo-200";
const PILL_DRAFT = "bg-slate-100 text-slate-700 ring-slate-200";

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadApps(): VendorApplication[] {
  const arr = safeJsonParse<VendorApplication[]>(localStorage.getItem(LS_APPS_KEY));
  return Array.isArray(arr) ? arr : [];
}

function saveApps(apps: VendorApplication[]) {
  localStorage.setItem(LS_APPS_KEY, JSON.stringify(apps));
}

function loadIndex(): VendorAppsIndexItem[] {
  const arr = safeJsonParse<VendorAppsIndexItem[]>(localStorage.getItem(LS_APPS_INDEX_KEY));
  return Array.isArray(arr) ? arr : [];
}

function saveIndex(items: VendorAppsIndexItem[]) {
  localStorage.setItem(LS_APPS_INDEX_KEY, JSON.stringify(items));
}

function ensureIndexFromLegacyApps() {
  const existing = localStorage.getItem(LS_APPS_INDEX_KEY);
  if (existing) return;

  const apps = loadApps();
  const now = new Date().toISOString();

  const migrated: VendorAppsIndexItem[] = apps.map((a) => ({
    eventId: String(a.eventId),
    appId: a.id,
    status: String(a.status).toLowerCase() === "submitted" ? "submitted" : "draft",
    updatedAt: a.updatedAt || a.createdAt || now,
  }));

  saveIndex(migrated);
}

function uid(prefix = "app") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export default function VendorEventDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId(params.eventId), [params.eventId]);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const appIdFromUrl = useMemo(() => normalizeId(searchParams.get("appId") || ""), [searchParams]);

  const [apps, setApps] = useState<VendorApplication[]>(() => loadApps());
  const [index, setIndex] = useState<VendorAppsIndexItem[]>(() => loadIndex());

  useEffect(() => {
    ensureIndexFromLegacyApps();
    setIndex(loadIndex());

    const refresh = () => {
      setApps(loadApps());
      setIndex(loadIndex());
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_APPS_KEY || e.key === LS_APPS_INDEX_KEY) refresh();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const events = useMemo<EventCard[]>(
    () => [
      { id: "1", title: "Contemporary Art & Crafts Expo", start: "5/9/2026", end: "5/11/2026" },
      { id: "2", title: "Tech Innovation Summit 2026", start: "3/14/2026", end: "3/14/2026" },
      { id: "3", title: "Culinary Arts & Food Festival", start: "4/19/2026", end: "4/21/2026" },
      { id: "4", title: "Summer Music & Entertainment Festival", start: "7/14/2026", end: "7/16/2026" },
    ],
    []
  );

  const ev = useMemo(() => events.find((e) => normalizeId(e.id) === eventId) || null, [events, eventId]);

  // Most recent index record for this event (preferred)
  const idxRec = useMemo(() => {
    if (!eventId) return null;
    const matches = index.filter((x) => normalizeId(x.eventId) === eventId);
    if (matches.length === 0) return null;
    return matches
      .slice()
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0))[0];
  }, [index, eventId]);

  // Legacy app object (if present)
  const legacyApp = useMemo(() => {
    if (!eventId) return null;
    return apps.find((a) => normalizeId(a.eventId) === eventId) || null;
  }, [apps, eventId]);

  const activeAppId = useMemo(() => {
    // URL wins (deep-linking)
    if (appIdFromUrl) return appIdFromUrl;
    // else use most recent index appId
    if (idxRec?.appId) return normalizeId(idxRec.appId);
    // else use legacy app id
    if (legacyApp?.id) return normalizeId(legacyApp.id);
    return "";
  }, [appIdFromUrl, idxRec, legacyApp]);

  const derivedStatus = useMemo(() => {
    if (idxRec) return idxRec.status === "submitted" ? "Submitted" : "Draft";
    if (legacyApp?.status) return legacyApp.status;
    return null;
  }, [idxRec, legacyApp]);

  const isDraft = derivedStatus === "Draft";
  const isSubmitted = derivedStatus === "Submitted";

  function createDraftIfNeeded(): string {
    if (activeAppId) return activeAppId;

    const now = new Date().toISOString();
    const created: VendorApplication = {
      id: uid("app"),
      eventId: eventId,
      status: "Draft",
      createdAt: now,
      updatedAt: now,
    };

    const nextApps = [created, ...apps.filter((a) => normalizeId(a.eventId) !== eventId)];
    saveApps(nextApps);
    setApps(nextApps);

    const nextIndex: VendorAppsIndexItem = {
      eventId,
      appId: created.id,
      status: "draft",
      updatedAt: now,
    };
    const merged = [nextIndex, ...index.filter((x) => !(normalizeId(x.eventId) === eventId && normalizeId(x.appId) === normalizeId(created.id)))];
    saveIndex(merged);
    setIndex(merged);

    return created.id;
  }

  function goToRequirements() {
    const appId = createDraftIfNeeded();
    navigate(
      `/vendor/events/${encodeURIComponent(eventId)}/requirements?appId=${encodeURIComponent(appId)}`
    );
  }

  function goToLayout() {
    const appId = createDraftIfNeeded();
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map?appId=${encodeURIComponent(appId)}`);
  }

  function goToApplication() {
    const appId = createDraftIfNeeded();
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/apply?appId=${encodeURIComponent(appId)}`);
  }

  function goToMyApplications() {
    const qs = new URLSearchParams();
    if (eventId) qs.set("eventId", eventId);
    if (activeAppId) qs.set("appId", activeAppId);
    const q = qs.toString();
    navigate(`/vendor/applications${q ? `?${q}` : ""}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate("/vendor/events")} className={BTN_SECONDARY}>
          ← Back to Events
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-extrabold text-slate-900">Event Details</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{ev?.title || `Event #${eventId}`}</div>
            <div className="mt-1 text-sm font-medium text-slate-600">{ev ? `${ev.start} - ${ev.end}` : "Dates TBD"}</div>
          </div>

          {derivedStatus ? (
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ring-1 ${
                isSubmitted ? PILL_SUBMITTED : PILL_DRAFT
              }`}
            >
              Status: {derivedStatus}
            </span>
          ) : null}
        </div>

        {/* Actions: Continue / Layout / Application / My Applications */}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={goToRequirements} className={BTN_PRIMARY_DARK}>
            Continue
          </button>

          <button type="button" onClick={goToLayout} className={BTN_SECONDARY}>
            Layout
          </button>

          <button type="button" onClick={goToApplication} className={BTN_SECONDARY}>
            Application
          </button>

          <button type="button" onClick={goToMyApplications} className={BTN_SECONDARY}>
            My Applications
          </button>
        </div>

        {isSubmitted ? (
          <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-800">
            Application submitted — you can view it anytime.
          </div>
        ) : isDraft ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-800">
            You have a saved draft for this event.
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-800">
            No application started yet. Click Continue to begin.
          </div>
        )}

        {/* Tiny debug (keep/remove as needed) */}
        <div className="mt-4 text-xs text-slate-400">
          Debug: eventId={eventId || "—"} • appId={activeAppId || "—"}
        </div>
      </div>
    </div>
  );
}
