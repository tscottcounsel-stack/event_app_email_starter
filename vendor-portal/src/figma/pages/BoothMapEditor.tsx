// src/figma/pages/BoothMapEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession as readAuthSession } from "../../auth/authStorage";
import {
  vendorGetApplication,
  vendorGetOrCreateDraftApplication,
  vendorUpdateApplication,
} from "../../components/api/applications";

import { getEventDiagram, getPublicEventDiagram, saveEventDiagram } from "../components/api/diagram";
import type { Booth, BoothStateByIdEntry } from "../components/api/diagram";

type ElementType = "venue" | "street" | "label" | "shape";

type MapElement = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

type Level = {
  id: string;
  name: string;
  booths: Booth[];
  elements: MapElement[];
};

type DiagramDoc = {
  published?: boolean;
  meta?: { published?: boolean };
  version?: number;
  canvas?: { width?: number; height?: number; gridSize?: number };
  levels?: Array<{
    id: string;
    name: string;
    booths: Booth[];
    elements?: MapElement[];
  }>;
  booths?: Booth[];
  elements?: MapElement[];
};

type AppReservationInfo = {
  applicationId: number;
  vendorEmail?: string;
  vendorName?: string;
  paymentStatus: "unpaid" | "pending" | "paid" | "expired" | "unknown";
  reservedUntil?: string | null;
  status?: "available" | "reserved" | "assigned" | "blocked" | "paid" | string;
};

type OrganizerApp = {
  id: number;
  status?: string;
  vendor_email?: string;
  vendor_id?: number | string;
  vendor_name?: string;
  vendor_company_name?: string;
  company_name?: string;
  vendor_display_name?: string;
  booth_id?: string | null;
  booth_reserved_until?: string | null;
  payment_status?: string | null;
};

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

const INVITE_STORAGE_KEY = "vendorconnect_invites";
const INVITE_SESSION_KEY = "vendorconnect_invite_id";

const CATEGORY_OPTIONS = [
  "Food & Beverage",
  "Clothing",
  "Accessories",
  "Beauty",
  "Art",
  "Tech",
  "Home",
  "Services",
  "Other",
];

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function formatHoldCountdown(iso?: string | null) {
  if (!iso) return "";
  const end = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const mm = Math.floor(diff / 60);
  const ss = diff % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeJsonParse<T = any>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function parsePaymentStatus(raw: any): AppReservationInfo["paymentStatus"] {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "paid") return "paid";
  if (s === "pending") return "pending";
  if (s === "expired") return "expired";
  if (s === "unpaid" || s === "") return "unpaid";
  return "unknown";
}

function isFutureIso(value?: string | null) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() > Date.now();
}

function fmtWhen(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function pickVendorDisplayName(a: OrganizerApp): string | undefined {
  const raw =
    a.vendor_company_name ||
    a.company_name ||
    a.vendor_name ||
    a.vendor_display_name ||
    undefined;
  const s = raw ? String(raw).trim() : "";
  return s || undefined;
}

function normalizeBoothStateById(raw: any): Record<string, AppReservationInfo> {
  if (!raw || typeof raw !== "object") return {};

  const normalized: Record<string, AppReservationInfo> = {};
  for (const [boothId, value] of Object.entries(raw as Record<string, BoothStateByIdEntry>)) {
    if (!boothId || !value || typeof value !== "object") continue;

    normalized[String(boothId)] = {
      applicationId: Number((value as any).applicationId || 0),
      vendorEmail: (value as any).vendorEmail ? String((value as any).vendorEmail) : undefined,
      vendorName: (value as any).vendorName ? String((value as any).vendorName) : undefined,
      paymentStatus: parsePaymentStatus((value as any).paymentStatus),
      reservedUntil: (value as any).reservedUntil ? String((value as any).reservedUntil) : null,
      status: (value as any).status ? String((value as any).status) : undefined,
    };
  }

  return normalized;
}

function markInviteReservation() {
  const inviteId = sessionStorage.getItem(INVITE_SESSION_KEY);
  if (!inviteId) return;

  try {
    const invites = JSON.parse(localStorage.getItem(INVITE_STORAGE_KEY) || "[]");

    const updated = invites.map((inv: any) => {
      if (String(inv.id) !== inviteId) return inv;
      if (inv?.reservedTracked) return inv;

      return {
        ...inv,
        reserved: (inv.reserved || 0) + 1,
        reservedTracked: true,
        reservedAt: new Date().toISOString(),
      };
    });

    localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // fail silently
  }
}

function isEmptyDiagramDoc(doc: DiagramDoc | null | undefined) {
  if (!doc) return true;
  const levels = Array.isArray(doc.levels) ? doc.levels : [];
  const legacyBooths = Array.isArray(doc.booths) ? doc.booths : [];
  if (levels.length) {
    return levels.every(
      (l) => (l.booths?.length ?? 0) === 0 && (l.elements?.length ?? 0) === 0
    );
  }
  return legacyBooths.length === 0;
}

function lsDiagramKey(eventId: string) {
  return `event:${String(eventId)}:diagram`;
}

function pill(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: 900,
    fontSize: 12,
    border: active
      ? "1px solid rgba(99,102,241,0.40)"
      : "1px solid rgba(15,23,42,0.12)",
    background: active ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.90)",
    color: active ? "#4338ca" : "#0f172a",
    cursor: "pointer",
    userSelect: "none",
  };
}

function softCard(): React.CSSProperties {
  return {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 10px 24px rgba(2,6,23,0.06)",
  };
}

function isBrowserEventLike(value: any) {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return (
    typeof value.preventDefault === "function" ||
    typeof value.stopPropagation === "function" ||
    "nativeEvent" in value ||
    "currentTarget" in value ||
    "target" in value ||
    keys.includes("_reactName")
  );
}

function isDomNodeLike(value: any) {
  if (!value || typeof value !== "object") return false;
  if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) return true;
  if (typeof Event !== "undefined" && value instanceof Event) return true;
  return (
    typeof (value as any).nodeType === "number" ||
    typeof (value as any).tagName === "string" ||
    typeof (value as any).ownerDocument === "object"
  );
}

function sanitizeForJson<T>(input: T): T {
  const seen = new WeakSet();

  const walk = (value: any): any => {
    if (value == null) return value;
    const t = typeof value;

    if (t === "string" || t === "number" || t === "boolean") return value;
    if (t === "bigint") return Number(value);
    if (t === "function" || t === "symbol") return undefined;

    if (Array.isArray(value)) {
      return value.map((item) => walk(item)).filter((item) => item !== undefined);
    }

    if (t === "object") {
      if (isDomNodeLike(value) || isBrowserEventLike(value)) return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);

      const out: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        if (
          key === "target" ||
          key === "currentTarget" ||
          key === "nativeEvent" ||
          key === "view" ||
          key === "path" ||
          key === "srcElement" ||
          key === "__reactFiber$" ||
          key === "__reactProps$" ||
          key === "_owner" ||
          key === "stateNode"
        ) {
          continue;
        }

        const next = walk(child);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }

    return undefined;
  };

  return walk(input) as T;
}


async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

async function fetchOrganizerApplications(eventId: string): Promise<OrganizerApp[]> {
  const s = readAuthSession();
  const token = s?.accessToken || "";
  const email = s?.email || "organizer@example.com";

  const urls = [
    `${API_BASE}/organizer/events/${encodeURIComponent(String(eventId))}/applications`,
    `${API_BASE}/events/${encodeURIComponent(String(eventId))}/applications`,
  ];

  let lastError = "Failed to load applications";

  for (const url of urls) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-user-email": email,
        Accept: "application/json",
      },
    });

    const data = await readJson(res);

    if (res.ok) {
      return Array.isArray((data as any)?.applications)
        ? (data as any).applications
        : Array.isArray(data)
          ? data
          : [];
    }

    lastError = String((data as any)?.detail || `Failed to load applications (${res.status})`);
  }

  throw new Error(lastError);
}

