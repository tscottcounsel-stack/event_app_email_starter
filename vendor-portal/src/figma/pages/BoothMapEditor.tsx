// src/figma/pages/BoothMapEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getEventDiagram, saveEventDiagram } from "../components/api/diagram";
import type { Booth } from "../components/api/diagram";

/* ---------------- Types ---------------- */

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
  // Publish/lock state is stored on the diagram so it persists per-event.
  // When published: geometry edits are locked, but assignment actions are still allowed.
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
  booths?: Booth[]; // legacy
  elements?: MapElement[]; // legacy
};

/* ---------------- Policy 2 overlay / picker mode ---------------- */

type AppReservationInfo = {
  applicationId: number;
  vendorEmail?: string;
  vendorName?: string;
  paymentStatus: "unpaid" | "pending" | "paid" | "expired" | "unknown";
  reservedUntil?: string | null;
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

/* ---------------- Constants ---------------- */

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

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

/* ---------------- Small Helpers ---------------- */

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

function isEmptyDiagramDoc(doc: DiagramDoc | null | undefined) {
  if (!doc) return true;
  const levels = Array.isArray(doc.levels) ? doc.levels : [];
  const legacyBooths = Array.isArray(doc.booths) ? doc.booths : [];
  if (levels.length) {
    return levels.every((l) => (l.booths?.length ?? 0) === 0 && (l.elements?.length ?? 0) === 0);
  }
  return legacyBooths.length === 0;
}

function lsDiagramKey(eventId: string) {
  return `event:${String(eventId)}:diagram`;
}

function readSession() {
  const s = safeJsonParse<any>(localStorage.getItem("session"));
  return s || null;
}

function pill(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: 900,
    fontSize: 12,
    border: active ? "1px solid rgba(99,102,241,0.40)" : "1px solid rgba(15,23,42,0.12)",
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

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
}

async function fetchOrganizerApplications(eventId: string): Promise<OrganizerApp[]> {
  const s = readSession();
  const token = s?.accessToken || "";
  const email = s?.email || "organizer@example.com";

  const res = await fetch(
    `${API_BASE}/organizer/events/${encodeURIComponent(String(eventId))}/applications`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-user-email": email,
        Accept: "application/json",
      },
    }
  );

  const data = await readJson(res);
  if (!res.ok) throw new Error(String((data as any)?.detail || "Failed to load applications"));
  return Array.isArray((data as any)?.applications)
    ? (data as any).applications
    : Array.isArray(data)
    ? data
    : [];
}

async function organizerReserveBooth(appId: number, boothId: string) {
  const s = readSession();
  const token = s?.accessToken || "";
  const email = s?.email || "organizer@example.com";

  const res = await fetch(
    `${API_BASE}/organizer/applications/${encodeURIComponent(String(appId))}/reserve-booth`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-user-email": email,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ booth_id: boothId, hold_hours: 48 }),
    }
  );

  const data = await readJson(res);
  if (!res.ok) throw new Error(String((data as any)?.detail || "Reserve failed"));
  return data;
}

