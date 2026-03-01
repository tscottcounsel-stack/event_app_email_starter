// src/figma/pages/BoothMapEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getEventDiagram, saveEventDiagram } from "../components/api/diagram";
import type { Booth } from "../components/api/diagram";
import { readSession } from "../../auth/authStorage";

/* ---------------- Types ---------------- */

type BoothStatus =
  | "available"
  | "pending"
  | "booked"
  | "reserved"
  | "assigned"
  | "blocked";

type ElementType =
  | "stage"
  | "restrooms"
  | "entrance"
  | "info"
  | "foodcourt"
  | "street"
  | "venue";

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
  paymentStatus: "unpaid" | "pending" | "paid" | "expired" | "unknown";
  reservedUntil?: string | null;
};

type OrganizerApp = {
  id: number;
  status?: string;
  vendor_email?: string;
  vendor_id?: number | string;
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

/* ---------------- Constants ---------------- */

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

const CATEGORY_OPTIONS = [
  "Food & Beverage",
  "Technology",
  "Art & Crafts",
  "Retail",
  "Entertainment",
  "Services",
  "Wellness",
  "Non-Profit",
];

const SIZE_PRESETS: Array<{ label: string; w: number | null; h: number | null }> =
  [
    { label: "Custom Size", w: null, h: null },
    { label: "10×10", w: 120, h: 80 },
    { label: "10×20", w: 160, h: 80 },
    { label: "20×20", w: 160, h: 120 },
    { label: "20×30", w: 200, h: 140 },
  ];

/* ---------------- Utils ---------------- */

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function lsDiagramKey(eventId: string | number) {
  return `vendorconnect:diagram:${eventId}`;
}

function persistDiagramToLocal(eventId: string | number, diagram: any, version?: number) {
  try {
    localStorage.setItem(
      lsDiagramKey(eventId),
      JSON.stringify({
        event_id: eventId,
        version: version ?? 1,
        diagram,
        updated_at: new Date().toISOString(),
      })
    );
  } catch {
    // ignore
  }
}

function isEmptyDiagramDoc(doc: any) {
  if (!doc || typeof doc !== "object") return true;

  if (Array.isArray(doc.levels)) {
    if (doc.levels.length === 0) return true;
    const hasAny = doc.levels.some(
      (l: any) =>
        (Array.isArray(l?.booths) ? l.booths.length : 0) > 0 ||
        (Array.isArray(l?.elements) ? l.elements.length : 0) > 0
    );
    return !hasAny;
  }

  if (Array.isArray(doc.booths)) return doc.booths.length === 0;
  return true;
}

function statusColor(status: BoothStatus) {
  if (status === "available") return "#10b981";
  if (status === "reserved") return "#fb923c";
  if (status === "pending") return "#f59e0b";
  if (status === "booked" || status === "assigned") return "#ef4444";
  if (status === "blocked") return "#111827";
  return "#6b7280";
}

function elementLabel(t: ElementType) {
  if (t === "stage") return "Stage";
  if (t === "restrooms") return "Restrooms";
  if (t === "entrance") return "Entrance";
  if (t === "info") return "Info";
  if (t === "foodcourt") return "Food Court";
  if (t === "street") return "Street";
  return "Venue Boundary";
}

function pill(active = false): React.CSSProperties {
  return {
    border: active ? "2px solid #2563eb" : "1px solid rgba(15,23,42,0.12)",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    background: "#fff",
    cursor: "pointer",
    userSelect: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
  };
}

function softCard(): React.CSSProperties {
  return {
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 16,
    background: "#fff",
  };
}

async function readJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json().catch(() => ({}));
  const text = await res.text().catch(() => "");
  return { detail: text };
}

/* ---------------- Policy 2 API ---------------- */