async function organizerReserveBooth(appId: number, boothId: string) {
  const s = readAuthSession();
  const token = s?.accessToken || "";
  const email = s?.email || "organizer@example.com";

  const res = await fetch(
    `${API_BASE}/organizer/applications/${encodeURIComponent(String(appId))}/reserve-booth`,
    {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-user-email": email,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ booth_id: boothId, hold_hours: 24 }),
    }
  );

  const data = await readJson(res);
  if (!res.ok) throw new Error(String((data as any)?.detail || "Assign failed"));
  return data;
}

export default function BoothMapEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ eventId?: string }>();

  const routeEventId = String(params?.eventId || "").trim();

  const queryEventId = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return String(sp.get("eventId") || "").trim();
  }, [location.search]);

  const eventId = (routeEventId || queryEventId || "").trim();

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const assignAppIdRaw = (searchParams.get("assignAppId") || "").trim();
  const assignAction = (searchParams.get("assignAction") || "").trim().toLowerCase();
  const assignAppId = assignAppIdRaw ? Number(assignAppIdRaw) : null;
  const pickerMode = Boolean(assignAppId);

  const vendorAppIdRaw = (
    searchParams.get("appId") ||
    searchParams.get("applicationId") ||
    searchParams.get("appld") ||
    ""
  ).trim();

  const vendorAppId =
    vendorAppIdRaw && /^\d+$/.test(vendorAppIdRaw) ? Number(vendorAppIdRaw) : null;

  const isVendorRoute = location.pathname.startsWith("/vendor/");
  const vendorMode = Boolean(isVendorRoute && !pickerMode);

  useEffect(() => {
    if (!vendorMode) return;
    if (!eventId) return;

    let cancelled = false;

    async function fixAppId() {
      try {
        let needsRepair = false;

        if (!vendorAppId) {
          needsRepair = true;
        } else {
          try {
            const existing = await vendorGetApplication({ applicationId: vendorAppId });
            const existingEventId = String(
              (existing as any)?.event_id ??
                (existing as any)?.eventId ??
                (existing as any)?.event?.id ??
                ""
            ).trim();

            if (!existingEventId || existingEventId !== String(eventId)) {
              needsRepair = true;
            }
          } catch {
            needsRepair = true;
          }
        }

        if (!needsRepair) return;

        const draft = await vendorGetOrCreateDraftApplication(Number(eventId));

        const resolvedDraftId =
          (draft as any)?.id ??
          (draft as any)?.application?.id ??
          (draft as any)?.applicationId ??
          (draft as any)?.application_id ??
          (draft as any)?.data?.id ??
          (draft as any)?.data?.application?.id ??
          (draft as any)?.data?.applicationId ??
          (draft as any)?.data?.application_id;

        const numericId = Number(resolvedDraftId);
        if (!numericId || Number.isNaN(numericId)) return;
        if (cancelled) return;

        const params = new URLSearchParams(location.search);
        params.delete("appld");
        params.delete("applicationId");
        params.set("appId", String(numericId));

        navigate(
          `/vendor/events/${encodeURIComponent(String(eventId))}/map?${params.toString()}`,
          { replace: true }
        );
      } catch (e) {
        console.error("Failed to fix appId", e);
      }
    }

    void fixAppId();

    return () => {
      cancelled = true;
    };
  }, [vendorMode, eventId, vendorAppId, location.search, navigate]);

  const [isPublished, setIsPublished] = useState<boolean>(false);
  const [layoutOverrideUntil, setLayoutOverrideUntil] = useState<number | null>(null);

  const layoutOverrideActive = useMemo(() => {
    if (!layoutOverrideUntil) return false;
    return Date.now() < layoutOverrideUntil;
  }, [layoutOverrideUntil]);

  const layoutLocked = Boolean(isPublished && !layoutOverrideActive && !pickerMode);

  const printSnapshotRef = useRef<{
    drawerOpen: boolean;
    hideGrid: boolean;
    zoom: number;
  } | null>(null);

  function beginLayoutOverride() {
    const mins = 10;
    setLayoutOverrideUntil(Date.now() + mins * 60 * 1000);
  }

  function relockLayoutNow() {
    setLayoutOverrideUntil(null);
  }

  const canvasScrollerRef = useRef<HTMLDivElement | null>(null);

  const [canvasW, setCanvasW] = useState(1200);
  const [canvasH, setCanvasH] = useState(800);
  const [gridSize, setGridSize] = useState(20);
  const [hideGrid, setHideGrid] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [levels, setLevels] = useState<Level[]>([
    { id: "level-1", name: "Level 1", booths: [], elements: [] },
  ]);
  const [activeLevelId, setActiveLevelId] = useState("level-1");

  const activeLevel = useMemo(
    () => levels.find((l) => l.id === activeLevelId) || levels[0],
    [levels, activeLevelId]
  );

  const [tab, setTab] = useState<
    "floors" | "booths" | "elements" | "vendors" | "reservations" | "settings"
  >("booths");

  useEffect(() => {
    if (vendorMode && tab !== "booths") setTab("booths");
  }, [vendorMode, tab]);

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedKind, setSelectedKind] = useState<"booth" | "element" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedBooth = useMemo(() => {
    if (selectedKind !== "booth" || !selectedId) return null;
    return activeLevel.booths.find((b: any) => String(b.id) === String(selectedId)) || null;
  }, [selectedKind, selectedId, activeLevel.booths]);

  const selectedElement = useMemo(() => {
    if (selectedKind !== "element" || !selectedId) return null;
    return activeLevel.elements.find((e) => e.id === selectedId) || null;
  }, [selectedKind, selectedId, activeLevel.elements]);

  const [drag, setDrag] = useState<
    null | { kind: "booth" | "element"; id: string; cx: number; cy: number }
  >(null);

  const [resize, setResize] = useState<
    | null
    | {
        kind: "booth" | "element";
        id: string;
        sw: number;
        sh: number;
        cx: number;
        cy: number;
      }
  >(null);

  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("Loaded");
  const [saveError, setSaveError] = useState<string | null>(null);

  function markDirty() {
    setStatusMsg("Not saved yet");
    setSaveError(null);
  }

  function clearSelection() {
    setSelectedKind(null);
    setSelectedId(null);
  }

  const [apps, setApps] = useState<OrganizerApp[]>([]);
  const [vendorAppStatus, setVendorAppStatus] = useState<string>("draft");
  const [vendorBoothId, setVendorBoothId] = useState<string>("");
  const [vendorRequirementsReady, setVendorRequirementsReady] = useState(false);
  const [vendorRequirementsReason, setVendorRequirementsReason] = useState("");

  async function evaluateVendorSubmissionReadiness(applicationId: number) {
    const app = await vendorGetApplication({ applicationId });

    const checkedObj =
      app?.checked && typeof app.checked === "object"
        ? (app.checked as Record<string, boolean>)
        : {};

    const docsObj = ((app?.documents ?? app?.docs) || {}) as Record<string, any>;

    let reqCompliance: any[] = [];
    let reqDocuments: any[] = [];

    try {
      const res = await fetch(
        `${API_BASE}/events/${encodeURIComponent(String(eventId))}/requirements`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const parsed = (data as any)?.requirements ?? data ?? {};

        const complianceRaw =
          parsed?.compliance ??
          parsed?.complianceItems ??
          parsed?.compliance_items ??
          [];

        const documentsRaw =
          parsed?.documents ??
          parsed?.documentRequirements ??
          parsed?.document_requirements ??
          [];

        reqCompliance = Array.isArray(complianceRaw) ? complianceRaw : [];
        reqDocuments = Array.isArray(documentsRaw) ? documentsRaw : [];
      }
    } catch {
      // keep fallback behavior below
    }

    const requiredCompliance =
      reqCompliance.filter((c: any) => c?.required !== false).length > 0
        ? reqCompliance.filter((c: any) => c?.required !== false)
        : reqCompliance;

    const requiredDocuments =
      reqDocuments.filter((d: any) => d?.required !== false).length > 0
        ? reqDocuments.filter((d: any) => d?.required !== false)
        : reqDocuments;

    const complianceReady =
      requiredCompliance.length === 0
        ? true
        : requiredCompliance.every((c: any) => {
            const key = String(c?.id || c?.text || c?.label || "").trim();
            return !!checkedObj[key];
          });

    const documentsReady =
      requiredDocuments.length === 0
        ? Object.keys(docsObj || {}).length > 0 || reqDocuments.length === 0
        : requiredDocuments.every((d: any) => {
            const key = String(d?.id || d?.name || "").trim();
            const value = (docsObj as any)?.[key];
            return Array.isArray(value) ? value.length > 0 : !!value;
          });

    const boothReady = !!String(app?.booth_id || app?.requested_booth_id || "").trim();

    if (!complianceReady) {
      return {
        ready: false,
        reason: "Complete all required compliance items before submitting.",
        app,
      };
    }

    if (!documentsReady) {
      return {
        ready: false,
        reason: "Upload all required documents before submitting.",
        app,
      };
    }

    if (!boothReady) {
      return {
        ready: false,
        reason: "Select a booth before submitting.",
        app,
      };
    }

    return {
      ready: true,
      reason: "",
      app,
    };
  }

  const pickerApp = useMemo(() => {
    if (!assignAppId) return null;
    return apps.find((a) => Number(a?.id) === Number(assignAppId)) || null;
  }, [apps, assignAppId]);

  const pickerPaymentStatus = useMemo(() => {
    return parsePaymentStatus((pickerApp as any)?.payment_status);
  }, [pickerApp]);

  const isLocked = Boolean(pickerMode && assignAppId && pickerPaymentStatus === "paid");

  const [boothReservations, setBoothReservations] = useState<Record<string, AppReservationInfo>>(
    {}
  );
  const [diagramBoothStateById, setDiagramBoothStateById] = useState<
    Record<string, AppReservationInfo>
  >({});
  const [reservationsError, setReservationsError] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [, setNowTick] = useState(Date.now());

  const refreshReservations = useCallback(async () => {
    if (!eventId) return;

    if (vendorMode) {
      setReservationsError(null);
      setApps([]);
      setBoothReservations({});
      return;
    }

    try {
      setReservationsError(null);
      const list = await fetchOrganizerApplications(String(eventId));
      setApps(list);

      const idx: Record<string, AppReservationInfo> = {};
      for (const a of list) {
        const boothId = String(a?.booth_id || "").trim();
        if (!boothId) continue;

        const pay = parsePaymentStatus(a?.payment_status);
        const until = a?.booth_reserved_until ? String(a.booth_reserved_until) : null;

        const baseInfo: AppReservationInfo = {
          applicationId: Number(a?.id),
          vendorEmail: a?.vendor_email ? String(a.vendor_email) : undefined,
          vendorName: pickVendorDisplayName(a),
          paymentStatus: pay,
          reservedUntil: until,
          status: pay === "paid" ? "paid" : until && isFutureIso(until) ? "reserved" : "assigned",
        };

        if (pay === "paid") {
          idx[boothId] = baseInfo;
          continue;
        }

        if ((pay === "unpaid" || pay === "pending") && isFutureIso(until)) {
          idx[boothId] = baseInfo;
          continue;
        }
      }

      setBoothReservations(idx);
    } catch (e: any) {
      setReservationsError(e?.message ? String(e.message) : "Failed to load applications.");
      setApps([]);
      setBoothReservations({});
    }
  }, [eventId, vendorMode]);

  useEffect(() => {
    refreshReservations();
  }, [refreshReservations]);

