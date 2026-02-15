// src/figma/pages/BoothMapEditor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getEventDiagram, saveEventDiagram } from "../components/api/diagram";
import type { Booth } from "../components/api/diagram";
import { readSession } from "../../auth/authStorage";

type BoothStatus =
  | "available"
  | "pending"
  | "booked"
  | "reserved"
  | "assigned"
  | "blocked";

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

type Level = {
  id: string;
  name: string;
  booths: Booth[];
  elements: MapElement[];
};

type DiagramDoc = {
  canvas?: { width?: number; height?: number; gridSize?: number };
  levels?: Array<{ id: string; name: string; booths: Booth[]; elements?: MapElement[] }>;
  booths?: Booth[]; // legacy
};

type DragState =
  | null
  | {
      kind: "booth" | "element";
      id: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    };

type ResizeState =
  | null
  | {
      kind: "booth" | "element";
      id: string;
      startClientX: number;
      startClientY: number;
      startW: number;
      startH: number;
    };

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

const SIZE_PRESETS = [
  { label: "Custom Size", w: null as number | null, h: null as number | null },
  { label: "10×10", w: 120, h: 80 },
  { label: "10×20", w: 160, h: 80 },
  { label: "20×20", w: 160, h: 120 },
  { label: "20×30", w: 200, h: 140 },
];

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function lsDiagramKey(eventId: string | number) {
  return `vendorconnect:diagram:${eventId}`;
}