/* ---------------- Component ---------------- */

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
  const pickerMode = Boolean(assignAppId && (assignAction === "reserve" || assignAction === "change"));

  /* ---------------- Publish / Lock + Print ---------------- */

  // Published locks geometry (move/resize/add/delete), but we still allow assignment changes when in picker mode.
  const [isPublished, setIsPublished] = useState<boolean>(false);

  // Temporary override to allow geometry edits while published (e.g., last-minute layout change).
  // We auto-relock after a short window to prevent accidental drift.
  const [layoutOverrideUntil, setLayoutOverrideUntil] = useState<number | null>(null);
  const layoutOverrideActive = useMemo(() => {
    if (!layoutOverrideUntil) return false;
    return Date.now() < layoutOverrideUntil;
  }, [layoutOverrideUntil]);

  const layoutLocked = Boolean(isPublished && !layoutOverrideActive && !pickerMode);

  // Printing: temporarily hide panels/grid and fit the canvas, then invoke browser print.
  const printSnapshotRef = useRef<{
    drawerOpen: boolean;
    hideGrid: boolean;
    zoom: number;
  } | null>(null);

  function beginLayoutOverride() {
    // 10 minute edit window (safe default)
    const mins = 10;
    setLayoutOverrideUntil(Date.now() + mins * 60 * 1000);
  }

  function relockLayoutNow() {
    setLayoutOverrideUntil(null);
  }

  function handlePrint() {
    // Save current UI state
    if (!printSnapshotRef.current) {
      printSnapshotRef.current = { drawerOpen, hideGrid, zoom };
    }

    // Make print clean: hide grid/panel and fit to screen
    setDrawerOpen(false);
    setHideGrid(true);

    // Fit before printing (next tick so DOM sizes settle)
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

  // Drawer selection
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

  // Drag/resize
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

  // Save state
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

  // Policy 2 overlays + apps list (Assign Vendor)
  const [apps, setApps] = useState<OrganizerApp[]>([]);

  // ✅ Paid lock (UX): if the currently-focused application is already PAID, prevent any booth changes.
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
  const [reservationsError, setReservationsError] = useState<string | null>(null);

  const refreshReservations = useCallback(async () => {
    if (!eventId) return;
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

        if (pay === "paid") {
          idx[boothId] = {
            applicationId: Number(a?.id),
            vendorEmail: a?.vendor_email ? String(a.vendor_email) : undefined,
            vendorName: pickVendorDisplayName(a),
            paymentStatus: "paid",
            reservedUntil: until,
          };
          continue;
        }

        if ((pay === "unpaid" || pay === "pending") && isFutureIso(until)) {
          idx[boothId] = {
            applicationId: Number(a?.id),
            vendorEmail: a?.vendor_email ? String(a.vendor_email) : undefined,
            vendorName: pickVendorDisplayName(a),
            paymentStatus: pay,
            reservedUntil: until,
          };
        }
      }

      setBoothReservations(idx);
    } catch (e: any) {
      setReservationsError(
        e?.message ? String(e.message) : "Failed to load applications."
      );
      setApps([]);
      setBoothReservations({});
    }
  }, [eventId]);

  useEffect(() => {
    refreshReservations();
  }, [refreshReservations]);

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

  // Load diagram
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await getEventDiagram(eventId);
        if (cancelled) return;

        const raw = ((data as any)?.diagram ?? (data as any) ?? null) as any;
        const apiDiagram = (raw ?? null) as DiagramDoc | null;
        const apiHasLayout = apiDiagram && !isEmptyDiagramDoc(apiDiagram);

        // Publish state (persisted in diagram)
        const publishedFlag = Boolean((apiDiagram as any)?.published ?? (apiDiagram as any)?.meta?.published);
        setIsPublished(publishedFlag);

        if (!apiHasLayout) {
          const cached = safeJsonParse<any>(localStorage.getItem(lsDiagramKey(eventId)));
          if (cached?.diagram) {
            const dLocal = cached.diagram as DiagramDoc;
            const publishedFlagLocal = Boolean((dLocal as any)?.published ?? (dLocal as any)?.meta?.published);
            setIsPublished(publishedFlagLocal);
            setCanvasW(dLocal.canvas?.width ?? 1200);
            setCanvasH(dLocal.canvas?.height ?? 800);
            setGridSize(dLocal.canvas?.gridSize ?? 20);

            if (dLocal.levels?.length) {
              setLevels(
                dLocal.levels.map((lvl) => ({
                  id: lvl.id,
                  name: lvl.name,
                  booths: Array.isArray(lvl.booths) ? lvl.booths : [],
                  elements: Array.isArray(lvl.elements) ? lvl.elements : [],
                }))
              );
              setActiveLevelId(dLocal.levels[0].id);
            } else if (Array.isArray(dLocal.booths)) {
              setLevels([
                {
                  id: "level-1",
                  name: "Level 1",
                  booths: dLocal.booths,
                  elements: Array.isArray(dLocal.elements) ? dLocal.elements : [],
                },
              ]);
              setActiveLevelId("level-1");
            }

            setStatusMsg("Loaded (local)");
            return;
          }

          setStatusMsg("Loaded (empty)");
          return;
        }

        // hydrate from API
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

        // cache
        localStorage.setItem(lsDiagramKey(eventId), JSON.stringify({ diagram: d }));
        setStatusMsg("Loaded");
      } catch (e: any) {
        setSaveError(e?.message ? String(e.message) : "Failed to load diagram.");
        setStatusMsg("Load failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Drag handlers
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
                  String(b.id) !== String(id)
                    ? b
                    : { ...b, width: nw, height: nh }
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
      setResize({ kind, id, sw: Number(b.width || 100), sh: Number(b.height || 80), cx: e.clientX, cy: e.clientY });
      return;
    }
    const el = activeLevel.elements.find((x) => x.id === id);
    if (!el) return;
    setResize({ kind, id, sw: el.width, sh: el.height, cx: e.clientX, cy: e.clientY });
  }

  async function saveNow() {
    if (!eventId) return;
    try {
      setIsSaving(true);
      setSaveError(null);
      setStatusMsg("Saving…");

      const doc: DiagramDoc = {
        version: 2,
        published: isPublished,
        meta: { published: isPublished },
        canvas: { width: canvasW, height: canvasH, gridSize },
        levels: levels.map((lvl) => ({
          id: lvl.id,
          name: lvl.name,
          booths: lvl.booths,
          elements: lvl.elements,
        })),
      };

      await saveEventDiagram(eventId, doc);
      localStorage.setItem(lsDiagramKey(eventId), JSON.stringify({ diagram: doc }));
      setStatusMsg("Saved");
    } catch (e: any) {
      setSaveError(e?.message ? String(e.message) : "Save failed");
      setStatusMsg("Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function publishEventNow() {
    if (!eventId) return;
    const s = readSession();
    const token = (s as any)?.access_token || (s as any)?.accessToken || (s as any)?.token;
    const email = (s as any)?.email || "organizer@example.com";

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
            : { ...lvl, booths: lvl.booths.filter((b: any) => String(b.id) !== String(selectedId)) }
        )
      );
      clearSelection();
      markDirty();
      return;
    }
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, elements: lvl.elements.filter((e) => e.id !== selectedId) }
      )
    );
    clearSelection();
    markDirty();
  }

  function statusColor(status: string) {
    // Solid fills (requested): easy to read, print-friendly.
    if (status === "blocked") return "#94a3b8"; // slate-400
    if (status === "assigned") return "#8b5cf6"; // violet-500
    if (status === "paid") return "#10b981"; // emerald-500
    if (status === "reserved") return "#f59e0b"; // amber-500
    return "#22c55e"; // green-500 (available)
  }

  function boothOverlay(b: any) {
    const boothKey = String(b?.id || "").trim();
    const statusRaw = String(b?.status || "available").toLowerCase();

    const resv = boothKey ? boothReservations[boothKey] : undefined;

    // Effective status for coloring
    let effectiveStatus: "available" | "reserved" | "assigned" | "blocked" | "paid" = "available";
    if (statusRaw === "blocked") effectiveStatus = "blocked";
    if (resv?.paymentStatus === "paid") effectiveStatus = "paid";
    else if (resv && (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") && isFutureIso(resv.reservedUntil || null))
      effectiveStatus = "reserved";
    else if (statusRaw === "assigned") effectiveStatus = "assigned";

    const overlayName = resv?.vendorName || resv?.vendorEmail || "";
    const overlayDetail = resv
      ? `${overlayName ? overlayName + " • " : ""}${resv.paymentStatus.toUpperCase()}${
          resv.reservedUntil ? ` • until ${fmtWhen(resv.reservedUntil)}` : ""
        }`
      : "";

    return { boothKey, resv, effectiveStatus, overlayName, overlayDetail };
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

  const [assignBusy, setAssignBusy] = useState(false);

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
      window.alert("Reserved.");
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
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff" }}>
      <style>{`
        @media print {
          /* Hide controls, keep the canvas printable */
          button { display: none !important; }
          a { display: none !important; }
          input, select, textarea { display: none !important; }
          /* Hide drawer/panels */
          [data-print-hide="true"] { display: none !important; }
          /* Ensure canvas uses full page */
          html, body { height: auto !important; overflow: visible !important; }
        }
      `}</style>

      {/* ---------- HEADER ---------- */}
      {isPublished ? (
        <div
          style={{
            margin: "10px 16px 0",
            padding: "10px 12px",
            borderRadius: 14,
            border: layoutOverrideActive ? "1px solid rgba(59,130,246,0.35)" : "1px solid rgba(99,102,241,0.30)",
            background: layoutOverrideActive ? "rgba(59,130,246,0.10)" : "rgba(99,102,241,0.10)",
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

      <div data-print-hide="true" style={{ flexShrink: 0, borderBottom: "1px solid #e6e8ee", background: "#fff" }}>
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button onClick={() => window.history.back()} style={pill(false)}>
              ← <span>Back</span>
            </button>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 1000, lineHeight: 1.05 }}>Booth Map Editor</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginTop: 4 }}>
                Event {eventId}
                {pickerMode ? (
                  <>
                    {" "}
                    • <span style={{ color: "#0f172a" }}>Picker mode</span>{" "}
                    {assignAppId ? <>• App #{assignAppId}</> : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={fitToScreen} style={pill(false)}>
              Fit
            </button>

            <button onClick={handlePrint} style={pill(false)} title="Print map (hides panels/grid)">
              Print
            </button>

            {!pickerMode ? (
              isPublished ? (
                <>
                  <span style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>Published</span>
                  {layoutOverrideActive ? (
                    <button onClick={relockLayoutNow} style={pill(true)} title="Relock layout now">
                      Relock
                    </button>
                  ) : (
                    <button onClick={beginLayoutOverride} style={pill(false)} title="Temporarily unlock layout edits (auto-relocks)">
                      Unlock Layout
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        setIsPublished(false);
                        await saveNow();
                        window.alert("Layout unpublished (event remains published on vendor side — no unpublish endpoint yet).");
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
                      setIsPublished(true);

                      // 1) Save layout (diagram)
                      await saveNow();

                      // 2) Publish event record (controls vendor visibility + organizer dashboard status)
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
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", width: 56, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={() => setZoom((z) => +clamp(z + 0.1, 0.45, 2).toFixed(2))}
              style={pill(false)}
            >
              +
            </button>

            {!pickerMode ? (
              <button onClick={saveNow} style={pill(true)} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Legend color={statusColor("available")} label="Available" />
            <Legend color={statusColor("reserved")} label="Reserved" />
            <Legend color={statusColor("paid")} label="Paid" />
            <Legend color={statusColor("assigned")} label="Assigned/Occupied" />
            <Legend color={statusColor("blocked")} label="Blocked" />
            {reservationsError ? (
              <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 900, color: "#b91c1c" }}>
                {reservationsError}
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: saveError ? "#b91c1c" : "#334155" }}>
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

      {/* ---------- BODY ---------- */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* Canvas */}
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
            {/* Elements */}
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
                    if (!pickerMode && !isLocked) beginDrag("element", el.id, e);
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
                    cursor: pickerMode ? "default" : "move",
                    userSelect: "none",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                    {el.label || elementLabel(el.type)}
                  </div>

                  {selected && !pickerMode ? (
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

            {/* Booths */}
            {activeLevel.booths.map((b) => {
              const selected = selectedKind === "booth" && selectedId === (b as any).id;
              const { boothKey, resv, effectiveStatus, overlayName, overlayDetail } = boothOverlay(b);
              const bg = statusColor(effectiveStatus);

              const price = Number((b as any).price || 0) || 0;
              const category = String((b as any).category || "");

              return (
                <div
                  key={(b as any).id}
                  title={overlayDetail || ""}
                  onClick={async (e) => {
                    if (!pickerMode) return;
                    e.stopPropagation();

                    if (isLocked) {
                      window.alert("Paid — Booth selection is locked. Contact the organizer to make changes.");
                      return;
                    }

                    if (effectiveStatus === "blocked" || resv?.paymentStatus === "paid") {
                      window.alert("That booth is not available.");
                      return;
                    }
                    if (
                      resv &&
                      (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") &&
                      isFutureIso(resv.reservedUntil || null)
                    ) {
                      window.alert("That booth is currently reserved and not expired.");
                      return;
                    }

                    try {
                      if ((assignAction === "reserve" || assignAction === "change") && assignAppId) {
                        await organizerReserveBooth(assignAppId, boothKey);
                      }
                      await refreshReservations();

                      // ✅ Return to Applications and focus the app row
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
                    if (!pickerMode && !isLocked) beginDrag("booth", (b as any).id, e);
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
                    cursor: pickerMode ? "pointer" : "move",
                    userSelect: "none",
                    boxSizing: "border-box",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 1000, color: "#0f172a", lineHeight: 1.1 }}>
                        {(b as any).label || "Booth"}
                      </div>
                      {overlayName ? (
                        <div style={{ marginTop: 3, fontSize: 11, fontWeight: 900, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {overlayName}
                        </div>
                      ) : null}
                    </div>

                    {effectiveStatus === "paid" ? (
                      <span style={{ fontSize: 11, fontWeight: 1000, color: "#065f46" }}>PAID</span>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "#475569" }}>
                      {category ? category : "—"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                      {price ? `$${price}` : ""}
                    </div>
                  </div>

                  {selected && !pickerMode ? (
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

        {/* Drawer */}
        {drawerOpen ? (
          <div data-print-hide="true"
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
            {/* Drawer tabs */}
            <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid #eef2f7" }}>
              {(["floors", "booths", "elements", "vendors", "reservations", "settings"] as const).map((k) => (
                <button
                  key={k}
                  style={pill(tab === k)}
                  onClick={() => setTab(k)}
                >
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>

            {/* Drawer content */}
            <div style={{ padding: 12, overflow: "auto", minHeight: 0 }}>
              {/* Floors */}
              {tab === "floors" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Floors</div>
                    {!pickerMode ? (
                      <button style={pill(true)} onClick={addLevel}>
                        + Add Floor
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

              {/* Booths */}
              {tab === "booths" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Booths</div>
                    {!pickerMode ? (
                      <button style={pill(true)} onClick={addBooth}>
                        + Add Booth
                      </button>
                    ) : null}
                  </div>

                  {selectedBooth ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>Selected</div>
                      <div style={{ fontSize: 14, fontWeight: 1000, color: "#0f172a", marginTop: 4 }}>
                        {(selectedBooth as any).label || (selectedBooth as any).id}
                      </div>

                      {!pickerMode ? (
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
                                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
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
                                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 900 }}
                              >
                                <option value="">—</option>
                                {CATEGORY_OPTIONS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
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
                                style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
                              />
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
                          <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                            Picker mode: click a booth on the map to reserve for the selected application.
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
                    <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                      Select a booth to edit.
                    </div>
                  )}
                </div>
              ) : null}

              {/* Elements */}
              {tab === "elements" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Elements</div>
                    {!pickerMode ? (
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
                      <div style={{ fontSize: 12, fontWeight: 1000, color: "#64748b" }}>Selected</div>
                      <div style={{ fontSize: 14, fontWeight: 1000, color: "#0f172a", marginTop: 4 }}>
                        {selectedElement.label || elementLabel(selectedElement.type)}
                      </div>

                      {!pickerMode ? (
                        <>
                          <label style={{ display: "block", marginTop: 10, fontSize: 12, fontWeight: 900, color: "#334155" }}>
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
                                            el.id !== selectedElement.id ? el : { ...el, label: val }
                                          ),
                                        }
                                  )
                                );
                                markDirty();
                              }}
                              style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
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
                    <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                      Select an element to edit.
                    </div>
                  )}
                </div>
              ) : null}

              {/* Vendors */}
              {tab === "vendors" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 1000 }}>Approved Applications</div>
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {approvedApps.map((a) => {
                      const name = pickVendorDisplayName(a) || a.vendor_email || `App #${a.id}`;
                      const boothId = a.booth_id ? String(a.booth_id) : "";
                      const pay = parsePaymentStatus(a.payment_status);
                      return (
                        <div key={a.id} style={{ border: "1px solid rgba(15,23,42,0.10)", borderRadius: 14, padding: 10 }}>
                          <div style={{ fontWeight: 1000, fontSize: 13, color: "#0f172a" }}>{name}</div>
                          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
                            App #{a.id} • {String(a.status || "").toUpperCase()} • {pay.toUpperCase()}
                          </div>
                          {boothId ? (
                            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: "#334155" }}>
                              Booth: {boothId}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: "#94a3b8" }}>
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

              {/* Reservations */}
              {tab === "reservations" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 1000 }}>Reservations</div>
                    <button style={pill(false)} onClick={refreshReservations}>
                      Refresh
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {Object.keys(boothReservations).length ? (
                      Object.entries(boothReservations).map(([boothId, r]) => {
                        const who = (r.vendorName || r.vendorEmail || (r ? `App #${r.applicationId}` : "")).trim();
                        return (
                          <div key={boothId} style={{ border: "1px solid rgba(15,23,42,0.10)", borderRadius: 14, padding: 10 }}>
                            <div style={{ fontWeight: 1000, fontSize: 13, color: "#0f172a" }}>
                              {boothId} • {r.paymentStatus.toUpperCase()}
                            </div>
                            {who ? (
                              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: "#334155" }}>{who}</div>
                            ) : null}
                            {r.reservedUntil ? (
                              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
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

              {/* Settings */}
              {tab === "settings" ? (
                <div style={{ ...softCard(), padding: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 1000 }}>Settings</div>

                  {!pickerMode ? (
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
                            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
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
                            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
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
                            style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.12)", fontWeight: 800 }}
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
                            setLevels([{ id: "level-1", name: "Level 1", booths: [], elements: [] }]);
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
                    <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
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
