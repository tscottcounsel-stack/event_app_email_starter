// src/pages/VendorEventMapLayoutPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  listVendorApplications,
  vendorApplyToEvent,
  submitApplication,
  type ServerApplication,
} from "../components/api/applications";

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

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
  notes?: string;
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

function loadVendorProfileSnapshot(): Record<string, any> {
  const raw = localStorage.getItem(LS_VENDOR_PROFILE_KEY);
  const parsed = safeJsonParse<any>(raw);
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

function loadVendorProgress(eventId: string, appId?: string): VendorReqProgress | null {
  const all = safeJsonParse<VendorReqProgress[]>(
    localStorage.getItem(LS_VENDOR_PROGRESS_KEY)
  );
  if (!Array.isArray(all) || all.length === 0) return null;

  const eId = normalizeId(eventId);
  const aId = normalizeId(appId || "");

  const candidates = all.filter((p) => normalizeId(p.eventId) === eId);
  if (candidates.length === 0) return null;

  if (aId) {
    const exact = candidates.find((p) => normalizeId(p.appId || "") === aId);
    if (exact) return exact;
  }

  const noAppId = candidates.filter((p) => !normalizeId(p.appId || ""));
  const pool = noAppId.length > 0 ? noAppId : candidates;

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

/* ---------------- Types ---------------- */

type BoothStatus =
  | "available"
  | "requested"
  | "pending"
  | "reserved"
  | "assigned"
  | "blocked"
  | "booked"
  | "paid"
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
  booths?: Booth[];
  canvas?: { width: number; height: number; gridSize: number };
  levels?: Array<{ id: string; name: string; booths: Booth[]; elements?: MapElement[] }>;
};

type DiagramResponse = {
  diagram?: DiagramDoc;
  source?: "api" | "localStorage";
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Visual helpers (match Organizer tile feel) ---------------- */

function statusColor(status: BoothStatus) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return "#10b981"; // emerald
  if (s === "requested") return "#f59e0b"; // amber
  if (s === "assigned") return "#3b82f6"; // blue
  if (s === "booked" || s === "paid") return "#ef4444"; // red
  if (s === "reserved") return "#fb923c"; // orange
  if (s === "blocked") return "#111827"; // slate-900
  if (s === "pending") return "#a855f7"; // violet
  return "#6b7280"; // slate-500
}

function tileTheme(status: BoothStatus) {
  const s = String(status || "").toLowerCase();
  const base = statusColor(s);
  const isStrong =
    s === "available" ||
    s === "requested" ||
    s === "pending" ||
    s === "booked" ||
    s === "paid" ||
    s === "assigned" ||
    s === "reserved" ||
    s === "blocked";

  const opacity = s === "available" ? 1 : 0.92;

  return {
    fill: base,
    dot: base,
    text: isStrong ? "#ffffff" : "#0f172a",
    subtext: isStrong ? "rgba(255,255,255,0.92)" : "#334155",
    opacity,
  };
}

function pill(
  kind:
    | "Pending"
    | "Available"
    | "Requested"
    | "Reserved"
    | "Booked"
    | "Blocked"
    | "Assigned"
    | "Info"
) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
  switch (kind) {
    case "Pending":
      return `${base} bg-amber-50 text-amber-700`;
    case "Requested":
      return `${base} bg-amber-50 text-amber-700`;
    case "Reserved":
      return `${base} bg-indigo-50 text-indigo-700`;
    case "Booked":
      return `${base} bg-emerald-50 text-emerald-700`;
    case "Blocked":
      return `${base} bg-slate-100 text-slate-700`;
    case "Assigned":
      return `${base} bg-purple-50 text-purple-700`;
    case "Info":
      return `${base} bg-sky-50 text-sky-700`;
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
  if (s === "requested") return { text: "requested", klass: pill("Requested") };
  if (s === "pending") return { text: "pending", klass: pill("Pending") };
  if (s === "reserved") return { text: "awaiting approval", klass: pill("Reserved") };
  if (s === "booked" || s === "paid") return { text: "paid", klass: pill("Booked") };
  if (s === "blocked") return { text: "blocked", klass: pill("Blocked") };
  if (s === "assigned") return { text: "assigned", klass: pill("Assigned") };
  if (!s) return { text: "—", klass: pill("Blocked") };
  return { text: s, klass: pill("Blocked") };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function shortVendorLabel(v?: string | null) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const at = s.indexOf("@");
  if (at > 0) return s.slice(0, at);
  if (s.length > 18) return s.slice(0, 18) + "…";
  return s;
}

function normalizeStatus(v?: string) {
  const s = String(v || "").toLowerCase();
  if (s === "draft") return "draft";
  if (s === "submitted") return "submitted";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "reserved") return "reserved";
  if (s === "assigned") return "assigned";
  if (s === "paid") return "paid";
  return s || "submitted";
}