async function fetchOrganizerApplications(eventId: string): Promise<OrganizerApp[]> {
  const s = readSession();
  const token = s?.accessToken || "";
  const email = s?.email || "organizer@example.com";

  const res = await fetch(
    `${API_BASE}/organizer/events/${encodeURIComponent(eventId)}/applications`,
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
  return Array.isArray((data as any)?.applications) ? (data as any).applications : [];
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

  // Picker mode (Policy 2)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const assignAppIdRaw = (searchParams.get("assignAppId") || "").trim();
  const assignAction = (searchParams.get("assignAction") || "").trim().toLowerCase(); // reserve|change
  const assignAppId = assignAppIdRaw ? Number(assignAppIdRaw) : null;
  const pickerMode = Boolean(assignAppId && (assignAction === "reserve" || assignAction === "change"));

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

  // Tabs row (these are your "header tabs")
  const [tab, setTab] = useState<
    "floors" | "booths" | "elements" | "vendors" | "reservations" | "settings"
  >("booths");

  // Drawer selection
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedKind, setSelectedKind] = useState<"booth" | "element" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedBooth = useMemo(() => {
    if (selectedKind !== "booth" || !selectedId) return null;
    return activeLevel.booths.find((b) => (b as any).id === selectedId) || null;
  }, [activeLevel.booths, selectedKind, selectedId]);

  const selectedElement = useMemo(() => {
    if (selectedKind !== "element" || !selectedId) return null;
    return activeLevel.elements.find((e) => e.id === selectedId) || null;
  }, [activeLevel.elements, selectedKind, selectedId]);

  // Drag/resize
  const [drag, setDrag] = useState<
    null | { kind: "booth" | "element"; id: string; cx: number; cy: number }
  >(null);
  const [resize, setResize] = useState<
    null | { kind: "booth" | "element"; id: string; sw: number; sh: number; cx: number; cy: number }
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
  const [boothReservations, setBoothReservations] = useState<Record<string, AppReservationInfo>>({});
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
            paymentStatus: "paid",
            reservedUntil: until,
          };
          continue;
        }

        if ((pay === "unpaid" || pay === "pending") && isFutureIso(until)) {
          idx[boothId] = {
            applicationId: Number(a?.id),
            vendorEmail: a?.vendor_email ? String(a.vendor_email) : undefined,
            paymentStatus: pay,
            reservedUntil: until,
          };
        }
      }

      setBoothReservations(idx);
    } catch (e: any) {
      setReservationsError(e?.message ? String(e.message) : "Failed to load applications.");
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

        if (!apiHasLayout) {
          const cached = safeJsonParse<any>(localStorage.getItem(lsDiagramKey(eventId)));
          if (cached?.diagram) {
            const dLocal = cached.diagram as DiagramDoc;
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
            setTimeout(() => fitToScreen(), 0);
            return;
          }

          setLevels([{ id: "level-1", name: "Level 1", booths: [], elements: [] }]);
          setActiveLevelId("level-1");
          setStatusMsg("New layout");
          setTimeout(() => fitToScreen(), 0);
          return;
        }

        const d = apiDiagram as DiagramDoc;
        persistDiagramToLocal(eventId, d, (data as any)?.version ?? 1);

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

        setStatusMsg("Loaded");
        setTimeout(() => fitToScreen(), 0);
      } catch (e: any) {
        setSaveError(e?.message ? String(e.message) : "Load failed");
        setStatusMsg("Load failed");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Drag/resize move/up
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag && !resize) return;

      const dx = (e.clientX - (drag?.cx ?? resize?.cx ?? 0)) / zoom;
      const dy = (e.clientY - (drag?.cy ?? resize?.cy ?? 0)) / zoom;

      if (drag) {
        if (drag.kind === "booth") {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    booths: lvl.booths.map((b) =>
                      (b as any).id === drag.id
                        ? ({
                            ...(b as any),
                            x: clamp((b as any).x + dx, 0, canvasW - 10),
                            y: clamp((b as any).y + dy, 0, canvasH - 10),
                          } as any)
                        : b
                    ),
                  }
            )
          );
        } else {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    elements: lvl.elements.map((el) =>
                      el.id === drag.id
                        ? {
                            ...el,
                            x: clamp(el.x + dx, 0, canvasW - 10),
                            y: clamp(el.y + dy, 0, canvasH - 10),
                          }
                        : el
                    ),
                  }
            )
          );
        }
        markDirty();
        return;
      }

      if (resize) {
        const nw = clamp(resize.sw + dx, 30, canvasW);
        const nh = clamp(resize.sh + dy, 30, canvasH);

        if (resize.kind === "booth") {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    booths: lvl.booths.map((b) =>
                      (b as any).id === resize.id
                        ? ({ ...(b as any), width: nw, height: nh } as any)
                        : b
                    ),
                  }
            )
          );
        } else {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    elements: lvl.elements.map((el) =>
                      el.id === resize.id ? { ...el, width: nw, height: nh } : el
                    ),
                  }
            )
          );
        }
        markDirty();
      }
    }

    function onUp() {
      if (drag) setDrag(null);
      if (resize) setResize(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, resize, zoom, activeLevelId, canvasW, canvasH]);

  function beginDrag(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pickerMode) return;
    setDrag({ kind, id, cx: e.clientX, cy: e.clientY });
  }

  function beginResize(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pickerMode) return;

    if (kind === "booth") {
      const booth = activeLevel.booths.find((b) => (b as any).id === id) as any;
      if (!booth) return;
      setResize({ kind, id, sw: booth.width, sh: booth.height, cx: e.clientX, cy: e.clientY });
    } else {
      const el = activeLevel.elements.find((x) => x.id === id);
      if (!el) return;
      setResize({ kind, id, sw: el.width, sh: el.height, cx: e.clientX, cy: e.clientY });
    }
  }

  function nextBoothNumberForLevel(lvl: Level) {
    let maxN = 0;
    for (const b of lvl.booths as any[]) {
      const label = String((b as any).label || "");
      const m = label.match(/Booth\s+(\d+)/i);
      if (m?.[1]) maxN = Math.max(maxN, Number(m[1]));
    }
    return maxN + 1;
  }

  function addBooth() {
    const n = nextBoothNumberForLevel(activeLevel);
    const b: Booth = {
      id: uid("booth"),
      x: 140,
      y: 140,
      width: 120,
      height: 80,
      label: `Booth ${n}`,
      status: "available",
      category: "Food & Beverage",
      price: 500,
    } as any;

    setLevels((prev) =>
      prev.map((l) => (l.id === activeLevelId ? { ...l, booths: [...l.booths, b] } : l))
    );
    setSelectedKind("booth");
    setSelectedId((b as any).id);
    setDrawerOpen(true);
    setTab("booths");
    markDirty();
  }

  function addLevel() {
    const newId = uid("level");
    const idx = levels.length + 1;
    const lvl: Level = { id: newId, name: `Level ${idx}`, booths: [], elements: [] };
    setLevels((prev) => [...prev, lvl]);
    setActiveLevelId(newId);
    setTab("floors");
    markDirty();
  }

  function addQuickElement(type: ElementType) {
    if (pickerMode) return;

    // Sensible defaults that match your "header chips" expectation
    const base: MapElement = {
      id: uid("el"),
      type,
      x: 140,
      y: 120,
      width: 240,
      height: 140,
      label: elementLabel(type),
    };

    if (type === "venue") {
      base.x = 60;
      base.y = 60;
      base.width = Math.max(600, Math.min(1000, canvasW - 120));
      base.height = Math.max(420, Math.min(720, canvasH - 120));
      base.label = "Venue Boundary";
    }

    if (type === "street") {
      base.x = 60;
      base.y = Math.max(0, canvasH - 130);
      base.width = Math.max(600, Math.min(1000, canvasW - 120));
      base.height = 80;
      base.label = "Street";
    }

    if (type === "restrooms") {
      base.width = 180;
      base.height = 120;
      base.x = canvasW - 260;
      base.y = 120;
    }

    if (type === "stage") {
      base.width = 320;
      base.height = 160;
      base.x = canvasW - 420;
      base.y = canvasH - 320;
    }

    if (type === "entrance") {
      base.width = 220;
      base.height = 90;
      base.x = 120;
      base.y = canvasH - 220;
    }

    setLevels((prev) =>
      prev.map((l) => (l.id === activeLevelId ? { ...l, elements: [...l.elements, base] } : l))
    );
    setSelectedKind("element");
    setSelectedId(base.id);
    setDrawerOpen(true);
    setTab("elements");
    markDirty();
  }

  function deleteSelected() {
    if (!selectedKind || !selectedId) return;

    if (selectedKind === "booth") {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id === activeLevelId
            ? { ...lvl, booths: lvl.booths.filter((b) => (b as any).id !== selectedId) }
            : lvl
        )
      );
    } else {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id === activeLevelId
            ? { ...lvl, elements: lvl.elements.filter((e) => e.id !== selectedId) }
            : lvl
        )
      );
    }

    clearSelection();
    markDirty();
  }

  function updateSelectedBooth(patch: any) {
    if (!selectedBooth) return;
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : {
              ...lvl,
              booths: lvl.booths.map((b) =>
                (b as any).id === (selectedBooth as any).id ? ({ ...(b as any), ...patch } as any) : b
              ),
            }
      )
    );
    markDirty();
  }

  function updateSelectedElement(patch: Partial<MapElement>) {
    if (!selectedElement) return;
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : {
              ...lvl,
              elements: lvl.elements.map((e) =>
                e.id === selectedElement.id ? { ...e, ...patch } : e
              ),
            }
      )
    );
    markDirty();
  }

  async function saveAll() {
    if (!eventId) return false;
    try {
      setIsSaving(true);
      setStatusMsg("Saving…");
      setSaveError(null);

      const diagram: DiagramDoc = {
        canvas: { width: canvasW, height: canvasH, gridSize },
        levels: levels.map((lvl) => ({
          id: lvl.id,
          name: lvl.name,
          booths: lvl.booths || [],
          elements: lvl.elements || [],
        })),
      };

      const res = await saveEventDiagram(eventId, diagram as any);
      persistDiagramToLocal(eventId, diagram, (res as any)?.version ?? 1);

      setStatusMsg("Saved");
      return true;
    } catch (e: any) {
      setSaveError(e?.message ? String(e.message) : "Save failed");
      setStatusMsg("Save failed");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  const gridBg = hideGrid
    ? "none"
    : `linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px),
       linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)`;

  function boothOverlay(booth: Booth) {
    const boothKey = String((booth as any).id || "").trim();
    const resv = boothKey ? boothReservations[boothKey] : undefined;

    const baseStatus =
      (String((booth as any).status || "available").toLowerCase() as BoothStatus) || "available";

    let effectiveStatus: BoothStatus = baseStatus;
    let overlayNote = "";

    if (resv?.paymentStatus === "paid") {
      effectiveStatus = "assigned";
      overlayNote = resv.vendorEmail ? resv.vendorEmail : `App #${resv.applicationId}`;
    } else if (
      resv &&
      (resv.paymentStatus === "unpaid" || resv.paymentStatus === "pending") &&
      isFutureIso(resv.reservedUntil || null)
    ) {
      effectiveStatus = "reserved";
      const who = resv.vendorEmail ? resv.vendorEmail : `App #${resv.applicationId}`;
      overlayNote = `${who} • until ${fmtWhen(resv.reservedUntil || "")}`;
    }

    return { boothKey, resv, baseStatus, effectiveStatus, overlayNote };
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
        overflow: "hidden", // ✅ prevents double scroll
        background: "#fff",
      }}
    >
      {/* ---------- HEADER ---------- */}
      <div style={{ flexShrink: 0, borderBottom: "1px solid #e6e8ee", background: "#fff" }}>
        {/* Top row */}
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
                {pickerMode ? " • Picker Mode" : ""}
                {reservationsError ? ` • ${reservationsError}` : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={pill(false)} onClick={() => setHideGrid((v) => !v)}>
              {hideGrid ? "Show Grid" : "Hide Grid"}
            </button>
            <button style={pill(false)} onClick={saveAll} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save Layout"}
            </button>
            <button
              style={{
                ...pill(false),
                borderColor: "rgba(99,102,241,0.45)",
                background: "rgba(99,102,241,0.10)",
                color: "#3730a3",
              }}
              onClick={async () => {
                await saveAll();
                window.alert("Saved. (Publish wiring next)");
              }}
            >
              Finish & Publish
            </button>
          </div>
        </div>

        {/* Tabs row */}
        <div
          style={{
            padding: "0 16px 10px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button style={pill(tab === "floors")} onClick={() => setTab("floors")}>
            Floors
          </button>
          <button style={pill(tab === "booths")} onClick={() => setTab("booths")}>
            Booths
          </button>
          <button style={pill(tab === "elements")} onClick={() => setTab("elements")}>
            Elements
          </button>
          <button style={pill(tab === "vendors")} onClick={() => setTab("vendors")}>
            Vendors
          </button>
          <button style={pill(tab === "reservations")} onClick={() => setTab("reservations")}>
            Reservations
          </button>
          <button style={pill(tab === "settings")} onClick={() => setTab("settings")}>
            Settings
          </button>

          <div style={{ marginLeft: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Legend color={statusColor("available")} label="Available" />
            <Legend color={statusColor("reserved")} label="Reserved" />
            <Legend color={statusColor("assigned")} label="Paid/Occupied" />
            <Legend color={statusColor("blocked")} label="Blocked" />
          </div>

          <div
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 900,
              color: saveError ? "#b91c1c" : "#334155",
            }}
          >
            {saveError ? saveError : statusMsg}
          </div>
        </div>

        {/* Toolbar row */}
        <div
          style={{
            padding: "0 16px 10px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            style={{
              ...pill(false),
              borderColor: "rgba(99,102,241,0.45)",
              background: "rgba(99,102,241,0.12)",
              color: "#3730a3",
              padding: "10px 14px",
            }}
            onClick={addBooth}
            disabled={pickerMode}
          >
            + Add Booth
          </button>

          <button style={pill(false)} onClick={() => setZoom((z) => +clamp(z - 0.1, 0.45, 2.0).toFixed(2))}>
            −
          </button>
          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155", minWidth: 64, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </div>
          <button style={pill(false)} onClick={() => setZoom((z) => +clamp(z + 0.1, 0.45, 2.0).toFixed(2))}>
            +
          </button>
          <button style={pill(false)} onClick={fitToScreen}>
            Fit
          </button>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 10 }}>
            <input
              type="number"
              value={canvasW}
              onChange={(e) => {
                setCanvasW(Number(e.target.value || 1200));
                markDirty();
              }}
              style={{
                width: 86,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.12)",
                fontWeight: 900,
              }}
              disabled={pickerMode}
            />
            <span style={{ fontWeight: 1000, color: "#64748b" }}>×</span>
            <input
              type="number"
              value={canvasH}
              onChange={(e) => {
                setCanvasH(Number(e.target.value || 800));
                markDirty();
              }}
              style={{
                width: 86,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.12)",
                fontWeight: 900,
              }}
              disabled={pickerMode}
            />
            <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>px</span>
          </div>
        </div>

        {/* ✅ MISSING HEADER CHIPS ROW (RESTORED) */}
        <div
          style={{
            padding: "0 16px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {/* Level selector */}
          <select
            value={activeLevelId}
            onChange={(e) => setActiveLevelId(e.target.value)}
            style={{
              border: "1px solid rgba(15,23,42,0.12)",
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 900,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {levels.map((lvl) => (
              <option key={lvl.id} value={lvl.id}>
                {lvl.name}
              </option>
            ))}
          </select>

          <button style={pill(false)} onClick={addLevel} disabled={pickerMode}>
            + Add Level
          </button>

          <button style={pill(false)} onClick={() => addQuickElement("venue")} disabled={pickerMode}>
            + Venue Boundary
          </button>
          <button style={pill(false)} onClick={() => addQuickElement("street")} disabled={pickerMode}>
            + Street
          </button>
          <button style={pill(false)} onClick={() => addQuickElement("stage")} disabled={pickerMode}>
            + Stage
          </button>
          <button style={pill(false)} onClick={() => addQuickElement("entrance")} disabled={pickerMode}>
            + Entrance
          </button>
          <button style={pill(false)} onClick={() => addQuickElement("restrooms")} disabled={pickerMode}>
            + Restrooms
          </button>

          <button style={{ ...pill(false), marginLeft: 6 }} onClick={fitToScreen}>
            Fit to Screen
          </button>
        </div>
      </div>

      {/* ---------- BODY ---------- */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* Canvas scroller */}
        <div
          ref={canvasScrollerRef}
          style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", background: "#fff" }}
          onMouseDown={() => clearSelection()}
        >
          <div
            style={{
              position: "relative",
              width: canvasW * zoom,
              height: canvasH * zoom,
              background: gridBg,
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
                    if (!pickerMode) beginDrag("element", el.id, e);
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
                    background: isStreet
                      ? "rgba(15, 23, 42, 0.10)"
                      : "rgba(15, 23, 42, 0.06)",
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
              const { boothKey, resv, effectiveStatus, overlayNote } = boothOverlay(b);
              const bg = statusColor(effectiveStatus);

              const price = Number((b as any).price || 0) || 0;
              const category = String((b as any).category || "");

              return (
                <div
                  key={(b as any).id}
                  title={overlayNote || ""}
                  onClick={async (e) => {
                    if (!pickerMode) return;
                    e.stopPropagation();

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
                      if (assignAction === "reserve" && assignAppId) {
                        await organizerReserveBooth(assignAppId, boothKey);
                      }
                      await refreshReservations();
                      navigate(`/organizer/events/${encodeURIComponent(String(eventId))}/applications`);
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
                    if (!pickerMode) beginDrag("booth", (b as any).id, e);
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
                    overflow: "hidden",
                    boxShadow: selected
                      ? "0 0 0 4px rgba(37,99,235,0.22), 0 18px 40px rgba(37,99,235,0.22)"
                      : "0 4px 14px rgba(15,23,42,0.12)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 10,
                    textAlign: "center",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 1000 }}>
                    {String((b as any).label || "Booth")}
                  </div>
                  {price > 0 ? <div style={{ fontSize: 12, fontWeight: 900 }}>${price}</div> : null}
                  {category ? (
                    <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.95 }}>{category}</div>
                  ) : null}
                  {overlayNote ? (
                    <div style={{ marginTop: 6, fontSize: 10, fontWeight: 900, opacity: 0.95 }}>
                      {overlayNote}
                    </div>
                  ) : null}

                  {selected && !pickerMode ? (
                    <div
                      onMouseDown={(e) => beginResize("booth", (b as any).id, e)}
                      style={{
                        position: "absolute",
                        right: 10,
                        bottom: 10,
                        width: 14,
                        height: 14,
                        borderRadius: 6,
                        background: "rgba(15,23,42,0.85)",
                        cursor: "nwse-resize",
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right properties panel */}
        {drawerOpen ? (
          <div
            style={{
              width: 420,
              flexShrink: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid #e6e8ee",
              background: "#fff",
              overflow: "hidden", // ✅ panel scroll is internal only
            }}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "14px 14px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid #eef2f7",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 1000 }}>
                {selectedKind === "booth"
                  ? "Booth Properties"
                  : selectedKind === "element"
                  ? "Element Properties"
                  : "Properties"}
              </div>
              <button style={{ ...pill(false), padding: "6px 10px" }} onClick={() => setDrawerOpen(false)}>
                ✕
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
              {/* BOOTHS */}
              {tab === "booths" ? (
                <>
                  {!selectedBooth ? (
                    <div style={{ ...softCard(), padding: 14, color: "#64748b", fontWeight: 900, fontSize: 12 }}>
                      Select a booth on the canvas to edit its properties.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {/* Label */}
                      <div style={{ ...softCard(), padding: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Booth Label</div>
                        <input
                          value={String((selectedBooth as any).label || "")}
                          onChange={(e) => updateSelectedBooth({ label: e.target.value })}
                          style={{
                            marginTop: 8,
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid rgba(15,23,42,0.12)",
                            fontWeight: 900,
                            outline: "none",
                          }}
                          disabled={pickerMode}
                        />
                      </div>

                      {/* Position + size */}
                      <div style={{ ...softCard(), padding: 14 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>X</div>
                            <input
                              type="number"
                              value={Number((selectedBooth as any).x || 0)}
                              onChange={(e) => updateSelectedBooth({ x: Number(e.target.value || 0) })}
                              style={{
                                marginTop: 8,
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.12)",
                                fontWeight: 900,
                                outline: "none",
                              }}
                              disabled={pickerMode}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Y</div>
                            <input
                              type="number"
                              value={Number((selectedBooth as any).y || 0)}
                              onChange={(e) => updateSelectedBooth({ y: Number(e.target.value || 0) })}
                              style={{
                                marginTop: 8,
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.12)",
                                fontWeight: 900,
                                outline: "none",
                              }}
                              disabled={pickerMode}
                            />
                          </div>

                          <div>
                            <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Width (px)</div>
                            <input
                              type="number"
                              value={Number((selectedBooth as any).width || 0)}
                              onChange={(e) => updateSelectedBooth({ width: Number(e.target.value || 0) })}
                              style={{
                                marginTop: 8,
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.12)",
                                fontWeight: 900,
                                outline: "none",
                              }}
                              disabled={pickerMode}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Height (px)</div>
                            <input
                              type="number"
                              value={Number((selectedBooth as any).height || 0)}
                              onChange={(e) => updateSelectedBooth({ height: Number(e.target.value || 0) })}
                              style={{
                                marginTop: 8,
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(15,23,42,0.12)",
                                fontWeight: 900,
                                outline: "none",
                              }}
                              disabled={pickerMode}
                            />
                          </div>
                        </div>

                        {/* Price */}
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Price ($)</div>
                          <input
                            type="number"
                            value={Number((selectedBooth as any).price || 0)}
                            onChange={(e) => updateSelectedBooth({ price: Number(e.target.value || 0) })}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 900,
                              outline: "none",
                            }}
                            disabled={pickerMode}
                          />
                          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                            Vendors will see this price
                          </div>
                        </div>

                        {/* Category */}
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Category</div>
                          <select
                            value={String((selectedBooth as any).category || "Food & Beverage")}
                            onChange={(e) => updateSelectedBooth({ category: e.target.value })}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 900,
                              outline: "none",
                            }}
                            disabled={pickerMode}
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Size preset */}
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Size</div>
                          <select
                            value={(() => {
                              const w = Number((selectedBooth as any).width || 0);
                              const h = Number((selectedBooth as any).height || 0);
                              const preset = SIZE_PRESETS.find((p) => p.w === w && p.h === h);
                              return preset ? preset.label : "Custom Size";
                            })()}
                            onChange={(e) => {
                              const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
                              if (!p) return;
                              if (p.w != null && p.h != null) updateSelectedBooth({ width: p.w, height: p.h });
                            }}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 900,
                              outline: "none",
                            }}
                            disabled={pickerMode}
                          >
                            {SIZE_PRESETS.map((p) => (
                              <option key={p.label} value={p.label}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Status */}
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Status</div>
                          <select
                            value={String(((selectedBooth as any).status || "available")).toLowerCase()}
                            onChange={(e) => updateSelectedBooth({ status: e.target.value })}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 900,
                              outline: "none",
                            }}
                            disabled={pickerMode}
                          >
                            <option value="available">Available</option>
                            <option value="pending">Pending</option>
                            <option value="blocked">Blocked</option>
                          </select>
                        </div>

                        {/* Assign Vendor */}
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Assign Vendor</div>
                          <select
                            value="__none__"
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v || v === "__none__") return;
                              const appId = Number(v);
                              if (!Number.isFinite(appId)) return;
                              assignVendorToSelectedBooth(appId);
                              e.target.value = "__none__";
                            }}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(15,23,42,0.12)",
                              fontWeight: 900,
                              outline: "none",
                            }}
                            disabled={pickerMode || assignBusy}
                          >
                            <option value="__none__">No vendor assigned</option>
                            {approvedApps.map((a) => (
                              <option key={a.id} value={String(a.id)}>
                                {a.vendor_email ? a.vendor_email : `Approved App #${a.id}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          style={{
                            ...pill(false),
                            borderColor: "rgba(185,28,28,0.25)",
                            color: "#b91c1c",
                          }}
                          onClick={deleteSelected}
                          disabled={pickerMode}
                        >
                          ✕ Delete Booth
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              {/* ELEMENTS */}
              {tab === "elements" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {!selectedElement ? (
                    <div style={{ ...softCard(), padding: 14, color: "#64748b", fontWeight: 900, fontSize: 12 }}>
                      Select an element on the canvas to edit its properties.
                    </div>
                  ) : (
                    <div style={{ ...softCard(), padding: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 1000, color: "#334155" }}>Label</div>
                      <input
                        value={String(selectedElement.label || "")}
                        onChange={(e) => updateSelectedElement({ label: e.target.value })}
                        style={{
                          marginTop: 8,
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid rgba(15,23,42,0.12)",
                          fontWeight: 900,
                          outline: "none",
                        }}
                        disabled={pickerMode}
                      />

                      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                        <button
                          style={{
                            ...pill(false),
                            borderColor: "rgba(185,28,28,0.25)",
                            color: "#b91c1c",
                          }}
                          onClick={deleteSelected}
                          disabled={pickerMode}
                        >
                          Delete Element
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ width: 42, flexShrink: 0, borderLeft: "1px solid #e6e8ee", background: "#fff" }}>
            <button
              style={{
                margin: 10,
                width: 32,
                height: 32,
                borderRadius: 12,
                border: "1px solid rgba(15,23,42,0.12)",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 1000,
              }}
              onClick={() => setDrawerOpen(true)}
              title="Open properties"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