function persistDiagramToLocal(
  eventId: string | number,
  diagram: any,
  version?: number | null
) {
  try {
    const payload = {
      event_id: eventId,
      version: version ?? 1,
      diagram,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(lsDiagramKey(eventId), JSON.stringify(payload));
  } catch (e) {
    console.warn("persistDiagramToLocal failed", e);
  }
}

/**
 * diagram.ts normalizes missing backend data to { elements: [], meta: {} }.
 * Detect "empty default" so we can treat as "no saved diagram".
 */
function isEmptyDiagramDoc(d: any): boolean {
  if (!d || typeof d !== "object") return true;

  if (Array.isArray(d.levels)) {
    if (d.levels.length === 0) return true;
    const hasAny = d.levels.some((lvl: any) => {
      const booths = Array.isArray(lvl?.booths) ? lvl.booths.length : 0;
      const els = Array.isArray(lvl?.elements) ? lvl.elements.length : 0;
      return booths > 0 || els > 0;
    });
    return !hasAny;
  }

  if (Array.isArray(d.booths)) return d.booths.length === 0;

  if (Array.isArray(d.elements) && d.elements.length === 0) return true;

  return false;
}

function statusColor(status: BoothStatus) {
  if (status === "available") return "#10b981";
  if (status === "pending") return "#f59e0b";
  if (status === "booked" || status === "assigned") return "#ef4444";
  if (status === "reserved") return "#fb923c";
  if (status === "blocked") return "#111827";
  return "#6b7280";
}

function elementStyle(type: MapElementType) {
  switch (type) {
    case "venue":
      return {
        bg: "rgba(99, 102, 241, 0.10)",
        border: "2px dashed rgba(99,102,241,0.55)",
      };
    case "street":
      return {
        bg: "rgba(107,114,128,0.18)",
        border: "2px solid rgba(107,114,128,0.35)",
      };
    case "stage":
      return {
        bg: "rgba(168,85,247,0.14)",
        border: "2px solid rgba(168,85,247,0.40)",
      };
    case "entrance":
      return {
        bg: "rgba(16,185,129,0.12)",
        border: "2px solid rgba(16,185,129,0.35)",
      };
    case "restrooms":
      return {
        bg: "rgba(59,130,246,0.12)",
        border: "2px solid rgba(59,130,246,0.35)",
      };
    case "info":
      return {
        bg: "rgba(234,179,8,0.14)",
        border: "2px solid rgba(234,179,8,0.35)",
      };
    case "foodcourt":
      return {
        bg: "rgba(244,63,94,0.12)",
        border: "2px solid rgba(244,63,94,0.35)",
      };
    default:
      return {
        bg: "rgba(0,0,0,0.06)",
        border: "2px solid rgba(0,0,0,0.10)",
      };
  }
}

function pill(bg = "#fff", fg = "#0f172a", disabled = false) {
  return {
    border: "1px solid #e5e7eb",
    background: disabled ? "#f3f4f6" : bg,
    color: disabled ? "#9ca3af" : fg,
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 900,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    lineHeight: 1,
    boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
  } as React.CSSProperties;
}

function iconPill(bg = "#fff", fg = "#0f172a") {
  return {
    ...pill(bg, fg),
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties;
}

function inputStyle() {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: "11px 12px",
    fontWeight: 900,
    fontSize: 14,
    outline: "none",
    background: "#fff",
  } as React.CSSProperties;
}

function labelStyle() {
  return {
    fontWeight: 1000,
    fontSize: 12,
    color: "#334155",
    marginTop: 6,
  } as React.CSSProperties;
}

async function readBody(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json().catch(() => null);
  return await res.text().catch(() => "");
}

function authHeaders() {
  const s = readSession();
  return {
    Accept: "application/json",
    ...(s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {}),
  } as Record<string, string>;
}

async function publishEventForVendors(eventId: string | number) {
  const id = encodeURIComponent(String(eventId));

  const candidates: Array<{ url: string; method: "POST" | "PATCH"; body?: any }> =
    [
      { url: `${API_BASE}/organizer/events/${id}/publish`, method: "POST" },
      {
        url: `${API_BASE}/organizer/events/${id}`,
        method: "PATCH",
        body: {
          layout_published: true,
          is_published: true,
          published: true,
          status: "published",
        },
      },
      {
        url: `${API_BASE}/events/${id}`,
        method: "PATCH",
        body: {
          layout_published: true,
          is_published: true,
          published: true,
          status: "published",
        },
      },
    ];

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const res = await fetch(c.url, {
        method: c.method,
        headers: {
          ...authHeaders(),
          ...(c.method === "PATCH" ? { "Content-Type": "application/json" } : {}),
        },
        body: c.method === "PATCH" ? JSON.stringify(c.body ?? {}) : undefined,
      });

      const body = await readBody(res);

      if (!res.ok) {
        const msg =
          (typeof body === "string" && body.trim()) ||
          (body &&
            typeof body === "object" &&
            (body.detail || body.message || JSON.stringify(body))) ||
          `Publish failed (${res.status})`;
        lastErr = new Error(`${c.method} ${c.url} → ${msg}`);
        continue;
      }

      return body;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Publish failed (no endpoint matched).");
}

export default function BoothMapEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId: routeEventId } = useParams<{ eventId: string }>();

  const queryEventId = useMemo(
    () => new URLSearchParams(location.search).get("eventId"),
    [location.search]
  );

  const eventId = (routeEventId || queryEventId || "").trim();

  const [hideGrid, setHideGrid] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [canvasW, setCanvasW] = useState(1200);
  const [canvasH, setCanvasH] = useState(800);
  const [gridSize, setGridSize] = useState(20);

  const [levels, setLevels] = useState<Level[]>([
    { id: "level-1", name: "Level 1", booths: [], elements: [] },
  ]);
  const [activeLevelId, setActiveLevelId] = useState("level-1");

  const [selectedKind, setSelectedKind] = useState<"booth" | "element" | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [drag, setDrag] = useState<DragState>(null);
  const [resize, setResize] = useState<ResizeState>(null);

  const [version, setVersion] = useState<number>(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [statusMsg, setStatusMsg] = useState<string>("Not saved yet");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [sizePreset, setSizePreset] = useState<string>("Custom Size");

  const stageRef = useRef<HTMLDivElement | null>(null);

  const activeLevel = useMemo(
    () => levels.find((l) => l.id === activeLevelId) || levels[0],
    [levels, activeLevelId]
  );

  const selectedBooth = useMemo(() => {
    if (selectedKind !== "booth" || !selectedId) return null;
    return (activeLevel.booths as any[]).find((b) => b.id === selectedId) || null;
  }, [activeLevel.booths, selectedId, selectedKind]);

  const selectedElement = useMemo(() => {
    if (selectedKind !== "element" || !selectedId) return null;
    return activeLevel.elements.find((e) => e.id === selectedId) || null;
  }, [activeLevel.elements, selectedId, selectedKind]);

  function markDirty() {
    setSaveState("idle");
    setStatusMsg("Not saved yet");
  }

  function clearSelection() {
    setSelectedKind(null);
    setSelectedId(null);
  }

  function fitToStage() {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 18;
    const availW = Math.max(200, rect.width - pad * 2);
    const availH = Math.max(200, rect.height - pad * 2);
    const z = Math.min(availW / canvasW, availH / canvasH);
    setZoom(+clamp(z, 0.45, 1.25).toFixed(2));
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
    const id = uid("booth");
    const n = nextBoothNumberForLevel(activeLevel);

    const b: Booth = {
      id,
      x: 140,
      y: 140,
      width: 120,
      height: 80,
      label: `Booth ${n}`,
      status: "available",
      category: "Food & Beverage" as any,
      price: 500 as any,
    } as any;

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id === activeLevelId ? { ...lvl, booths: [...lvl.booths, b] } : lvl
      )
    );
    setSelectedKind("booth");
    setSelectedId(id);
    setSizePreset("Custom Size");
    markDirty();
  }

  function addElement(type: MapElementType) {
    const id = uid(type);
    const el: MapElement = {
      id,
      type,
      x: 160,
      y: 170,
      width: 240,
      height: 140,
      label: type.toUpperCase(),
    };
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id === activeLevelId
          ? { ...lvl, elements: [...lvl.elements, el] }
          : lvl
      )
    );
    setSelectedKind("element");
    setSelectedId(id);
    markDirty();
  }

  function updateSelectedBooth(patch: Partial<Booth>) {
    if (!selectedBooth) return;
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : {
              ...lvl,
              booths: lvl.booths.map((b) =>
                b.id === (selectedBooth as any).id ? ({ ...b, ...patch } as any) : b
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

  function deleteSelected() {
    if (!selectedKind || !selectedId) return;
    if (selectedKind === "booth") {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id === activeLevelId
            ? { ...lvl, booths: lvl.booths.filter((b) => b.id !== selectedId) }
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

  // ---- Load ----
  useEffect(() => {
    if (!eventId) {
      setSaveState("error");
      setStatusMsg("Missing eventId");
      setSaveError("Route should be /organizer/events/:eventId/layout (or include ?eventId=...)");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await getEventDiagram(eventId);
        if (cancelled) return;

        const apiDiagram = (data?.diagram ?? null) as DiagramDoc | null;
        const apiHasRealLayout = apiDiagram && !isEmptyDiagramDoc(apiDiagram);

        if (!apiHasRealLayout) {
          const cached = safeJsonParse<any>(localStorage.getItem(lsDiagramKey(eventId)));
          if (cached?.diagram) {
            const dLocal = cached.diagram as DiagramDoc;

            setVersion(cached.version ?? 0);
            setCanvasW(dLocal.canvas?.width ?? 1200);
            setCanvasH(dLocal.canvas?.height ?? 800);
            setGridSize(dLocal.canvas?.gridSize ?? 20);

            if (dLocal.levels?.length) {
              setLevels(
                dLocal.levels.map((lvl) => ({
                  id: lvl.id,
                  name: lvl.name,
                  booths: lvl.booths || [],
                  elements: lvl.elements || [],
                }))
              );
              setActiveLevelId(dLocal.levels[0].id);
            } else if (dLocal.booths?.length) {
              setLevels([{ id: "level-1", name: "Level 1", booths: dLocal.booths, elements: [] }]);
              setActiveLevelId("level-1");
            }

            setSaveState("saved");
            setStatusMsg("Loaded (local draft)");
            setSaveError(null);
            setTimeout(() => fitToStage(), 0);
            return;
          }

          setSaveState("idle");
          setStatusMsg("New layout");
          setSaveError(null);
          setTimeout(() => fitToStage(), 0);
          return;
        }

        // API returned a real diagram
        const d = apiDiagram as DiagramDoc;

        persistDiagramToLocal(eventId, d, data?.version ?? 1);

        setVersion(data?.version ?? 0);
        setCanvasW(d.canvas?.width ?? 1200);
        setCanvasH(d.canvas?.height ?? 800);
        setGridSize(d.canvas?.gridSize ?? 20);

        if (d.levels?.length) {
          setLevels(
            d.levels.map((lvl) => ({
              id: lvl.id,
              name: lvl.name,
              booths: lvl.booths || [],
              elements: lvl.elements || [],
            }))
          );
          setActiveLevelId(d.levels[0].id);
        } else if (d.booths?.length) {
          setLevels([{ id: "level-1", name: "Level 1", booths: d.booths, elements: [] }]);
          setActiveLevelId("level-1");
        }

        setSaveState("saved");
        setStatusMsg("Loaded (API)");
        setSaveError(null);
        setTimeout(() => fitToStage(), 0);
      } catch (e: any) {
        if (cancelled) return;

        console.error(e);

        const cached = safeJsonParse<any>(localStorage.getItem(lsDiagramKey(eventId)));
        if (cached?.diagram) {
          const dLocal = cached.diagram as DiagramDoc;

          setVersion(cached.version ?? 0);
          setCanvasW(dLocal.canvas?.width ?? 1200);
          setCanvasH(dLocal.canvas?.height ?? 800);
          setGridSize(dLocal.canvas?.gridSize ?? 20);

          if (dLocal.levels?.length) {
            setLevels(
              dLocal.levels.map((lvl) => ({
                id: lvl.id,
                name: lvl.name,
                booths: lvl.booths || [],
                elements: lvl.elements || [],
              }))
            );
            setActiveLevelId(dLocal.levels[0].id);
          } else if (dLocal.booths?.length) {
            setLevels([{ id: "level-1", name: "Level 1", booths: dLocal.booths, elements: [] }]);
            setActiveLevelId("level-1");
          }

          setSaveState("saved");
          setStatusMsg("Loaded (local draft)");
          setSaveError(null);
          setTimeout(() => fitToStage(), 0);
          return;
        }

        setSaveState("error");
        setStatusMsg("Load failed");
        setSaveError(e?.message || "Failed to load");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ---- Drag / resize ----
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag && !resize) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      const dx = (clientX - (drag?.startClientX || resize?.startClientX || 0)) / zoom;
      const dy = (clientY - (drag?.startClientY || resize?.startClientY || 0)) / zoom;

      if (drag) {
        const nextX = clamp(drag.startX + dx, 0, canvasW - 10);
        const nextY = clamp(drag.startY + dy, 0, canvasH - 10);

        if (drag.kind === "booth") {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    booths: lvl.booths.map((b) =>
                      b.id === drag.id ? ({ ...b, x: nextX, y: nextY } as any) : b
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
                      el.id === drag.id ? { ...el, x: nextX, y: nextY } : el
                    ),
                  }
            )
          );
        }
        markDirty();
      } else if (resize) {
        const nextW = clamp(resize.startW + dx, 20, canvasW);
        const nextH = clamp(resize.startH + dy, 20, canvasH);

        if (resize.kind === "booth") {
          setLevels((prev) =>
            prev.map((lvl) =>
              lvl.id !== activeLevelId
                ? lvl
                : {
                    ...lvl,
                    booths: lvl.booths.map((b) =>
                      b.id !== resize.id
                        ? b
                        : ({
                            ...b,
                            width: clamp(nextW, 40, canvasW),
                            height: clamp(nextH, 40, canvasH),
                          } as any)
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
                      el.id !== resize.id
                        ? el
                        : {
                            ...el,
                            width: clamp(nextW, 60, canvasW),
                            height: clamp(nextH, 60, canvasH),
                          }
                    ),
                  }
            )
          );
        }
        markDirty();
      }
    }

    function onUp() {
      setDrag(null);
      setResize(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, resize, zoom, canvasW, canvasH, activeLevelId]);

  function beginDrag(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (kind === "booth") {
      const booth = activeLevel.booths.find((b) => b.id === id);
      if (!booth) return;
      setDrag({
        kind,
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: booth.x,
        startY: booth.y,
      });
    } else {
      const el = activeLevel.elements.find((x) => x.id === id);
      if (!el) return;
      setDrag({
        kind,
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: el.x,
        startY: el.y,
      });
    }
  }

  function beginResize(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (kind === "booth") {
      const booth = activeLevel.booths.find((b) => b.id === id);
      if (!booth) return;
      setResize({
        kind,
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startW: booth.width,
        startH: booth.height,
      });
    } else {
      const el = activeLevel.elements.find((x) => x.id === id);
      if (!el) return;
      setResize({
        kind,
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startW: el.width,
        startH: el.height,
      });
    }
  }

  async function doSave() {
    if (!eventId) return false;

    setSaveError(null);
    setSaveState("saving");
    setStatusMsg("Saving…");

    const doc: DiagramDoc = {
      canvas: { width: canvasW, height: canvasH, gridSize },
      levels: levels.map((l) => ({
        id: l.id,
        name: l.name,
        booths: l.booths,
        elements: l.elements,
      })),
    };

    // local draft first
    persistDiagramToLocal(eventId, doc, version || 1);

    try {
      const saved = await saveEventDiagram(eventId, doc, version || null);
      persistDiagramToLocal(eventId, doc, saved?.version ?? version ?? 1);
      setVersion(saved?.version ?? version);
      setSaveState("saved");
      setStatusMsg("Saved");
      return true;
    } catch (e: any) {
      console.error(e);
      setSaveState("error");
      setStatusMsg("Save failed");
      setSaveError(e?.message || "Save failed (check Network tab)");
      return false;
    }
  }

  async function finishPublish() {
    const ok = await doSave();
    if (!ok) return;

    try {
      setStatusMsg("Publishing…");
      await publishEventForVendors(eventId);
      setSaveState("saved");
      setStatusMsg("Published ✅");
    } catch (e: any) {
      setSaveState("error");
      setStatusMsg("Publish failed");
      setSaveError(e?.message || "Publish failed");
    }
  }

  const gridBg = hideGrid
    ? "none"
    : `linear-gradient(to right, #eef0f3 1px, transparent 1px),
       linear-gradient(to bottom, #eef0f3 1px, transparent 1px)`;

  // ✅ IMPORTANT: This is the reason your page was blank before — we must return UI.
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid #e6e8ee",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => window.history.back()} style={iconPill()}>
            ← <span>Back</span>
          </button>

          <div>
            <div style={{ fontSize: 26, fontWeight: 1000, lineHeight: 1.05 }}>
              Booth Map Editor
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#64748b",
                fontWeight: 800,
                marginTop: 4,
              }}
            >
              {eventId ? `Event ${eventId}` : "Event (missing id)"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => setHideGrid((v) => !v)}
            style={iconPill("#fff", "#0f172a")}
          >
            ⊞ <span>{hideGrid ? "Show Grid" : "Hide Grid"}</span>
          </button>
          <button
            onClick={doSave}
            disabled={saveState === "saving"}
            style={iconPill("#10b981", "#fff")}
          >
            💾 <span>{saveState === "saving" ? "Saving…" : "Save Layout"}</span>
          </button>
          <button
            onClick={finishPublish}
            disabled={saveState === "saving"}
            style={iconPill("#2563eb", "#fff")}
          >
            ✓ <span>Finish & Publish</span>
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          borderBottom: "1px solid #eef0f3",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <button onClick={addBooth} style={iconPill("#7c3aed", "#fff")}>
          ＋ <span>Add Booth</span>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 6 }}>
          <button
            onClick={() => setZoom((z) => clamp(+(z - 0.1).toFixed(2), 0.3, 2))}
            style={pill()}
          >
            🔍−
          </button>
          <div style={{ width: 64, textAlign: "center", fontWeight: 1000, color: "#0f172a" }}>
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={() => setZoom((z) => clamp(+(z + 0.1).toFixed(2), 0.3, 2))}
            style={pill()}
          >
            🔍+
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 10 }}>
          <input
            value={canvasW}
            onChange={(e) => {
              setCanvasW(+e.target.value || 0);
              markDirty();
            }}
            style={{ ...inputStyle(), width: 92, padding: "10px 12px", borderRadius: 12 }}
          />
          <span style={{ fontWeight: 900, color: "#64748b" }}>×</span>
          <input
            value={canvasH}
            onChange={(e) => {
              setCanvasH(+e.target.value || 0);
              markDirty();
            }}
            style={{ ...inputStyle(), width: 92, padding: "10px 12px", borderRadius: 12 }}
          />
          <span style={{ fontWeight: 900, color: "#64748b" }}>px</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <LegendItem color={statusColor("available")} label="Available" />
          <LegendItem color={statusColor("pending")} label="Pending" />
          <LegendItem color={statusColor("booked")} label="Booked" />

          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              color:
                saveState === "saved"
                  ? "#10b981"
                  : saveState === "error"
                  ? "#ef4444"
                  : "#94a3b8",
            }}
          >
            {statusMsg}
            {saveError ? ` — ${saveError}` : ""}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div
            style={{
              padding: "10px 18px",
              borderBottom: "1px solid #eef0f3",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            <select
              value={activeLevelId}
              onChange={(e) => {
                setActiveLevelId(e.target.value);
                clearSelection();
              }}
              style={{ ...inputStyle(), padding: "10px 12px", borderRadius: 999, width: 160 }}
            >
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                const id = uid("level");
                setLevels((prev) => [
                  ...prev,
                  { id, name: `Level ${prev.length + 1}`, booths: [], elements: [] },
                ]);
                setActiveLevelId(id);
                clearSelection();
                markDirty();
              }}
              style={pill("#f8fafc", "#0f172a")}
            >
              + Add Level
            </button>

            <button onClick={() => addElement("venue")} style={pill("#f8fafc", "#0f172a")}>
              + Venue Boundary
            </button>
            <button onClick={() => addElement("street")} style={pill("#f8fafc", "#0f172a")}>
              + Street
            </button>
            <button onClick={() => addElement("stage")} style={pill("#f8fafc", "#0f172a")}>
              + Stage
            </button>
            <button onClick={() => addElement("entrance")} style={pill("#f8fafc", "#0f172a")}>
              + Entrance
            </button>
            <button onClick={() => addElement("restrooms")} style={pill("#f8fafc", "#0f172a")}>
              + Restrooms
            </button>

            <button onClick={fitToStage} style={pill("#fff", "#0f172a")}>
              Fit to Screen
            </button>
          </div>

          <div ref={stageRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 18 }}>
            <div
              style={{
                height: "100%",
                width: "100%",
                overflow: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 18,
                background: "#fff",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: canvasW * zoom,
                  height: canvasH * zoom,
                  backgroundImage: gridBg,
                  backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                  backgroundPosition: "0 0",
                }}
                onMouseDown={() => clearSelection()}
              >
                {activeLevel.elements.map((el) => {
                  const st = elementStyle(el.type);
                  const selected = selectedKind === "element" && selectedId === el.id;

                  return (
                    <div
                      key={el.id}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedKind("element");
                        setSelectedId(el.id);
                        beginDrag("element", el.id, e);
                      }}
                      style={{
                        position: "absolute",
                        left: el.x * zoom,
                        top: el.y * zoom,
                        width: el.width * zoom,
                        height: el.height * zoom,
                        background: st.bg,
                        border: selected ? "3px solid #2563eb" : st.border,
                        borderRadius: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 10,
                        boxSizing: "border-box",
                        cursor: "move",
                        userSelect: "none",
                        boxShadow: selected ? "0 10px 24px rgba(37,99,235,0.18)" : "none",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 1000,
                          color: "#0f172a",
                          textAlign: "center",
                          lineHeight: 1.2,
                        }}
                      >
                        {el.label || el.type}
                      </div>

                      <div
                        onMouseDown={(e) => beginResize("element", el.id, e)}
                        style={{
                          position: "absolute",
                          right: 3,
                          bottom: 3,
                          width: 14,
                          height: 14,
                          borderRadius: 6,
                          background: "#0f172a",
                          cursor: "nwse-resize",
                        }}
                      />
                    </div>
                  );
                })}

                {activeLevel.booths.map((b) => {
                  const selected = selectedKind === "booth" && selectedId === b.id;
                  const status =
                    (String((b as any).status || "available").toLowerCase() as BoothStatus) ||
                    "available";
                  const isAvail = status === "available";
                  const base = statusColor(status);

                  const tileBg = isAvail ? base : "rgba(148,163,184,0.25)";
                  const border = selected
                    ? "3px solid #2563eb"
                    : isAvail
                    ? "2px solid rgba(16,185,129,0.55)"
                    : "2px solid rgba(148,163,184,0.55)";
                  const shadow = selected
                    ? "0 14px 30px rgba(37,99,235,0.22)"
                    : "0 3px 10px rgba(15,23,42,0.08)";

                  return (
                    <div
                      key={b.id}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedKind("booth");
                        setSelectedId(b.id);
                        beginDrag("booth", b.id, e);
                      }}
                      style={{
                        position: "absolute",
                        left: b.x * zoom,
                        top: b.y * zoom,
                        width: b.width * zoom,
                        height: b.height * zoom,
                        borderRadius: 16,
                        border,
                        background: tileBg,
                        cursor: "move",
                        userSelect: "none",
                        padding: 10,
                        boxSizing: "border-box",
                        overflow: "hidden",
                        boxShadow: shadow,
                        color: isAvail ? "#ffffff" : "#0f172a",
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
                        <div style={{ fontSize: 12, fontWeight: 1000, lineHeight: 1.1 }}>
                          {(b as any).label || "Booth"}
                        </div>
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: base,
                            flexShrink: 0,
                          }}
                        />
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 1000, lineHeight: 1 }}>
                        {typeof (b as any).price === "number" ? `$${(b as any).price}` : "$—"}
                      </div>

                      <div style={{ marginTop: 8, fontSize: 11, fontWeight: 900, opacity: isAvail ? 0.95 : 0.85 }}>
                        {(b as any).category || "Select category"}
                      </div>

                      <div
                        onMouseDown={(e) => beginResize("booth", b.id, e)}
                        style={{
                          position: "absolute",
                          right: 3,
                          bottom: 3,
                          width: 14,
                          height: 14,
                          borderRadius: 6,
                          background: isAvail ? "rgba(255,255,255,0.85)" : "#0f172a",
                          cursor: "nwse-resize",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: 420, borderLeft: "1px solid #eef0f3", padding: 18, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 1000, fontSize: 18, color: "#0f172a" }}>
              {selectedKind === "booth" ? "Booth Properties" : "Properties"}
            </div>
            <button onClick={() => clearSelection()} style={pill("#fff", "#0f172a")}>
              ✕
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            {renderProperties()}
          </div>
        </div>
      </div>
    </div>
  );

  function renderProperties() {
    if (!selectedKind || !selectedId) {
      return (
        <div style={{ color: "#64748b", fontWeight: 800, fontSize: 13, lineHeight: 1.35 }}>
          Select a booth or an element to edit.
          <div style={{ marginTop: 14 }}>
            <button onClick={addBooth} style={iconPill("#7c3aed", "#fff")}>
              ＋ <span>Add Booth</span>
            </button>
          </div>
        </div>
      );
    }

    if (selectedKind === "element" && selectedElement) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={deleteSelected} style={pill("#ef4444", "#fff")}>
            Delete Selected
          </button>

          <div style={labelStyle()}>Label</div>
          <input
            value={selectedElement.label || ""}
            onChange={(e) => updateSelectedElement({ label: e.target.value })}
            style={inputStyle()}
          />

          <div style={labelStyle()}>Type</div>
          <input
            value={selectedElement.type}
            disabled
            style={{ ...inputStyle(), background: "#f8fafc", color: "#64748b" }}
          />
        </div>
      );
    }

    if (selectedKind === "booth" && selectedBooth) {
      const booth = selectedBooth as any;

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={addBooth} style={iconPill("#7c3aed", "#fff")}>
              ＋ <span>Add Booth</span>
            </button>
            <button onClick={deleteSelected} style={pill("#ef4444", "#fff")}>
              Delete Selected
            </button>
          </div>

          <div style={labelStyle()}>Booth Label</div>
          <input
            value={booth.label || ""}
            onChange={(e) => updateSelectedBooth({ label: e.target.value } as any)}
            style={inputStyle()}
          />

          <div style={labelStyle()}>Category</div>
          <select
            value={booth.category || ""}
            onChange={(e) => updateSelectedBooth({ category: e.target.value } as any)}
            style={inputStyle()}
          >
            <option value="" disabled>
              Select category
            </option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div style={labelStyle()}>Size</div>
          <select
            value={sizePreset}
            onChange={(e) => {
              const next = e.target.value;
              setSizePreset(next);
              const preset = SIZE_PRESETS.find((p) => p.label === next);
              if (!preset) return;
              if (preset.w && preset.h) updateSelectedBooth({ width: preset.w, height: preset.h } as any);
            }}
            style={inputStyle()}
          >
            {SIZE_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>

          {sizePreset === "Custom Size" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={labelStyle()}>Width</div>
                <input
                  type="number"
                  value={typeof booth.width === "number" ? booth.width : ""}
                  onChange={(e) =>
                    updateSelectedBooth({
                      width: e.target.value === "" ? booth.width : Number(e.target.value),
                    } as any)
                  }
                  style={inputStyle()}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle()}>Height</div>
                <input
                  type="number"
                  value={typeof booth.height === "number" ? booth.height : ""}
                  onChange={(e) =>
                    updateSelectedBooth({
                      height: e.target.value === "" ? booth.height : Number(e.target.value),
                    } as any)
                  }
                  style={inputStyle()}
                />
              </div>
            </div>
          )}

          <div style={labelStyle()}>Price</div>
          <input
            type="number"
            value={typeof booth.price === "number" ? booth.price : ""}
            onChange={(e) =>
              updateSelectedBooth({
                price: e.target.value === "" ? undefined : Number(e.target.value),
              } as any)
            }
            style={inputStyle()}
          />

          <div style={labelStyle()}>Status</div>
          <select
            value={booth.status || "available"}
            onChange={(e) => updateSelectedBooth({ status: e.target.value } as any)}
            style={inputStyle()}
          >
            <option value="available">available</option>
            <option value="pending">pending</option>
            <option value="booked">booked</option>
            <option value="reserved">reserved</option>
            <option value="assigned">assigned</option>
            <option value="blocked">blocked</option>
          </select>
        </div>
      );
    }

    return null;
  }
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, color: "#334155" }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }} />
      <span>{label}</span>
    </div>
  );
}