function isPaid(app: any) {
  const ps = String(app?.payment_status || "").toLowerCase();
  return ps === "paid";
}

function isPaymentAvailable(app: any) {
  if (typeof app?.payment_enabled === "boolean") return app.payment_enabled;
  if (typeof app?.payment_link === "string" && app.payment_link.trim()) return true;
  return true;
}

function safeHoldMs(app: any): number | null {
  const raw = String(app?.booth_reserved_until || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return t - Date.now();
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
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
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
            {props.subtitle}
          </div>
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
  const [saveSelectionBusy, setSaveSelectionBusy] = useState(false);
  const [saveSelectionError, setSaveSelectionError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // UX message when Pay Now has no link, so the click doesn't feel "dead"
  const [payNowMsg, setPayNowMsg] = useState<string | null>(null);

  // UX guidance banner tick (for hold countdown)
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

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

  // Booth labels by id (so we never show raw booth ids to users)
  const boothLabelById = useMemo(() => {
    const m = new Map<string, string>();
    const allLevels = Array.isArray(diagram?.levels) ? diagram!.levels! : [];
    if (allLevels.length > 0) {
      for (const lvl of allLevels) {
        for (const b of Array.isArray(lvl.booths) ? lvl.booths : []) {
          if (b?.id && b?.label) m.set(String(b.id), String(b.label));
        }
      }
    } else {
      for (const b of Array.isArray(diagram?.booths) ? diagram!.booths! : []) {
        if (b?.id && b?.label) m.set(String(b.id), String(b.label));
      }
    }
    return m;
  }, [diagram]);

  // Owner by booth_id from server applications, if available
  const boothOwnerByBoothId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of apps) {
      const bid = (a as any)?.booth_id;
      if (!bid) continue;

      const email = (a as any)?.vendor_email;
      const vendorId = (a as any)?.vendor_id;
      const label = email ? String(email) : vendorId ? String(vendorId) : "";
      if (label) m.set(String(bid), label);
    }
    return m;
  }, [apps]);

  const vendorBoothStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of apps) {
      const assignedBoothId = String((a as any)?.booth_id || "").trim();
      const requestedBoothId = String((a as any)?.requested_booth_id || "").trim();
      const status = String((a as any)?.status || "pending").toLowerCase();
      const paymentStatus = String((a as any)?.payment_status || "").toLowerCase();

      if (requestedBoothId && !assignedBoothId) {
        map.set(requestedBoothId, "requested");
      }

      if (assignedBoothId) {
        if (paymentStatus === "paid") map.set(assignedBoothId, "paid");
        else if (status === "approved") map.set(assignedBoothId, "assigned");
        else map.set(assignedBoothId, status || "assigned");
      }
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
      if (s === "requested") mapped = "requested";
      else if (s === "submitted" || s === "pending") mapped = "pending";
      else if (s === "approved" || s === "assigned") mapped = "assigned";
      else if (s === "reserved") mapped = "reserved";
      else if (s === "booked" || s === "paid") mapped = "paid";
      else if (s === "blocked") mapped = "blocked";

      return { ...b, status: mapped };
    });
  }, [currentLevel, vendorBoothStatusById]);

  const selectedBooth = useMemo(() => {
    if (!selectedBoothId) return null;
    return (
      boothsWithServerStatus.find((b) => String(b.id) === String(selectedBoothId)) || null
    );
  }, [boothsWithServerStatus, selectedBoothId]);

  function isBoothSelectable(b: Booth) {
    const s = String(b.status || "").toLowerCase();
    return s === "available";
  }

  async function selectBooth(b: Booth) {
    if (!isBoothSelectable(b)) return;
    const nextBoothId = String(b.id);
    setSelectedBoothId(nextBoothId);
    setSaveSelectionError(null);

    try {
      setSaveSelectionBusy(true);
      const saved = await persistBoothSelection(nextBoothId);
      await loadVendorApps();

      const savedAppId = String((saved as any)?.id || "").trim();
      if (eventId && savedAppId && savedAppId !== String(appId || "").trim()) {
        navigate(
          `/vendor/events/${encodeURIComponent(String(eventId))}/layout?appId=${encodeURIComponent(savedAppId)}`,
          { replace: true }
        );
      }
    } catch (e: any) {
      setSaveSelectionError(e?.message || "Failed to save booth request.");
    } finally {
      setSaveSelectionBusy(false);
    }
  }

  function clearSelection() {
    setSelectedBoothId(null);
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
            // ignore
          }
          setLoadingDiagram(false);
          return;
        }
      }
    } catch {
      // fall through
    }

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

  function goBackToRequirements(focus?: "payment") {
    if (!eventId) return;

    const qs = new URLSearchParams();
    if (appId) qs.set("appId", String(appId));
    if (focus) qs.set("focus", focus);

    const q = qs.toString();
    navigate(`/vendor/events/${encodeURIComponent(String(eventId))}/requirements${q ? `?${q}` : ""}`);
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

  function normalizeCheckedForSubmit(checked: Record<string, boolean> | undefined | null) {
    const src = checked && typeof checked === "object" ? checked : {};
    const out: Record<string, boolean> = {};
    for (const k of Object.keys(src)) {
      if (k.startsWith("compliance:")) out[normalizeId(k.slice("compliance:".length))] = !!src[k];
      else out[normalizeId(k)] = !!src[k];
    }
    return out;
  }

  async function persistBoothSelection(nextBoothId: string) {
    if (!eventId) throw new Error("Missing eventId.");

    const progress = loadVendorProgress(String(eventId), appId || undefined);
    const body = {
      requested_booth_id: String(nextBoothId),
      checked: normalizeCheckedForSubmit(progress?.checked),
      notes: (typeof progress?.notes === "string" ? progress.notes : "") || "",
    };

    const existingAppId = String((activeEventApp as any)?.id || appId || "").trim();

    if (existingAppId) {
      const res = await fetch(
        `${API_BASE}/vendor/applications/${encodeURIComponent(existingAppId)}/progress`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            booth_id: String(nextBoothId),
            checked: body.checked,
            notes: body.notes,
          }),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          String(data?.detail || data?.message || "Failed to save booth request.")
        );
      }

      return ((data?.application ?? data) || null) as any;
    }

    const created = await vendorApplyToEvent({
      eventId,
      body,
    });

    return created as any;
  }

  async function onConfirmPurchase() {
    if (!selectedBooth) return;
    if (!eventId) {
      setSubmitError("Missing eventId.");
      return;
    }

    setSubmitBusy(true);
    setSubmitError(null);

    const progress = loadVendorProgress(String(eventId), appId || undefined);
    summarizeUploads(progress?.uploads || {});
    loadVendorProfileSnapshot();

    try {
      const applied = await persistBoothSelection(String(selectedBooth.id));
      await submitApplication({ applicationId: (applied as any).id });

      navigate(
        `/vendor/events/${encodeURIComponent(String(eventId))}${
          (applied as any)?.id ? `?appId=${encodeURIComponent(String((applied as any).id))}` : appId ? `?appId=${encodeURIComponent(String(appId))}` : ""
        }`
      );
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to submit request.");
    } finally {
      setSubmitBusy(false);
      setConfirmOpen(false);
      loadVendorApps();
    }
  }

  // App(s) for this event (best-effort)
  const eventApps = useMemo(() => {
    return (apps || []).filter((a: any) => String(a.event_id) === String(eventId));
  }, [apps, eventId]);

  // Prefer the app from the URL (?appId=...), then fallback to "latest"
  const activeEventApp = useMemo(() => {
    if (!eventApps.length) return null;

    const wanted = String(appId || "").trim();
    if (wanted) {
      const exact = eventApps.find((a: any) => String(a?.id) === wanted);
      if (exact) return exact as any;
    }

    const sorted = eventApps.slice().sort((a: any, b: any) => {
      const ta = new Date(String(a.updated_at || a.submitted_at || "")).getTime() || 0;
      const tb = new Date(String(b.updated_at || b.submitted_at || "")).getTime() || 0;
      if (tb !== ta) return tb - ta;
      return (Number(b.id || 0) || 0) - (Number(a.id || 0) || 0);
    });

    return sorted[0] as any;
  }, [eventApps, appId]);

  const persistedBoothId = useMemo(() => {
    const requested = String((activeEventApp as any)?.requested_booth_id || "").trim();
    const assigned = String((activeEventApp as any)?.booth_id || "").trim();
    return assigned || requested || "";
  }, [activeEventApp]);

  useEffect(() => {
    if (persistedBoothId) {
      setSelectedBoothId((curr) => (curr === persistedBoothId ? curr : persistedBoothId));
      return;
    }

    setSelectedBoothId((curr) => curr);
  }, [persistedBoothId]);

  // Banner label helper
  const pageStatus = useMemo(() => {
    const anyPending = eventApps.some(
      (a: any) => String(a.status || "").toLowerCase() === "submitted"
    );
    return anyPending ? "Pending" : "";
  }, [eventApps]);

  const guidance = useMemo(() => {
    const a: any = activeEventApp;
    const status = normalizeStatus(a?.status);

    const progress = loadVendorProgress(String(eventId || ""), appId || undefined);
    const uploads = progress?.uploads || {};
    const sum = summarizeUploads(uploads);
    const hasDocs = sum.totalDocs > 0;
    const reqLooksIncomplete = hasDocs && sum.docsWithFiles < sum.totalDocs;

    const requestedBoothId = String(a?.requested_booth_id || "").trim();
    const assignedBoothId = String(a?.booth_id || "").trim();
    const hasRequestedBooth = !!requestedBoothId;
    const hasAssignedBooth = !!assignedBoothId;
    const paid = isPaid(a);
    const paymentAvail = isPaymentAvailable(a);
    const holdMs = safeHoldMs(a);

    if (status === "approved" && paid && hasAssignedBooth) {
      return {
        tone: "emerald" as const,
        title: "You’re confirmed ✅",
        body: "Your booth is confirmed and payment is complete.",
        cta: { label: "View floorplan", kind: "view_floorplan" as const },
        holdMs,
      };
    }

    if (status === "approved" && hasAssignedBooth && paymentAvail && !paid) {
      const holdLine =
        typeof holdMs === "number"
          ? holdMs > 0
            ? `Your approval hold expires in ${formatDuration(holdMs)}.`
            : "Your approval hold has expired."
          : "";

      return {
        tone: "amber" as const,
        title: "Booth approved — payment required",
        body: `Your requested booth has been approved. ${holdLine} Pay now to confirm it.`,
        cta: { label: "Pay now", kind: "pay_now" as const },
        holdMs,
      };
    }

    if (status === "submitted" && hasRequestedBooth) {
      return {
        tone: "slate" as const,
        title: "Booth requested",
        body: "Your booth request has been submitted and is awaiting organizer approval.",
        cta: { label: "Back to event", kind: "event" as const },
        holdMs,
      };
    }

    if (status === "approved" && !hasAssignedBooth) {
      return {
        tone: "violet" as const,
        title: "Waiting for booth assignment",
        body: "Your application is approved, but the organizer still needs to assign your booth.",
        cta: { label: "View floorplan", kind: "view_floorplan" as const },
        holdMs,
      };
    }

    if (status !== "approved" && reqLooksIncomplete) {
      return {
        tone: "slate" as const,
        title: "Complete your requirements",
        body: "Upload any missing requirement documents, then return here to choose a booth.",
        cta: { label: "Go to requirements", kind: "requirements" as const },
        holdMs,
      };
    }

    if (status === "submitted") {
      return {
        tone: "slate" as const,
        title: "Application submitted",
        body: "Your application is under review. Booth requests remain informational until the organizer approves and assigns one.",
        cta: { label: "Back to event", kind: "event" as const },
        holdMs,
      };
    }

    if (status === "rejected") {
      return {
        tone: "rose" as const,
        title: "Not approved",
        body: "This application was not approved. You can return to events to apply to others.",
        cta: { label: "Browse events", kind: "browse" as const },
        holdMs,
      };
    }

    return {
      tone: "slate" as const,
      title: "Select a booth to request",
      body: "Choose an available booth to request it. The organizer will review your request before payment is unlocked.",
      cta: { label: "Back to requirements", kind: "requirements" as const },
      holdMs,
    };
  }, [activeEventApp, eventId, appId]);

  function boothUiLabel(b: Booth) {
    const id = String(b.id);
    return boothLabelById.get(id) || b.label || `Booth`;
  }

  function boothOwnerLabel(b: Booth) {
    const owner = boothOwnerByBoothId.get(String(b.id));
    return owner ? shortVendorLabel(owner) : "";
  }

  function boothOccupancyText(b: Booth) {
    const owner = boothOwnerLabel(b);
    if (!owner) return "";
    const status = String(b.status || "").toLowerCase();
    if (status === "requested") return `Requested by ${owner}`;
    if (status === "assigned") return `Assigned to ${owner}`;
    if (status === "paid" || status === "booked") return `Confirmed for ${owner}`;
    if (status === "reserved") return `Awaiting approval for ${owner}`;
    return `Occupied by ${owner}`;
  }

  function bannerToneClasses(tone: "emerald" | "amber" | "violet" | "slate" | "rose") {
    if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-900";
    if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
    if (tone === "violet") return "border-violet-200 bg-violet-50 text-violet-900";
    if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-900";
    return "border-slate-200 bg-white text-slate-900";
  }

  function onGuidanceCta() {
    const kind = guidance.cta.kind;

    setPayNowMsg(null);

    if (kind === "requirements") return goBackToRequirements();
    if (kind === "event") return goBackToEvent();
    if (kind === "browse") return navigate("/vendor/events");

    if (kind === "view_floorplan") {
      clearSelection();
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
      }
      return;
    }

    if (kind === "select_booth") {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
      }
      return;
    }

    if (kind === "pay_now") {
      const a: any = activeEventApp;
      const link = String(a?.payment_link || "").trim();

      // If backend ever provides a link, use it.
      if (link) {
        window.open(link, "_blank");
        return;
      }

      // Option A: send vendor to payment instructions (Requirements page)
      if (!eventId) {
        setPayNowMsg("Payment link isn’t available yet for this application.");
        return;
      }

      goBackToRequirements("payment");
      return;
    }
  }

  const disableSelection = useMemo(() => {
    const a: any = activeEventApp;
    return !!a && isPaid(a);
  }, [activeEventApp]);

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
              {activeEventApp && isPaid(activeEventApp as any) ? (
                <span className={pill("Booked")}>Confirmed</span>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Choose an available booth to request it. Your selection is saved first, then the organizer reviews it before assignment and payment.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => goBackToRequirements()}
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
              disabled={disableSelection || saveSelectionBusy || !selectedBooth || !isBoothSelectable(selectedBooth)}
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              Request Booth
            </button>
          </div>
        </div>

        {/* Step B: Guidance Banner */}
        <div
          className={cx(
            "mb-6 rounded-2xl border p-4 shadow-sm",
            bannerToneClasses(guidance.tone)
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-extrabold">What’s next</div>
              <div className="mt-1 text-xl font-black">{guidance.title}</div>
              <div className="mt-1 text-sm font-semibold opacity-90">{guidance.body}</div>

              {payNowMsg ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3 text-sm font-semibold text-amber-900">
                  {payNowMsg}
                </div>
              ) : null}

              {guidance.tone === "amber" && typeof guidance.holdMs === "number" ? (
                <div className="mt-2 text-xs font-bold opacity-80">
                  {guidance.holdMs > 0
                    ? `Hold countdown: ${formatDuration(guidance.holdMs)}`
                    : "Hold countdown: expired"}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onGuidanceCta}
                className={cx(
                  "rounded-full px-5 py-2 text-sm font-extrabold",
                  guidance.tone === "emerald"
                    ? "bg-emerald-700 text-white hover:bg-emerald-800"
                    : guidance.tone === "amber"
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : guidance.tone === "violet"
                    ? "bg-violet-700 text-white hover:bg-violet-800"
                    : guidance.tone === "rose"
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                {guidance.cta.label}
              </button>

              <Link
                to="/vendor/dashboard"
                className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Dashboard
              </Link>
            </div>
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
                  onClick={() => setZoom((z) => clamp(Number(z) - 0.1, 0.3, 2))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  −
                </button>
                <div className="min-w-[64px] text-center text-sm font-semibold text-slate-800">
                  {Math.round(zoom * 100)}%
                </div>
                <button
                  type="button"
                  onClick={() => setZoom((z) => clamp(Number(z) + 0.1, 0.3, 2))}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    if (scrollRef.current) {
                      scrollRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
                    }
                  }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Fit
                </button>

                <div className="ml-1 text-xs text-slate-500">
                  Source:{" "}
                  <span className="font-semibold text-slate-700">
                    {source === "api"
                      ? "api"
                      : source === "localStorage"
                      ? "localStorage"
                      : "none"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className={pill("Available")}>Available</span>
              <span className={pill("Requested")}>Requested</span>
              <span className={pill("Assigned")}>Assigned</span>
              <span className={pill("Booked")}>Paid</span>
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
                  {(currentLevel?.elements || []).map((el: MapElement) => (
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
                    const canSelect = !disableSelection && isBoothSelectable(b);

                    const label = boothUiLabel(b);
                    const owner = boothOwnerLabel(b);
                    const s = String(b.status || "").toLowerCase();
                    const nonAvailable = s !== "available";

                    const theme = tileTheme(s);
                    const dot = statusColor(s);

                    const tooltip = [
                      label,
                      b.category ? `Category: ${b.category}` : "",
                      `Status: ${s || "—"}`,
                      owner && nonAvailable ? `Occupied by: ${owner}` : "",
                      typeof b.price === "number" ? `Price: $${b.price}` : "",
                    ]
                      .filter(Boolean)
                      .join(" • ");

                    return (
                      <button
                        key={String(b.id)}
                        type="button"
                        onClick={() => selectBooth(b)}
                        disabled={!canSelect}
                        className="absolute rounded-2xl shadow-sm"
                        style={{
                          left: b.x * zoom,
                          top: b.y * zoom,
                          width: b.width * zoom,
                          height: b.height * zoom,
                          padding: 10,
                          cursor: canSelect ? "pointer" : "not-allowed",
                          userSelect: "none",
                          boxSizing: "border-box",
                          background: theme.fill,
                          opacity: canSelect ? theme.opacity : Math.min(0.7, theme.opacity),
                          border: sel ? "3px solid #2563eb" : "2px solid rgba(255,255,255,0.35)",
                          boxShadow: sel
                            ? "0 14px 30px rgba(37,99,235,0.22)"
                            : "0 3px 10px rgba(15,23,42,0.08)",
                          color: theme.text,
                          overflow: "hidden",
                        }}
                        title={tooltip}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div style={{ fontSize: 12, fontWeight: 1000, lineHeight: 1.1 }}>
                            {label}
                          </div>
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: dot,
                              flexShrink: 0,
                              boxShadow: "0 0 0 2px rgba(255,255,255,0.35)",
                            }}
                          />
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 1000, lineHeight: 1 }}>
                          {fmtMoney(b.price)}
                        </div>

                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            fontWeight: 900,
                            color: theme.subtext,
                            lineHeight: 1.15,
                          }}
                        >
                          {b.category || "Select category"}
                        </div>

                        {owner && nonAvailable ? (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              fontWeight: 800,
                              color: theme.subtext,
                              opacity: 0.95,
                            }}
                          >
                            {boothOccupancyText(b)}
                          </div>
                        ) : null}

                        {!canSelect ? (
                          <div
                            style={{
                              position: "absolute",
                              right: 10,
                              bottom: 8,
                              fontSize: 10,
                              fontWeight: 900,
                              color: theme.subtext,
                              opacity: 0.9,
                            }}
                          >
                            {disableSelection ? "locked" : s || "—"}
                          </div>
                        ) : null}
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
            <div className="mt-1 text-sm text-slate-600">
              {disableSelection
                ? "You’re confirmed for this event. Booth selection is locked."
                : "Click an available booth on the map to request it."}
            </div>

            {saveSelectionBusy ? (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-800">
                Saving booth request…
              </div>
            ) : null}

            {saveSelectionError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                {saveSelectionError}
              </div>
            ) : null}

            {selectedBooth ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-2xl font-extrabold text-slate-900">
                  {boothUiLabel(selectedBooth)}
                </div>

                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <div>
                    Category:{" "}
                    <span className="font-semibold">{selectedBooth.category || "—"}</span>
                  </div>
                  <div>
                    Price: <span className="font-semibold">{fmtMoney(selectedBooth.price)}</span>
                  </div>
                  <div>
                    Status:{" "}
                    <span className="font-semibold">{statusLabel(selectedBooth.status).text}</span>
                  </div>
                  <div>
                    Size:{" "}
                    <span className="font-semibold">
                      {Math.round(Number(selectedBooth.width || 0))}×
                      {Math.round(Number(selectedBooth.height || 0))}
                    </span>
                  </div>

                  {(() => {
                    const owner = boothOwnerLabel(selectedBooth);
                    const nonAvailable =
                      String(selectedBooth.status || "").toLowerCase() !== "available";
                    return owner && nonAvailable ? (
                      <div>
                        {String(selectedBooth.status || "").toLowerCase() === "requested"
                          ? "Requested by: "
                          : String(selectedBooth.status || "").toLowerCase() === "assigned"
                          ? "Assigned to: "
                          : String(selectedBooth.status || "").toLowerCase() === "paid" ||
                            String(selectedBooth.status || "").toLowerCase() === "booked"
                          ? "Confirmed for: "
                          : "Occupied by: "}
                        <span className="font-semibold">{owner}</span>
                      </div>
                    ) : null;
                  })()}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openConfirm}
                    disabled={disableSelection || saveSelectionBusy || !isBoothSelectable(selectedBooth)}
                    className="w-full rounded-full bg-indigo-600 px-5 py-3 text-sm font-extrabold text-white hover:opacity-95 disabled:opacity-60"
                  >
                    Request Booth
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
              ? `${boothUiLabel(selectedBooth)} for ${fmtMoney(
                  selectedBooth.price
                )}?

Your request will be submitted and marked as awaiting organizer approval.`
              : "Your request will be submitted and marked as awaiting organizer approval."
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