useEffect(() => {
  const intervalId = window.setInterval(() => {
    refreshReservations();
  }, 5000);

  return () => window.clearInterval(intervalId);
}, [refreshReservations]);
  useEffect(() => {
    let cancelled = false;

    async function loadVendorApp() {
      if (!vendorMode || !vendorAppId) return;

      try {
        const result = await evaluateVendorSubmissionReadiness(vendorAppId);
        if (cancelled) return;

        setVendorAppStatus(String(result.app?.status || "draft").toLowerCase());
        setVendorBoothId(String(result.app?.booth_id || result.app?.requested_booth_id || ""));
        setVendorRequirementsReady(!!result.ready);
        setVendorRequirementsReason(result.reason || "");
      } catch {
        if (cancelled) return;
        setVendorAppStatus("draft");
        setVendorBoothId("");
        setVendorRequirementsReady(false);
        setVendorRequirementsReason("Complete required steps before submitting.");
      }
    }

    loadVendorApp();
    return () => {
      cancelled = true;
    };
  }, [vendorMode, vendorAppId, eventId]);

  function fitToScreen() {
    const scroller = canvasScrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const pad = 24;
    const availW = Math.max(200, rect.width - pad);
    const availH = Math.max(200, rect.height - pad);
    const z = Math.min(availW / canvasW, availH / canvasH);
    setZoom(+clamp(z, 0.45, 1.25).toFixed(2));
  }

  function handlePrint() {
    if (!printSnapshotRef.current) {
      printSnapshotRef.current = { drawerOpen, hideGrid, zoom };
    }

    setDrawerOpen(false);
    setHideGrid(true);

    setTimeout(() => {
      try {
        fitToScreen();
      } catch {}
      setTimeout(() => {
        window.print();
      }, 50);
    }, 50);
  }

  useEffect(() => {
    const onAfterPrint = () => {
      const snap = printSnapshotRef.current;
      if (snap) {
        setDrawerOpen(snap.drawerOpen);
        setHideGrid(snap.hideGrid);
        setZoom(snap.zoom);
      }
      printSnapshotRef.current = null;
    };
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    (async () => {
      try {
        // Vendor mode must also try the published API layout first.
        // Falling back to localStorage only makes the vendor map appear blank
        // on fresh browsers/devices even when the organizer has already saved booths.

        const data = await (vendorMode ? getPublicEventDiagram(eventId) : getEventDiagram(eventId));
        if (cancelled) return;

        const boothStateById = normalizeBoothStateById((data as any)?.booth_state_by_id);
        setDiagramBoothStateById(boothStateById);

        const raw = ((data as any)?.diagram ?? (data as any) ?? null) as any;
        const apiDiagram = (raw ?? null) as DiagramDoc | null;
        const apiHasLayout = apiDiagram && !isEmptyDiagramDoc(apiDiagram);

        const publishedFlag = Boolean(
          (apiDiagram as any)?.published ?? (apiDiagram as any)?.meta?.published
        );
        setIsPublished(publishedFlag);

        if (!apiHasLayout) {
          setLevels([{ id: "level-1", name: "Level 1", booths: [], elements: [] }]);
          setActiveLevelId("level-1");
          setStatusMsg("New diagram initialized");
          return;
        }

        const d = apiDiagram as DiagramDoc;
        setCanvasW(d.canvas?.width ?? 1200);
        setCanvasH(d.canvas?.height ?? 800);
        setGridSize(d.canvas?.gridSize ?? 20);

        if (d.levels?.length) {
          setLevels(
            d.levels.map((lvl) => ({
              id: lvl.id,
              name: lvl.name,
              booths: Array.isArray(lvl.booths) ? lvl.booths : [],
              elements: Array.isArray(lvl.elements) ? lvl.elements : [],
            }))
          );
          setActiveLevelId(d.levels[0].id);
        } else if (Array.isArray(d.booths)) {
          setLevels([
            {
              id: "level-1",
              name: "Level 1",
              booths: d.booths,
              elements: Array.isArray(d.elements) ? d.elements : [],
            },
          ]);
          setActiveLevelId("level-1");
        }

        localStorage.setItem(
          lsDiagramKey(eventId),
          JSON.stringify(sanitizeForJson({ diagram: d }))
        );
        setStatusMsg("Loaded");
      } catch (e: any) {
        setDiagramBoothStateById({});
        setSaveError(e?.message ? String(e.message) : "Failed to load diagram.");
        setStatusMsg("Load failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (!eventId || (!pickerMode && !vendorMode)) return;

    const interval = window.setInterval(async () => {
      try {
        if (!vendorMode) {
          const data = await (vendorMode ? getPublicEventDiagram(eventId) : getEventDiagram(eventId));
          setDiagramBoothStateById(normalizeBoothStateById((data as any)?.booth_state_by_id));
        }
        await refreshReservations();
      } catch {
        // fail silently during background refresh
      }
    }, 8000);

    return () => window.clearInterval(interval);
  }, [eventId, pickerMode, refreshReservations, vendorMode]);

  useEffect(() => {
    if (!drag && !resize) return;

    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - (drag?.cx ?? resize?.cx ?? 0)) / zoom;
      const dy = (e.clientY - (drag?.cy ?? resize?.cy ?? 0)) / zoom;

      if (drag) {
        const { kind, id } = drag;
        setLevels((prev) =>
          prev.map((lvl) => {
            if (lvl.id !== activeLevelId) return lvl;

            if (kind === "booth") {
              return {
                ...lvl,
                booths: lvl.booths.map((b: any) =>
                  String(b.id) !== String(id)
                    ? b
                    : { ...b, x: (b.x || 0) + dx, y: (b.y || 0) + dy }
                ),
              };
            }

            return {
              ...lvl,
              elements: lvl.elements.map((el) =>
                el.id !== id ? el : { ...el, x: el.x + dx, y: el.y + dy }
              ),
            };
          })
        );

        setDrag({ ...drag, cx: e.clientX, cy: e.clientY });
        markDirty();
      }

      if (resize) {
        const { kind, id, sw, sh } = resize;
        const nw = Math.max(40, sw + dx);
        const nh = Math.max(28, sh + dy);

        setLevels((prev) =>
          prev.map((lvl) => {
            if (lvl.id !== activeLevelId) return lvl;

            if (kind === "booth") {
              return {
                ...lvl,
                booths: lvl.booths.map((b: any) =>
                  String(b.id) !== String(id) ? b : { ...b, width: nw, height: nh }
                ),
              };
            }

            return {
              ...lvl,
              elements: lvl.elements.map((el) =>
                el.id !== id ? el : { ...el, width: nw, height: nh }
              ),
            };
          })
        );

        setResize({ ...resize, cx: e.clientX, cy: e.clientY });
        markDirty();
      }
    };

    const onUp = () => {
      setDrag(null);
      setResize(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, resize, zoom, activeLevelId]);

  function beginDrag(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    if (layoutLocked) {
      window.alert("Published (Locked) — unlock layout to move items.");
      return;
    }
    setDrag({ kind, id, cx: e.clientX, cy: e.clientY });
  }

  function beginResize(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    if (layoutLocked) {
      window.alert("Published (Locked) — unlock layout to resize items.");
      return;
    }
    e.stopPropagation();

    if (kind === "booth") {
      const b = activeLevel.booths.find((x: any) => String(x.id) === String(id)) as any;
      if (!b) return;
      setResize({
        kind,
        id,
        sw: Number(b.width || 100),
        sh: Number(b.height || 80),
        cx: e.clientX,
        cy: e.clientY,
      });
      return;
    }

    const el = activeLevel.elements.find((x) => x.id === id);
    if (!el) return;
    setResize({
      kind,
      id,
      sw: el.width,
      sh: el.height,
      cx: e.clientX,
      cy: e.clientY,
    });
  }



  async function saveNow(nextPublished: boolean = isPublished) {
    if (!eventId) return;

    try {
      setIsSaving(true);
      setSaveError(null);
      setStatusMsg("Saving…");

      const doc: DiagramDoc = {
        version: 2,
        published: nextPublished,
        meta: { published: nextPublished },
        canvas: { width: canvasW, height: canvasH, gridSize },
        levels: levels.map((lvl) => ({
          id: lvl.id,
          name: lvl.name,
          booths: lvl.booths,
          elements: lvl.elements,
        })),
      };

      const safeDoc = sanitizeForJson(doc) as DiagramDoc;
      await saveEventDiagram(eventId, safeDoc);
      localStorage.setItem(
        lsDiagramKey(eventId),
        JSON.stringify(sanitizeForJson({ diagram: safeDoc }))
      );
      setIsPublished(nextPublished);
      setStatusMsg("Saved");
    } catch (e: any) {
      setSaveError(e?.message ? String(e.message) : "Save failed");
      setStatusMsg("Save failed");
      throw e;
    } finally {
      setIsSaving(false);
    }
  }

  async function publishEventNow() {
    if (!eventId) return;

    const s = readAuthSession();
    const token = s?.accessToken || "";
    const email = s?.email || "organizer@example.com";

    const res = await fetch(`${API_BASE}/organizer/events/${eventId}/publish`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-user-email": String(email),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || "Publish failed");
    }

    return await res.json().catch(() => ({}));
  }

  function elementLabel(t: ElementType) {
    if (t === "venue") return "Venue";
    if (t === "street") return "Street";
    if (t === "label") return "Label";
    return "Shape";
  }

  function addBooth() {
    if (layoutLocked) {
      window.alert("Published (Locked) — unlock layout to add booths.");
      return;
    }

    const id = uid("booth");
    const booth: any = {
      id,
      label: `Booth ${activeLevel.booths.length + 1}`,
      x: 80,
      y: 120,
      width: 140,
      height: 110,
      category: "",
      price: 0,
      status: "available",
    };

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, booths: [...lvl.booths, booth] }
      )
    );

    setSelectedKind("booth");
    setSelectedId(id);
    setDrawerOpen(true);
    setTab("booths");
    markDirty();
  }

  function deleteSelected() {
    if (layoutLocked) {
      window.alert("Published (Locked) — unlock layout to delete items.");
      return;
    }

    if (!selectedKind || !selectedId) return;

    if (selectedKind === "booth") {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id !== activeLevelId
            ? lvl
            : {
                ...lvl,
                booths: lvl.booths.filter((b: any) => String(b.id) !== String(selectedId)),
              }
        )
      );
      clearSelection();
      markDirty();
      return;
    }

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : { ...lvl, elements: lvl.elements.filter((e) => e.id !== selectedId) }
      )
    );
    clearSelection();
    markDirty();
  }

  function statusColor(status: string) {
    if (status === "blocked") return "#94a3b8";
    if (status === "assigned") return "#8b5cf6";
    if (status === "paid") return "#ef4444";
    if (status === "reserved") return "#f59e0b";
    return "#22c55e";
  }

  function boothOverlay(b: any) {
    const boothKey = String(b?.id || "").trim();
    const statusRaw = String(b?.status || "available").toLowerCase().trim();
    const resv = boothKey
      ? diagramBoothStateById[boothKey] || boothReservations[boothKey]
      : undefined;
    const stateStatus = String(resv?.status || "").toLowerCase().trim();

    let effectiveStatus: "available" | "reserved" | "assigned" | "blocked" | "paid" =
      "available";

    if (statusRaw === "blocked") effectiveStatus = "blocked";
    else if (statusRaw === "paid") effectiveStatus = "paid";
    else if (statusRaw === "reserved") effectiveStatus = "reserved";
    else if (statusRaw === "assigned" || statusRaw === "occupied") effectiveStatus = "assigned";

    if (stateStatus === "blocked") {
      effectiveStatus = "blocked";
    } else if (stateStatus === "paid") {
      effectiveStatus = "paid";
    } else if (stateStatus === "reserved") {
      effectiveStatus = "reserved";
    } else if (stateStatus === "assigned") {
      effectiveStatus = "assigned";
    } else if (resv) {
      if (resv.paymentStatus === "paid") {
        effectiveStatus = "paid";
      } else if (
        (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") &&
        isFutureIso(resv.reservedUntil || null)
      ) {
        effectiveStatus = "reserved";
      }
    }

   const boothCompany = String((b as any)?.companyName || "").trim();

const rawOverlayName =
  boothCompany || String(resv?.vendorName || resv?.vendorEmail || "").trim();

const overlayName =
  effectiveStatus === "paid" && rawOverlayName
    ? `${rawOverlayName} 🔒`
    : rawOverlayName;

const overlayDetail = overlayName
  ? `${effectiveStatus.toUpperCase()} • ${overlayName}`
  : effectiveStatus.toUpperCase();

    return {
      boothKey,
      resv,
      effectiveStatus,
      overlayName,
      overlayDetail,
    };
  }

  function Legend({ color, label }: { color: string; label: string }) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          fontWeight: 900,
          color: "#334155",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: color,
            display: "inline-block",
          }}
        />
        {label}
      </span>
    );
  }

  const approvedApps = useMemo(() => {
    return apps.filter((a) => String(a?.status || "").toLowerCase() === "approved");
  }, [apps]);

  async function vendorSelectBooth(boothId: string) {
    if (!vendorMode) return;

    let effectiveAppId = vendorAppId;

    try {
      if (!effectiveAppId) {
        const draft = await vendorGetOrCreateDraftApplication(Number(eventId));
        const resolvedDraftId =
          (draft as any)?.id ??
          (draft as any)?.application?.id ??
          (draft as any)?.applicationId ??
          (draft as any)?.application_id ??
          (draft as any)?.data?.id ??
          (draft as any)?.data?.application?.id ??
          (draft as any)?.data?.applicationId ??
          (draft as any)?.data?.application_id;

        const numericId = Number(resolvedDraftId);
        if (!numericId || Number.isNaN(numericId)) {
          throw new Error(`Invalid draft application id: ${resolvedDraftId}`);
        }
        effectiveAppId = numericId;
      }

      const fresh = await vendorGetApplication({ applicationId: effectiveAppId });
      const status = String(fresh?.status || "draft").toLowerCase().trim();

      if (status === "submitted" || status === "approved") {
        window.alert("This application can no longer change booth selection.");
        return;
      }

      const boothObj = activeLevel.booths.find(
        (b: any) => String(b.id) === String(boothId)
      );

      const boothLabelSafe = boothObj?.label
        ? String(boothObj.label).trim()
        : String(boothId).trim();

      const boothPrice = Number(
  boothObj?.price ??
  boothObj?.meta?.price ??
  boothObj?.cost ??
  boothObj?.amount ??
  0
);

console.log("🔥 SELECTED BOOTH:", boothObj);
console.log("💰 BOOTH PRICE:", boothPrice);

const updated = await vendorUpdateApplication({
  applicationId: effectiveAppId,
  booth_id: boothLabelSafe,
  booth_price: boothPrice,
} as any);

      const savedBoothId = String(
        updated?.requested_booth_id || updated?.booth_id || boothLabelSafe
      ).trim();
      setVendorBoothId(savedBoothId);

      try {
        const result = await evaluateVendorSubmissionReadiness(effectiveAppId);
        setVendorRequirementsReady(!!result.ready);
        setVendorRequirementsReason(result.reason || "");
        setVendorAppStatus(String(result.app?.status || updated?.status || "draft").toLowerCase());
      } catch {
        setVendorAppStatus(String(updated?.status || "draft").toLowerCase());
      }

      const params = new URLSearchParams();
      params.set("appId", String(effectiveAppId));
      params.set("boothId", savedBoothId);

      navigate(
        `/vendor/events/${encodeURIComponent(String(eventId))}/requirements?${params.toString()}`
      );
    } catch (err: any) {
      window.alert(err?.message ? String(err.message) : "Failed to save booth selection.");
    }
  }

  async function assignVendorToSelectedBooth(appId: number) {
    if (isLocked) {
      window.alert("Paid — Booth selection is locked. Contact the organizer to make changes.");
      return;
    }

    if (!selectedBooth) return;
    const boothId = String((selectedBooth as any).id || "").trim();
    if (!boothId) return;

    const { resv, effectiveStatus } = boothOverlay(selectedBooth);

    if (effectiveStatus === "assigned") {
      window.alert("This booth is already paid/occupied.");
      return;
    }

    if (
      resv &&
      Number(resv.applicationId) !== Number(appId) &&
      (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") &&
      isFutureIso(resv.reservedUntil || null)
    ) {
      window.alert("This booth is currently reserved and not expired.");
      return;
    }

    try {
      setAssignBusy(true);
      await organizerReserveBooth(appId, boothId);
      await refreshReservations();
      window.alert("Booth assigned.");
    } catch (e: any) {
      window.alert(e?.message ? String(e.message) : "Reserve failed");
    } finally {
      setAssignBusy(false);
    }
  }

  function addLevel() {
    const id = uid("level");
    const n = levels.length + 1;
    setLevels((prev) => [...prev, { id, name: `Level ${n}`, booths: [], elements: [] }]);
    setActiveLevelId(id);
    markDirty();
  }

  function addQuickElement(t: ElementType) {
    const id = uid("el");
    const el: MapElement = {
      id,
      type: t,
      x: 80,
      y: 80,
      width: t === "venue" ? 700 : t === "street" ? 700 : 220,
      height: t === "venue" ? 440 : t === "street" ? 80 : 140,
      label: elementLabel(t),
    };

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : { ...lvl, elements: [...(lvl.elements || []), el] }
      )
    );

    setSelectedKind("element");
    setSelectedId(id);
    setDrawerOpen(true);
    setTab("elements");
    markDirty();
  }

  const gridBg = hideGrid
    ? "none"
    : `linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px),
       linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)`;

  if (!eventId) {
    return <div style={{ padding: 20, fontWeight: 900 }}>Missing eventId.</div>;
  }

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <style>{`
        @media print {
          button { display: none !important; }
          a { display: none !important; }
          input, select, textarea { display: none !important; }
          [data-print-hide="true"] { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; }
        }
      `}</style>

      {isPublished ? (
        <div
          style={{
            margin: "10px 16px 0",
            padding: "10px 12px",
            borderRadius: 14,
            border: layoutOverrideActive
              ? "1px solid rgba(59,130,246,0.35)"
              : "1px solid rgba(99,102,241,0.30)",
            background: layoutOverrideActive
              ? "rgba(59,130,246,0.10)"
              : "rgba(99,102,241,0.10)",
            color: layoutOverrideActive ? "#1d4ed8" : "#3730a3",
            fontSize: 13,
            fontWeight: 900,
          }}
        >
          {layoutOverrideActive
            ? "Published — Layout temporarily UNLOCKED for edits (auto-relocks)."
            : "Published — Layout is LOCKED. Assignments/reassignments are still allowed."}
        </div>
      ) : null}

      {isLocked ? (
        <div
          style={{
            margin: "10px 16px 0",
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(16,185,129,0.25)",
            background: "rgba(16,185,129,0.10)",
            color: "#065f46",
            fontSize: 13,
            fontWeight: 900,
          }}
        >
          Paid — Booth selection is locked. Contact the organizer to make changes.
        </div>
      ) : null}

      <div
        data-print-hide="true"
        style={{ flexShrink: 0, borderBottom: "1px solid #e6e8ee", background: "#fff" }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button onClick={() => window.history.back()} style={pill(false)}>
              ← <span>Back</span>
            </button>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 1000, lineHeight: 1.05 }}>
                Booth Map Editor
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginTop: 4 }}>
                Event {eventId}
                {pickerMode ? (
                  <>
                    {" "}• <span style={{ color: "#0f172a" }}>Assign mode</span>
                    {assignAppId ? <> • App #{assignAppId}</> : null}
                  </>
                ) : vendorMode ? (
                  <>
                    {" "}• <span style={{ color: "#0f172a" }}>Vendor view</span>
                    {vendorAppId ? <> • App #{vendorAppId}</> : null}
                    {vendorBoothId ? <> • Booth {vendorBoothId}</> : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button onClick={fitToScreen} style={pill(false)}>
              Fit
            </button>

            <button
              onClick={handlePrint}
              style={pill(false)}
              title="Print map (hides panels/grid)"
            >
              Print
            </button>

            {!pickerMode && !vendorMode ? (
              isPublished ? (
                <>
                  <span style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                    Published
                  </span>
                  {layoutOverrideActive ? (
                    <button onClick={relockLayoutNow} style={pill(true)} title="Relock layout now">
                      Relock
                    </button>
                  ) : (
                    <button
                      onClick={beginLayoutOverride}
                      style={pill(false)}
                      title="Temporarily unlock layout edits (auto-relocks)"
                    >
                      Unlock Layout
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await saveNow(false);
                        window.alert(
                          "Layout unpublished (event remains published on vendor side — no unpublish endpoint yet)."
                        );
                      } catch (e: any) {
                        console.error(e);
                        window.alert(e?.message ? String(e.message) : "Unpublish failed");
                      }
                    }}
                    style={pill(false)}
                    title="Unpublish (keeps current assignments)"
                  >
                    Unpublish
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await saveNow(true);
                      await publishEventNow();
                      window.alert("Event published.");
                    } catch (e: any) {
                      console.error(e);
                      window.alert(e?.message ? String(e.message) : "Publish failed");
                    }
                  }}
                  style={pill(true)}
                  title="Publish locks geometry but still allows booth assignment changes"
                >
                  Publish
                </button>
              )
            ) : null}

            <button
              onClick={() => setZoom((z) => +clamp(z - 0.1, 0.45, 2).toFixed(2))}
              style={pill(false)}
            >
              −
            </button>

            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                color: "#0f172a",
                width: 56,
                textAlign: "center",
              }}
            >
              {Math.round(zoom * 100)}%
            </div>

            <button
              onClick={() => setZoom((z) => +clamp(z + 0.1, 0.45, 2).toFixed(2))}
              style={pill(false)}
            >
              +
            </button>

            {!pickerMode && !vendorMode ? (
              <button onClick={() => { void saveNow(); }} style={pill(true)} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </button>
            ) : null}

            {vendorMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  onClick={() => {
                    if (!vendorAppId) {
                      navigate(`/vendor/events/${encodeURIComponent(String(eventId))}`);
                      return;
                    }

                    navigate(
                      `/vendor/events/${encodeURIComponent(
                        String(eventId)
                      )}/application/${encodeURIComponent(String(vendorAppId))}`
                    );
                  }}
                  style={{
                    ...pill(true),
                  }}
                  title="Return to your application"
                >
                  Return to Application
                </button>

                <div style={{ fontSize: 12, fontWeight: 900, color: "#b45309" }}>
                  Select a booth to update your application request.
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            padding: "0 16px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Legend color={statusColor("available")} label="Available" />
            <Legend color={statusColor("reserved")} label="Reserved" />
            <Legend color={statusColor("paid")} label="Paid" />
            <Legend color={statusColor("assigned")} label="Assigned/Occupied" />
            <Legend color={statusColor("blocked")} label="Blocked" />
            {reservationsError ? (
              <span
                style={{ marginLeft: 10, fontSize: 12, fontWeight: 900, color: "#b91c1c" }}
              >
                {reservationsError}
              </span>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 900,
                color: saveError ? "#b91c1c" : "#334155",
              }}
            >
              {saveError ? saveError : statusMsg}
            </span>

            {!pickerMode ? (
              <>
                <button onClick={() => setHideGrid((x) => !x)} style={pill(hideGrid)}>
                  Grid
                </button>
                <button onClick={() => setDrawerOpen((x) => !x)} style={pill(drawerOpen)}>
                  Panel
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div
          ref={canvasScrollerRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
            background: "#f8fafc",
            position: "relative",
          }}
          onMouseDown={() => {
            if (pickerMode) return;
            clearSelection();
          }}
        >
          <div
            style={{
              position: "relative",
              width: canvasW * zoom,
              height: canvasH * zoom,
              background: "#fff",
              backgroundImage: gridBg,
              backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
              backgroundPosition: "0 0",
            }}
          >
            {activeLevel.elements.map((el) => {
              const selected = selectedKind === "element" && selectedId === el.id;
              const isVenue = el.type === "venue";
              const isStreet = el.type === "street";

              return (
                <div
                  key={el.id}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedKind("element");
                    setSelectedId(el.id);
                    setDrawerOpen(true);
                    setTab("elements");
                    if (!pickerMode && !vendorMode && !isLocked) {
                      beginDrag("element", el.id, e);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: el.x * zoom,
                    top: el.y * zoom,
                    width: el.width * zoom,
                    height: el.height * zoom,
                    borderRadius: 14,
                    border: selected
                      ? "3px solid #2563eb"
                      : isVenue
                        ? "2px dashed rgba(37,99,235,0.55)"
                        : "2px dashed rgba(0,0,0,0.15)",
                    background: isStreet ? "rgba(15, 23, 42, 0.10)" : "rgba(15, 23, 42, 0.06)",
                    padding: 10,
                    boxSizing: "border-box",
                    cursor: pickerMode || vendorMode ? "default" : "move",                    userSelect: "none",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                    {el.label || elementLabel(el.type)}
                  </div>

                  {selected && !pickerMode && !vendorMode ? (
                    <div
                      onMouseDown={(e) => beginResize("element", el.id, e)}
                      style={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        width: 14,
                        height: 14,
                        borderRadius: 6,
                        background: "#0f172a",
                        cursor: "nwse-resize",
                      }}
                    />
                  ) : null}
                </div>
              );
            })}

            {activeLevel.booths.map((b) => {
              const selected = selectedKind === "booth" && selectedId === (b as any).id;
              const { boothKey, resv, effectiveStatus, overlayName, overlayDetail } =
                boothOverlay(b);
              const bg = statusColor(effectiveStatus);
              const unavailable = pickerMode
                ? effectiveStatus === "blocked" || effectiveStatus === "paid"
                : effectiveStatus === "blocked" ||
                  effectiveStatus === "paid" ||
                  effectiveStatus === "reserved" ||
                  effectiveStatus === "assigned";
              const price = Number((b as any).price || 0) || 0;
              const category = String((b as any).category || "");
              const holdCountdown =
                effectiveStatus === "reserved" &&
                resv?.reservedUntil &&
                (!pickerMode || Number(resv?.applicationId) !== Number(assignAppId || 0))
                  ? formatHoldCountdown(resv.reservedUntil)
                  : "";

              return (
                <div
                  key={(b as any).id}
                  title={overlayDetail || ""}
                  onClick={async (e) => {
                    if (!pickerMode && !vendorMode) return;
                    e.stopPropagation();

                    if (isLocked) {
                      window.alert(
                        "Paid — Booth selection is locked. Contact the organizer to make changes."
                      );
                      return;
                    }

                    if (effectiveStatus === "blocked" || resv?.paymentStatus === "paid") {
                      window.alert("That booth is not available.");
                      return;
                    }

                    if (
                      vendorMode &&
                      resv &&
                      (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") &&
                      isFutureIso(resv.reservedUntil || null)
                    ) {
                      window.alert("That booth is currently reserved and not expired.");
                      return;
                    }

                    try {
                      if (vendorMode) {
                        await vendorSelectBooth(boothKey);
                        return;
                      }

                      if (assignAppId) {
                        await organizerReserveBooth(assignAppId, boothKey);
                        markInviteReservation();
                      }

                      await refreshReservations();

                      navigate(
                        `/organizer/events/${encodeURIComponent(
                          String(eventId)
                        )}/applications?focusAppId=${encodeURIComponent(String(assignAppId || ""))}`
                      );
                    } catch (err: any) {
                      window.alert(err?.message ? String(err.message) : "Action failed");
                    }
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedKind("booth");
                    setSelectedId((b as any).id);
                    setDrawerOpen(true);
                    setTab("booths");
                    if (!pickerMode && !vendorMode && !isLocked) beginDrag("booth", (b as any).id, e);
                  }}
                  style={{
                    position: "absolute",
                    left: (b as any).x * zoom,
                    top: (b as any).y * zoom,
                    width: (b as any).width * zoom,
                    height: (b as any).height * zoom,
                    borderRadius: 18,
                    border: selected ? "3px solid #2563eb" : "2px solid rgba(0,0,0,0.08)",
                    background: bg,
                    cursor:
                      pickerMode || vendorMode
                        ? unavailable
                          ? "not-allowed"
                          : "pointer"
                        : "move",
                    opacity: unavailable ? 0.85 : 1,
                    userSelect: "none",
                    boxSizing: "border-box",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 1000,
                          color: "#0f172a",
                          lineHeight: 1.1,
                        }}
                      >
                        {(b as any).label || "Booth"}
                      </div>
                      {overlayName ? (
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 11,
                            fontWeight: 900,
                            color: "#334155",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {overlayName}
                        </div>
                      ) : null}
                    </div>

                    {effectiveStatus === "paid" ? (
                      <span style={{ fontSize: 11, fontWeight: 1000, color: "#991b1b" }}>
                        PAID
                      </span>
                    ) : null}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 900, color: "#475569" }}>
                      {category ? category : "—"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                      {price ? `$${price}` : ""}
                    </div>
                  </div>

                  {holdCountdown ? (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#7c2d12",
                        background: "rgba(255,255,255,0.75)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        alignSelf: "flex-start",
                      }}
                    >
                      Held • {holdCountdown}
                    </div>
                  ) : null}

                  {selected && !pickerMode && !vendorMode ? (
                    <div
                      onMouseDown={(e) => beginResize("booth", (b as any).id, e)}
                      style={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        width: 14,
                        height: 14,
                        borderRadius: 6,
                        background: "#0f172a",
                        cursor: "nwse-resize",
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {drawerOpen ? (
          <div
            data-print-hide="true"
            style={{
              width: 420,
              maxWidth: "44vw",
              minWidth: 340,
              borderLeft: "1px solid #e6e8ee",
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: 12,
                display: vendorMode ? "none" : "flex",
                gap: 8,
                flexWrap: "wrap",
                borderBottom: "1px solid #eef2f7",
              }}
            >
              {(["floors", "booths", "elements", "vendors", "reservations", "settings"] as const).map(
                (k) => (
                  <button key={k} style={pill(tab === k)} onClick={() => setTab(k)}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </button>
                )
              )}
            </div>

            <div style={{ padding: 12, overflow: "auto", minHeight: 0 }}>
              {tab === "floors" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Floors</div>
                    {!pickerMode && !vendorMode ? (
  <button style={pill(true)} onClick={addBooth}>
    + Add Booth
  </button>
) : null}
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {levels.map((lvl) => (
                      <button
                        key={lvl.id}
                        style={pill(activeLevelId === lvl.id)}
                        onClick={() => setActiveLevelId(lvl.id)}
                      >
                        {lvl.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === "booths" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Booths</div>
                    {!pickerMode && !vendorMode ? (
                      <button style={pill(true)} onClick={addBooth}>
                        + Add Booth
                      </button>
                    ) : null}
                  </div>

                  {selectedBooth ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>
                        Selected
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 1000,
                          color: "#0f172a",
                          marginTop: 4,
                        }}
                      >
                        {(selectedBooth as any).label || (selectedBooth as any).id}
                      </div>

                      {!pickerMode && !vendorMode ? (
                        <>
                          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                              Label
                              <input
                                value={String((selectedBooth as any).label || "")}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLevels((prev) =>
                                    prev.map((lvl) =>
                                      lvl.id !== activeLevelId
                                        ? lvl
                                        : {
                                            ...lvl,
                                            booths: lvl.booths.map((b: any) =>
                                              String(b.id) !== String((selectedBooth as any).id)
                                                ? b
                                                : { ...b, label: val }
                                            ),
                                          }
                                    )
                                  );
                                  markDirty();
                                }}
                                style={{
                                  width: "100%",
                                  marginTop: 6,
                                  padding: "10px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(15,23,42,0.12)",
                                  fontWeight: 800,
                                }}
                              />
                            </label>

                            <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                              Status
                              <select
                                value={String((selectedBooth as any).status || "available")}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLevels((prev) =>
                                    prev.map((lvl) =>
                                      lvl.id !== activeLevelId
                                        ? lvl
                                        : {
                                            ...lvl,
                                            booths: lvl.booths.map((b: any) =>
                                              String(b.id) !== String((selectedBooth as any).id)
                                                ? b
                                                : { ...b, status: val }
                                            ),
                                          }
                                    )
                                  );
                                  markDirty();
                                }}
                                style={{
                                  width: "100%",
                                  marginTop: 6,
                                  padding: "10px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(15,23,42,0.12)",
                                  fontWeight: 900,
                                }}
                              >
                                <option value="available">Available</option>
                                <option value="reserved">Reserved</option>
                                <option value="paid">Paid</option>
                                <option value="assigned">Assigned / Occupied</option>
                                <option value="blocked">Blocked</option>
                              </select>
                            </label>

                            <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                              Price
                              <input
                                type="number"
                                value={String((selectedBooth as any).price || 0)}
                                onChange={(e) => {
                                  const val = Number(e.target.value || 0);
                                  setLevels((prev) =>
                                    prev.map((lvl) =>
                                      lvl.id !== activeLevelId
                                        ? lvl
                                        : {
                                            ...lvl,
                                            booths: lvl.booths.map((b: any) =>
                                              String(b.id) !== String((selectedBooth as any).id)
                                                ? b
                                                : { ...b, price: val }
                                            ),
                                          }
                                    )
                                  );
                                  markDirty();
                                }}
                                style={{
                                  width: "100%",
                                  marginTop: 6,
                                  padding: "10px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(15,23,42,0.12)",
                                  fontWeight: 800,
                                }}
                              />
                            </label>

                            <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                              Category
                              <select
                                value={String((selectedBooth as any).category || "")}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLevels((prev) =>
                                    prev.map((lvl) =>
                                      lvl.id !== activeLevelId
                                        ? lvl
                                        : {
                                            ...lvl,
                                            booths: lvl.booths.map((b: any) =>
                                              String(b.id) !== String((selectedBooth as any).id)
                                                ? b
                                                : { ...b, category: val }
                                            ),
                                          }
                                    )
                                  );
                                  markDirty();
                                }}
                                style={{
                                  width: "100%",
                                  marginTop: 6,
                                  padding: "10px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(15,23,42,0.12)",
                                  fontWeight: 900,
                                }}
                              >
                                <option value="">—</option>
                                {CATEGORY_OPTIONS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                            <button
                              style={{
                                ...pill(false),
                                color: "#b91c1c",
                                borderColor: "rgba(185,28,28,0.25)",
                                background: "rgba(185,28,28,0.08)",
                              }}
                              onClick={deleteSelected}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: 12,
                              fontWeight: 900,
                              color: "#64748b",
                            }}
                          >
                            Picker mode: click a booth on the map to reserve for the selected
                            application.
                          </div>

                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              {approvedApps.map((a) => (
                                <button
                                  key={a.id}
                                  style={pill(false)}
                                  onClick={() => assignVendorToSelectedBooth(a.id)}
                                  disabled={assignBusy || isLocked}
                                >
                                  {pickVendorDisplayName(a) || a.vendor_email || `App #${a.id}`}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#64748b" }}
                    >
                      Select a booth to edit.
                    </div>
                  )}
                </div>
              ) : null}

              {tab === "elements" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Elements</div>
                    {!pickerMode && !vendorMode ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button style={pill(false)} onClick={() => addQuickElement("venue")}>
                          + Venue
                        </button>
                        <button style={pill(false)} onClick={() => addQuickElement("street")}>
                          + Street
                        </button>
                        <button style={pill(false)} onClick={() => addQuickElement("label")}>
                          + Label
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {selectedElement ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>
                        Selected
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 1000,
                          color: "#0f172a",
                          marginTop: 4,
                        }}
                      >
                        {selectedElement.label || elementLabel(selectedElement.type)}
                      </div>

                      {!pickerMode && !vendorMode ? (
                        <>
                          <label
                            style={{
                              display: "block",
                              marginTop: 10,
                              fontSize: 12,
                              fontWeight: 900,
                              color: "#334155",
                            }}
                          >
                            Label
                            <input
                              value={String(selectedElement.label || "")}
                              onChange={(e) => {
                                const val = e.target.value;
                                setLevels((prev) =>
                                  prev.map((lvl) =>
                                    lvl.id !== activeLevelId
                                      ? lvl
                                      : {
                                          ...lvl,
                                          elements: lvl.elements.map((el) =>
                                            el.id !== selectedElement.id
                                              ? el
                                              : { ...el, label: val }
                                          ),
                                        }
                                  )
                                );
                                markDirty();
                              }}
                              style={{
                                width: "100%",
                                marginTop: 6,
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.12)",
                                fontWeight: 800,
                              }}
                            />
                          </label>

                          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                            <button
                              style={{
                                ...pill(false),
                                color: "#b91c1c",
                                borderColor: "rgba(185,28,28,0.25)",
                                background: "rgba(185,28,28,0.08)",
                              }}
                              onClick={deleteSelected}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#64748b" }}
                    >
                      Select an element to edit.
                    </div>
                  )}
                </div>
              ) : null}

              {tab === "vendors" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 1000 }}>Approved Applications</div>
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {approvedApps.map((a) => {
                      const name = pickVendorDisplayName(a) || a.vendor_email || `App #${a.id}`;
                      const boothId = a.booth_id ? String(a.booth_id) : "";
                      const pay = parsePaymentStatus(a.payment_status);

                      return (
                        <div
                          key={a.id}
                          style={{
                            border: "1px solid rgba(15,23,42,0.10)",
                            borderRadius: 14,
                            padding: 10,
                          }}
                        >
                          <div style={{ fontWeight: 1000, fontSize: 13, color: "#0f172a" }}>
                            {name}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              fontWeight: 900,
                              color: "#64748b",
                            }}
                          >
                            App #{a.id} • {String(a.status || "").toUpperCase()} • {pay.toUpperCase()}
                          </div>
                          {boothId ? (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 12,
                                fontWeight: 900,
                                color: "#334155",
                              }}
                            >
                              Booth: {boothId}
                            </div>
                          ) : (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 12,
                                fontWeight: 900,
                                color: "#94a3b8",
                              }}
                            >
                              No booth selected
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!approvedApps.length ? (
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        No approved applications yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {tab === "reservations" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Reservations</div>
                    <button style={pill(false)} onClick={refreshReservations}>
                      Refresh
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {Object.keys(boothReservations).length ? (
                      (Object.entries(boothReservations) as Array<[string, AppReservationInfo]>).map(([boothId, r]) => {
                        const who = (
                          r.vendorName ||
                          r.vendorEmail ||
                          (r ? `App #${r.applicationId}` : "")
                        ).trim();

                        return (
                          <div
                            key={boothId}
                            style={{
                              border: "1px solid rgba(15,23,42,0.10)",
                              borderRadius: 14,
                              padding: 10,
                            }}
                          >
                            <div style={{ fontWeight: 1000, fontSize: 13, color: "#0f172a" }}>
                              {boothId} • {r.paymentStatus.toUpperCase()}
                            </div>
                            {who ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 12,
                                  fontWeight: 900,
                                  color: "#334155",
                                }}
                              >
                                {who}
                              </div>
                            ) : null}
                            {r.reservedUntil ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 12,
                                  fontWeight: 900,
                                  color: "#64748b",
                                }}
                              >
                                Until: {fmtWhen(r.reservedUntil)}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                        No active reservations.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {tab === "settings" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 1000 }}>Settings</div>

                  {!pickerMode && !vendorMode ? (
                    <>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                          Canvas width
                          <input
                            type="number"
                            value={canvasW}
                            onChange={(e) => {
                              setCanvasW(Number(e.target.value || 1200));
                              markDirty();
                            }}
                            style={{
                              width: "100%",
                              marginTop: 6,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 800,
                            }}
                          />
                        </label>

                        <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                          Canvas height
                          <input
                            type="number"
                            value={canvasH}
                            onChange={(e) => {
                              setCanvasH(Number(e.target.value || 800));
                              markDirty();
                            }}
                            style={{
                              width: "100%",
                              marginTop: 6,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 800,
                            }}
                          />
                        </label>

                        <label style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>
                          Grid size
                          <input
                            type="number"
                            value={gridSize}
                            onChange={(e) => {
                              setGridSize(Number(e.target.value || 20));
                              markDirty();
                            }}
                            style={{
                              width: "100%",
                              marginTop: 6,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 800,
                            }}
                          />
                        </label>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <button
                          style={{
                            ...pill(false),
                            color: "#b91c1c",
                            borderColor: "rgba(185,28,28,0.25)",
                            background: "rgba(185,28,28,0.08)",
                          }}
                          onClick={() => {
                            if (!window.confirm("Clear layout (this cannot be undone)?")) return;
                            setLevels([
                              { id: "level-1", name: "Level 1", booths: [], elements: [] },
                            ]);
                            setActiveLevelId("level-1");
                            clearSelection();
                            markDirty();
                          }}
                        >
                          Clear layout
                        </button>
                      </div>
                    </>
                  ) : (
                    <div
                      style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}
                    >
                      Settings are disabled in picker mode.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}








