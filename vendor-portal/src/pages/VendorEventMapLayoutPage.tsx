// src/pages/VendorEventMapLayoutPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  listVendorApplications,
  submitApplication,
  type ServerApplication,
} from "../components/api/applications";

/* ---------------- Vendor Requirements Progress (localStorage) ---------------- */

type UploadMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type VendorReqProgress = {
  eventId: string;
  appId?: string;
  checked: Record<string, boolean>;
  uploads: Record<string, UploadMeta[]>;
  updatedAt: string;
};

const LS_VENDOR_PROGRESS_KEY = "vendor_requirements_progress_v1";
const LS_VENDOR_PROFILE_KEY = "vendor_profile_v1";

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Pull a best-effort vendor profile snapshot from localStorage.
 * This is what the organizer read-only vendor profile page will display.
 */
function loadVendorProfileSnapshot(): Record<string, any> {
  const raw = localStorage.getItem(LS_VENDOR_PROFILE_KEY);
  const parsed = safeJsonParse<any>(raw);
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

/**
 * IMPORTANT:
 * Map page often has NO appId in the URL.
 * If appId is missing, match by eventId only and pick the most recent entry.
 */
function loadVendorProgress(eventId: string, appId?: string): VendorReqProgress | null {
  const all = safeJsonParse<VendorReqProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS_KEY));
  if (!Array.isArray(all) || all.length === 0) return null;

  const eId = normalizeId(eventId);
  const aId = normalizeId(appId || "");

  const candidates = all.filter((p) => normalizeId(p.eventId) === eId);
  if (candidates.length === 0) return null;

  // If appId was provided, prefer exact match.
  if (aId) {
    const exact = candidates.find((p) => normalizeId(p.appId || "") === aId);
    if (exact) return exact;
    // fall through to "most recent" if no exact hit
  }

  // Prefer entries that were saved without an appId, but still choose newest overall.
  const noAppId = candidates.filter((p) => !normalizeId(p.appId || ""));
  const pool = noAppId.length > 0 ? noAppId : candidates;

  // Choose most recent by updatedAt (string ISO compare works for ISO timestamps)
  pool.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return pool[0] ?? null;
}

function summarizeUploads(uploads: Record<string, UploadMeta[]>) {
  const docIds = Object.keys(uploads || {});
  const docsWithFiles = docIds.filter((k) => Array.isArray(uploads[k]) && uploads[k].length > 0);
  const totalFiles = docIds.reduce(
    (acc, k) => acc + (Array.isArray(uploads[k]) ? uploads[k].length : 0),
    0
  );
  return { docsWithFiles: docsWithFiles.length, totalDocs: docIds.length, totalFiles };
}

/**
 * Vendor Event Map Layout
 * - Loads diagram from API (public) and caches diagram doc to localStorage for faster reloads
 * - Server is source-of-truth for applications/status
 * - Vendor selects booth -> confirms -> submits application -> redirects to /vendor/events/:id/apply?appId=<numeric>&boothId=<id>
 */

type BoothStatus =
  | "available"
  | "pending"
  | "reserved"
  | "assigned"
  | "blocked"
  | "booked"
  | string;

type Booth = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  price?: number;
  category?: string;
  status?: BoothStatus;
  vendorId?: string | null;
};

type MapElementType =
  | "venue"
  | "street"
  | "stage"
  | "entrance"
  | "restrooms"
  | "info"
  | "foodcourt";

type MapElement = {
  id: string;
  type: MapElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

type DiagramDoc = {
  booths?: Booth[]; // legacy
  canvas?: { width: number; height: number; gridSize: number };
  levels?: Array<{ id: string; name: string; booths: Booth[]; elements?: MapElement[] }>;
};

type DiagramResponse = {
  diagram?: DiagramDoc;
  source?: "api" | "localStorage";
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function pill(kind: "Pending" | "Available" | "Reserved" | "Booked" | "Blocked" | "Assigned") {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
  switch (kind) {
    case "Pending":
      return `${base} bg-amber-50 text-amber-700`;
    case "Reserved":
      return `${base} bg-indigo-50 text-indigo-700`;
    case "Booked":
      return `${base} bg-emerald-50 text-emerald-700`;
    case "Blocked":
      return `${base} bg-slate-100 text-slate-700`;
    case "Assigned":
      return `${base} bg-purple-50 text-purple-700`;
    default:
      return `${base} bg-slate-100 text-slate-700`;
  }
}

function fmtMoney(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? `$${v}` : "—";
}

function statusLabel(status?: BoothStatus) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return { text: "available", klass: pill("Available") };
  if (s === "pending") return { text: "pending", klass: pill("Pending") };
  if (s === "reserved") return { text: "reserved", klass: pill("Reserved") };
  if (s === "booked") return { text: "booked", klass: pill("Booked") };
  if (s === "blocked") return { text: "blocked", klass: pill("Blocked") };
  if (s === "assigned") return { text: "assigned", klass: pill("Assigned") };
  if (!s) return { text: "—", klass: pill("Blocked") };
  return { text: s, klass: pill("Blocked") };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function extractNumericAppId(created: any): number | null {
  const candidates = [
    created?.application?.id,
    created?.application_id,
    created?.id,
    created?.applicationId,
    created?.application?.application_id,
  ];
  for (const c of candidates) {
    const n = typeof c === "number" ? c : Number(String(c ?? ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/* ---------------- Confirm Modal ---------------- */

function ConfirmModal(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="text-2xl font-bold text-slate-900">{props.title}</div>
        {props.subtitle ? (
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{props.subtitle}</div>
        ) : null}

        {props.error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {props.error}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {props.cancelText || "Cancel"}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {props.busy ? "Working…" : props.confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Main Page ---------------- */

export default function VendorEventMapLayoutPage() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  // NOTE: this may be empty or may be legacy. We do NOT rely on it being numeric here.
  const appId = query.get("appId") || "";

  const [loadingDiagram, setLoadingDiagram] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "localStorage" | "none">("none");
  const [diagram, setDiagram] = useState<DiagramDoc | null>(null);

  const [loadingApps, setLoadingApps] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [apps, setApps] = useState<ServerApplication[]>([]);

  const [levelId, setLevelId] = useState<string>("level-1");
  const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);

  // Zoom
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const levels = useMemo(() => {
    const lvls = diagram?.levels?.length
      ? diagram.levels
      : [{ id: "level-1", name: "Level 1", booths: diagram?.booths ?? [], elements: [] }];

    return lvls.map((l) => ({
      id: String(l.id),
      name: l.name || String(l.id),
      booths: Array.isArray(l.booths) ? l.booths : [],
      elements: Array.isArray((l as any).elements) ? (l as any).elements : [],
    }));
  }, [diagram]);

  useEffect(() => {
    if (!levels.length) return;
    if (!levels.some((l) => l.id === levelId)) {
      setLevelId(levels[0].id);
    }
  }, [levels, levelId]);

  const currentLevel = useMemo(() => {
    return levels.find((l) => l.id === levelId) || levels[0];
  }, [levels, levelId]);

  const canvas = useMemo(() => {
    const c = diagram?.canvas;
    return {
      width: Number(c?.width || 1400),
      height: Number(c?.height || 900),
      gridSize: Number(c?.gridSize || 20),
    };
  }, [diagram]);

  const vendorBoothStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of apps) {
      if (!a?.booth_id) continue;
      map.set(String(a.booth_id), String(a.status || "pending"));
    }
    return map;
  }, [apps]);

  const boothsWithServerStatus = useMemo(() => {
    const booths = Array.isArray(currentLevel?.booths) ? currentLevel.booths : [];
    return booths.map((b) => {
      const serverStatus = vendorBoothStatusById.get(String(b.id));
      if (!serverStatus) return b;

      const s = String(serverStatus).toLowerCase();
      let mapped: BoothStatus = b.status || "available";
      if (s === "submitted" || s === "pending") mapped = "pending";
      else if (s === "approved" || s === "booked") mapped = "booked";
      else if (s === "reserved") mapped = "reserved";
      else if (s === "assigned") mapped = "assigned";
      else if (s === "blocked") mapped = "blocked";

      return { ...b, status: mapped };
    });
  }, [currentLevel, vendorBoothStatusById]);

  const selectedBooth = useMemo(() => {
    if (!selectedBoothId) return null;
    return boothsWithServerStatus.find((b) => String(b.id) === String(selectedBoothId)) || null;
  }, [boothsWithServerStatus, selectedBoothId]);

  function isBoothSelectable(b: Booth) {
    const s = String(b.status || "").toLowerCase();
    return s === "available";
  }

  function selectBooth(b: Booth) {
    if (!isBoothSelectable(b)) return;
    setSelectedBoothId(String(b.id));
  }

  function clearSelection() {
    setSelectedBoothId(null);
  }

  function zoomIn() {
    setZoom((z) => clamp(Number(z) + 0.1, 0.3, 2));
  }
  function zoomOut() {
    setZoom((z) => clamp(Number(z) - 0.1, 0.3, 2));
  }
  function zoomFit() {
    setZoom(1);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    }
  }

  const diagramCacheKey = useMemo(() => {
    return eventId ? `vendor:event:${eventId}:diagram` : "";
  }, [eventId]);

  async function loadDiagram() {
    setLoadingDiagram(true);
    setLoadError(null);
    setDiagram(null);
    setSource("none");

    if (!eventId) {
      setLoadError("Missing eventId in route.");
      setLoadingDiagram(false);
      return;
    }

    // Try API first
    try {
      const url = `${API_BASE}/events/${encodeURIComponent(eventId)}/diagram`;
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as DiagramResponse | any;
        const doc = data?.diagram && typeof data.diagram === "object" ? data.diagram : data;
        if (doc && typeof doc === "object") {
          setDiagram(doc as DiagramDoc);
          setSource("api");
          try {
            if (diagramCacheKey) localStorage.setItem(diagramCacheKey, JSON.stringify(doc));
          } catch {
            // ignore cache issues
          }
          setLoadingDiagram(false);
          return;
        }
      }
    } catch {
      // fall through
    }

    // Fallback: localStorage cache
    try {
      const cached = diagramCacheKey ? safeJsonParse(localStorage.getItem(diagramCacheKey)) : null;
      if (cached && typeof cached === "object") {
        setDiagram(cached as DiagramDoc);
        setSource("localStorage");
        setLoadingDiagram(false);
        return;
      }
    } catch {
      // ignore
    }

    setSource("none");
    setLoadError("Could not load booth diagram from API or local cache.");
    setLoadingDiagram(false);
  }

  async function loadVendorApps() {
    setLoadingApps(true);
    setAppsError(null);
    try {
      const list = await listVendorApplications();
      setApps(Array.isArray(list) ? list : []);
      setLoadingApps(false);
    } catch (e: any) {
      setAppsError(e?.message || "Failed to load applications.");
      setApps([]);
      setLoadingApps(false);
    }
  }

  useEffect(() => {
    loadDiagram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    loadVendorApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goBackToRequirements() {
    if (!eventId) return;
    navigate(
      `/vendor/events/${encodeURIComponent(eventId)}/requirements${
        appId ? `?appId=${encodeURIComponent(appId)}` : ""
      }`
    );
  }

  function goBackToEvent() {
    if (!eventId) return;
    navigate(
      `/vendor/events/${encodeURIComponent(eventId)}${
        appId ? `?appId=${encodeURIComponent(appId)}` : ""
      }`
    );
  }

  function openConfirm() {
    if (!selectedBooth) return;
    setSubmitError(null);
    setConfirmOpen(true);
  }

  async function onConfirmPurchase() {
    if (!selectedBooth) return;
    if (!eventId) {
      setSubmitError("Missing eventId.");
      return;
    }

    setSubmitBusy(true);
    setSubmitError(null);

    function normalizeCheckedForSubmit(
      checked: Record<string, boolean> | undefined | null
    ) {
      const src = checked && typeof checked === "object" ? checked : {};
      const out: Record<string, boolean> = {};
      for (const k of Object.keys(src)) {
        if (k.startsWith("compliance:")) {
          out[normalizeId(k.slice("compliance:".length))] = !!src[k];
        } else {
          out[normalizeId(k)] = !!src[k];
        }
      }
      return out;
    }

    // ✅ FIX: if appId is empty, load by eventId only (most recent)
    const progress = loadVendorProgress(String(eventId), appId || undefined);
    const uploadSummary = progress
      ? summarizeUploads(progress.uploads || {})
      : { docsWithFiles: 0, totalDocs: 0, totalFiles: 0 };

    // ✅ NEW: attach vendor profile snapshot so organizer read-only view has real data
    const vendorProfileSnapshot = loadVendorProfileSnapshot();

    try {
      const created = await submitApplication(eventId, {
        booth_id: String(selectedBooth.id),
        checked: normalizeCheckedForSubmit(progress?.checked),
        notes: progress
          ? `Uploads: ${uploadSummary.docsWithFiles}/${uploadSummary.totalDocs} docs • ${uploadSummary.totalFiles} file(s)`
          : "",
        vendor_profile: vendorProfileSnapshot, // ✅
      });

      // Refresh apps so this screen stays truthful if user returns
      await loadVendorApps();

      // ✅ go straight to Apply with numeric appId
      const numericId = extractNumericAppId(created);
      if (!numericId) {
        navigate("/vendor/applications");
        return;
      }

      const qs = new URLSearchParams({
        appId: String(numericId),
        boothId: String(selectedBooth.id),
      });

      clearSelection();
      navigate(`/vendor/events/${encodeURIComponent(String(eventId))}/apply?${qs.toString()}`);
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to submit request.");
    } finally {
      setSubmitBusy(false);
      setConfirmOpen(false);
    }
  }

  const pageStatus = useMemo(() => {
    const anyPending = apps.some(
      (a) =>
        String(a.event_id) === String(eventId) &&
        String(a.status || "").toLowerCase() === "submitted"
    );
    return anyPending ? "Pending" : "";
  }, [apps, eventId]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-slate-500">Vendor Portal</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold text-slate-900">Booth Layout</h1>
              {pageStatus ? <span className={pill("Pending")}>{pageStatus}</span> : null}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Select a booth to submit your request. Approved booths become booked.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={goBackToRequirements}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Back to Requirements
            </button>

            <button
              type="button"
              onClick={goBackToEvent}
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              Back to Event
            </button>

            <button
              type="button"
              onClick={() => {
                loadDiagram();
                loadVendorApps();
              }}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Refresh
            </button>

            <button
              type="button"
              onClick={openConfirm}
              disabled={!selectedBooth || !isBoothSelectable(selectedBooth)}
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              Purchase / Apply
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,320px]">
          {/* Layout */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-lg font-bold text-slate-900">Layout</div>

              <div className="flex flex-wrap items-center gap-2">
                {levels.length > 1 ? (
                  <select
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                    value={levelId}
                    onChange={(e) => setLevelId(e.target.value)}
                  >
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <button
                  type="button"
                  onClick={zoomOut}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  −
                </button>
                <div className="min-w-[64px] text-center text-sm font-semibold text-slate-800">
                  {Math.round(zoom * 100)}%
                </div>
                <button
                  type="button"
                  onClick={zoomIn}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={zoomFit}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Fit
                </button>

                <div className="ml-1 text-xs text-slate-500">
                  Source:{" "}
                  <span className="font-semibold text-slate-700">
                    {source === "api" ? "api" : source === "localStorage" ? "localStorage" : "none"}
                  </span>
                </div>
              </div>
            </div>

            {loadingDiagram ? (
              <div className="flex items-center gap-3 py-10">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
                <div className="text-sm text-slate-700">Loading booth diagram…</div>
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="text-sm font-semibold text-rose-700">Couldn't load layout</div>
                <div className="mt-1 text-sm text-rose-700">{loadError}</div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="relative overflow-auto rounded-xl border border-slate-200 bg-white"
                style={{ height: 520 }}
              >
                <div
                  className="relative"
                  style={{
                    width: canvas.width * zoom,
                    height: canvas.height * zoom,
                    backgroundImage:
                      "linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)",
                    backgroundSize: `${canvas.gridSize * zoom}px ${canvas.gridSize * zoom}px`,
                  }}
                >
                  {/* Map elements */}
                  {(currentLevel?.elements || []).map((el) => (
                    <div
                      key={String(el.id)}
                      className="absolute rounded-lg border border-slate-200 bg-slate-50"
                      style={{
                        left: el.x * zoom,
                        top: el.y * zoom,
                        width: el.width * zoom,
                        height: el.height * zoom,
                      }}
                      title={el.label || el.type}
                    >
                      <div className="p-1 text-[10px] font-semibold text-slate-700">
                        {(el.label || el.type).toString()}
                      </div>
                    </div>
                  ))}

                  {/* Booths */}
                  {boothsWithServerStatus.map((b) => {
                    const sel = selectedBoothId && String(selectedBoothId) === String(b.id);
                    const canSelect = isBoothSelectable(b);

                    const s = statusLabel(b.status);
                    const bg =
                      String(b.status || "").toLowerCase() === "available"
                        ? "bg-white"
                        : String(b.status || "").toLowerCase() === "pending"
                        ? "bg-amber-50"
                        : String(b.status || "").toLowerCase() === "booked"
                        ? "bg-emerald-50"
                        : String(b.status || "").toLowerCase() === "reserved"
                        ? "bg-indigo-50"
                        : "bg-slate-100";

                    const border = sel ? "border-indigo-600 ring-2 ring-indigo-200" : "border-slate-300";

                    return (
                      <button
                        key={String(b.id)}
                        type="button"
                        onClick={() => selectBooth(b)}
                        disabled={!canSelect}
                        className={`absolute flex flex-col items-center justify-center rounded-xl border ${border} ${bg} text-left shadow-sm`}
                        style={{
                          left: b.x * zoom,
                          top: b.y * zoom,
                          width: b.width * zoom,
                          height: b.height * zoom,
                          padding: 8,
                          cursor: canSelect ? "pointer" : "not-allowed",
                          opacity: canSelect ? 1 : 0.85,
                        }}
                        title={`Booth ${b.label || b.id} • ${s.text}`}
                      >
                        <div className="text-sm font-extrabold text-slate-900">
                          {b.label || `Booth ${b.id}`}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-700">{b.category || ""}</div>
                        <div className="mt-1">
                          <span className={s.klass}>{s.text}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Booth Details */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Booth Details</div>
            <div className="mt-1 text-sm text-slate-600">Click an available booth on the map to select it.</div>

            {selectedBooth ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-2xl font-extrabold text-slate-900">
                  {selectedBooth.label || `Booth ${selectedBooth.id}`}
                </div>

                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <div>
                    Category: <span className="font-semibold">{selectedBooth.category || "—"}</span>
                  </div>
                  <div>
                    Price: <span className="font-semibold">{fmtMoney(selectedBooth.price)}</span>
                  </div>
                  <div>
                    Status: <span className="font-semibold">{statusLabel(selectedBooth.status).text}</span>
                  </div>
                  <div>
                    Size:{" "}
                    <span className="font-semibold">
                      {Math.round(Number(selectedBooth.width || 0))}×{Math.round(Number(selectedBooth.height || 0))}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openConfirm}
                    disabled={!isBoothSelectable(selectedBooth)}
                    className="w-full rounded-full bg-indigo-600 px-5 py-3 text-sm font-extrabold text-white hover:opacity-95 disabled:opacity-60"
                  >
                    Purchase / Apply
                  </button>

                  <button
                    type="button"
                    onClick={clearSelection}
                    className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                No booth selected.
              </div>
            )}

            <div className="mt-6">
              {loadingApps ? (
                <div className="text-sm text-slate-600">Loading application statuses…</div>
              ) : appsError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {appsError}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Server applications loaded:{" "}
                  <span className="font-semibold text-slate-700">{apps.length}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirm modal */}
        <ConfirmModal
          open={confirmOpen}
          title="Confirm booth request"
          subtitle={
            selectedBooth
              ? `${selectedBooth.label || `Booth ${selectedBooth.id}`} for ${fmtMoney(
                  selectedBooth.price
                )}?\n\nYour request will be submitted as Pending until the organizer reviews it.`
              : "Your request will be submitted as Pending until the organizer reviews it."
          }
          confirmText="Submit Request"
          busy={submitBusy}
          error={submitError}
          onClose={() => setConfirmOpen(false)}
          onConfirm={onConfirmPurchase}
        />
      </div>
    </div>
  );
}
