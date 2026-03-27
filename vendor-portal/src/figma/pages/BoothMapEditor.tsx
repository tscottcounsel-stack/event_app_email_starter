// src/figma/pages/BoothMapEditor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession as readAuthSession } from "../../auth/authStorage";
import { getEventDiagram, saveEventDiagram } from "../components/api/diagram";
import type { Booth } from "../components/api/diagram";

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
  booths: BoothLike[];
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
    booths: BoothLike[];
    elements?: MapElement[];
  }>;
  booths?: BoothLike[];
  elements?: MapElement[];
};

type BoothLike = Booth & {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  price?: number;
  status?: string;
  category?: string;
  companyName?: string;
  notes?: string;
};

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

const CATEGORY_OPTIONS = [
  "Food & Beverage",
  "Tech",
  "Art",
  "Beauty",
  "Home",
  "Services",
  "Clothing",
  "Accessories",
  "Other",
];

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "paid", label: "Paid" },
  { value: "assigned", label: "Assigned / Occupied" },
  { value: "blocked", label: "Blocked" },
];

const PRESETS = {
  standard: { width: 140, height: 110 },
  compact: { width: 110, height: 90 },
  premium: { width: 180, height: 130 },
  island: { width: 220, height: 150 },
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 10px 24px rgba(2,6,23,0.06)",
  };
}

function statusColor(status?: string) {
  const s = String(status || "available").toLowerCase().trim();
  if (s === "blocked") return "#94a3b8";
  if (s === "assigned") return "#8b5cf6";
  if (s === "paid") return "#ef4444";
  if (s === "reserved") return "#f59e0b";
  return "#22c55e";
}

function lsDiagramKey(eventId: string) {
  return `event:${String(eventId)}:diagram`;
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

  const [canvasW, setCanvasW] = useState(1200);
  const [canvasH, setCanvasH] = useState(800);
  const [gridSize, setGridSize] = useState(20);
  const [hideGrid, setHideGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [tab, setTab] = useState<"floors" | "booths" | "elements" | "settings">("booths");
  const [isPublished, setIsPublished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Loaded");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [levels, setLevels] = useState<Level[]>([
    { id: "level-1", name: "Level 1", booths: [], elements: [] },
  ]);
  const [activeLevelId, setActiveLevelId] = useState("level-1");

  const [selectedKind, setSelectedKind] = useState<"booth" | "element" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [bulkColumns, setBulkColumns] = useState(4);
  const [bulkRows, setBulkRows] = useState(2);
  const [bulkSpacingX, setBulkSpacingX] = useState(18);
  const [bulkSpacingY, setBulkSpacingY] = useState(18);
  const [bulkPreset, setBulkPreset] = useState<keyof typeof PRESETS>("standard");

  const canvasScrollerRef = useRef<HTMLDivElement | null>(null);

  const activeLevel = useMemo(
    () => levels.find((l) => l.id === activeLevelId) || levels[0],
    [levels, activeLevelId]
  );

  const selectedBooth = useMemo(() => {
    if (selectedKind !== "booth" || !selectedId) return null;
    return activeLevel.booths.find((b) => String(b.id) === String(selectedId)) || null;
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

  function markDirty() {
    setStatusMsg("Not saved yet");
    setSaveError(null);
  }

  function quantize(n: number) {
    return snapToGrid ? Math.round(n / gridSize) * gridSize : n;
  }

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

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await getEventDiagram(eventId);
        if (cancelled) return;

        const raw = ((data as any)?.diagram ?? (data as any) ?? null) as DiagramDoc | null;
        const publishedFlag = Boolean((raw as any)?.published ?? (raw as any)?.meta?.published);
        setIsPublished(publishedFlag);

        if (raw && !isEmptyDiagramDoc(raw)) {
          setCanvasW(raw.canvas?.width ?? 1200);
          setCanvasH(raw.canvas?.height ?? 800);
          setGridSize(raw.canvas?.gridSize ?? 20);

          if (raw.levels?.length) {
            setLevels(
              raw.levels.map((lvl) => ({
                id: lvl.id,
                name: lvl.name,
                booths: Array.isArray(lvl.booths) ? lvl.booths : [],
                elements: Array.isArray(lvl.elements) ? lvl.elements : [],
              }))
            );
            setActiveLevelId(raw.levels[0].id);
          } else if (Array.isArray(raw.booths)) {
            setLevels([
              {
                id: "level-1",
                name: "Level 1",
                booths: raw.booths,
                elements: Array.isArray(raw.elements) ? raw.elements : [],
              },
            ]);
            setActiveLevelId("level-1");
          }

          localStorage.setItem(lsDiagramKey(eventId), JSON.stringify({ diagram: raw }));
          setStatusMsg("Loaded");
          return;
        }

        const cachedRaw = localStorage.getItem(lsDiagramKey(eventId));
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          const doc = (cached?.diagram || cached) as DiagramDoc;
          if (doc && !isEmptyDiagramDoc(doc)) {
            setCanvasW(doc.canvas?.width ?? 1200);
            setCanvasH(doc.canvas?.height ?? 800);
            setGridSize(doc.canvas?.gridSize ?? 20);
            if (doc.levels?.length) {
              setLevels(
                doc.levels.map((lvl) => ({
                  id: lvl.id,
                  name: lvl.name,
                  booths: Array.isArray(lvl.booths) ? lvl.booths : [],
                  elements: Array.isArray(lvl.elements) ? lvl.elements : [],
                }))
              );
              setActiveLevelId(doc.levels[0].id);
            }
            setStatusMsg("Loaded (local)");
            return;
          }
        }

        setStatusMsg("No saved diagram found");
      } catch (e: any) {
        setSaveError(e?.message ? String(e.message) : "Failed to load diagram.");
        setStatusMsg("Load failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

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
                booths: lvl.booths.map((b) => {
                  if (String(b.id) !== String(id)) return b;
                  const nextX = quantize((Number(b.x || 0) + dx));
                  const nextY = quantize((Number(b.y || 0) + dy));
                  return { ...b, x: nextX, y: nextY };
                }),
              };
            }

            return {
              ...lvl,
              elements: lvl.elements.map((el) => {
                if (el.id !== id) return el;
                return {
                  ...el,
                  x: quantize(el.x + dx),
                  y: quantize(el.y + dy),
                };
              }),
            };
          })
        );
        setDrag({ ...drag, cx: e.clientX, cy: e.clientY });
        markDirty();
      }

      if (resize) {
        const { kind, id, sw, sh } = resize;
        const nw = quantize(Math.max(40, sw + dx));
        const nh = quantize(Math.max(28, sh + dy));

        setLevels((prev) =>
          prev.map((lvl) => {
            if (lvl.id !== activeLevelId) return lvl;

            if (kind === "booth") {
              return {
                ...lvl,
                booths: lvl.booths.map((b) =>
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
  }, [drag, resize, zoom, activeLevelId, snapToGrid, gridSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedBooth) return;
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      const step = e.shiftKey ? gridSize : Math.max(1, Math.floor(gridSize / 2));
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Backspace"].includes(e.key)) {
        return;
      }

      e.preventDefault();

      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }

      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      if (e.key === "ArrowRight") dx = step;
      if (e.key === "ArrowUp") dy = -step;
      if (e.key === "ArrowDown") dy = step;

      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id !== activeLevelId
            ? lvl
            : {
                ...lvl,
                booths: lvl.booths.map((b) =>
                  String(b.id) !== String(selectedBooth.id)
                    ? b
                    : {
                        ...b,
                        x: quantize(Number(b.x || 0) + dx),
                        y: quantize(Number(b.y || 0) + dy),
                      }
                ),
              }
        )
      );
      markDirty();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBooth, activeLevelId, gridSize, snapToGrid]);

  function beginDrag(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDrag({ kind, id, cx: e.clientX, cy: e.clientY });
  }

  function beginResize(kind: "booth" | "element", id: string, e: React.MouseEvent) {
    e.stopPropagation();

    if (kind === "booth") {
      const b = activeLevel.booths.find((x) => String(x.id) === String(id));
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

  function addBooth() {
    const id = uid("booth");
    const booth: BoothLike = {
      id,
      label: `Booth ${activeLevel.booths.length + 1}`,
      x: 80,
      y: 120,
      width: 140,
      height: 110,
      category: "",
      price: 0,
      status: "available",
      notes: "",
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

  function duplicateSelectedBooth() {
    if (!selectedBooth) return;
    const copy: BoothLike = {
      ...selectedBooth,
      id: uid("booth"),
      label: `${selectedBooth.label || "Booth"} Copy`,
      x: quantize(Number(selectedBooth.x || 0) + Number(selectedBooth.width || 140) + gridSize),
      y: Number(selectedBooth.y || 0),
    };
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, booths: [...lvl.booths, copy] }
      )
    );
    setSelectedKind("booth");
    setSelectedId(copy.id);
    setTab("booths");
    markDirty();
  }

  function duplicateFloor() {
    const copyId = uid("level");
    const boothCopies = activeLevel.booths.map((b, idx) => ({
      ...b,
      id: uid("booth"),
      label: b.label || `Booth ${idx + 1}`,
    }));
    const elementCopies = activeLevel.elements.map((el) => ({ ...el, id: uid("el") }));
    const newLevel: Level = {
      id: copyId,
      name: `${activeLevel.name} Copy`,
      booths: boothCopies,
      elements: elementCopies,
    };
    setLevels((prev) => [...prev, newLevel]);
    setActiveLevelId(copyId);
    setTab("floors");
    markDirty();
  }

  function createBoothGrid() {
    const preset = PRESETS[bulkPreset];
    const startX = 80;
    const startY = 120;
    const created: BoothLike[] = [];
    const startIndex = activeLevel.booths.length + 1;

    for (let row = 0; row < bulkRows; row++) {
      for (let col = 0; col < bulkColumns; col++) {
        created.push({
          id: uid("booth"),
          label: `Booth ${startIndex + created.length}`,
          x: quantize(startX + col * (preset.width + bulkSpacingX)),
          y: quantize(startY + row * (preset.height + bulkSpacingY)),
          width: preset.width,
          height: preset.height,
          category: "",
          price: 0,
          status: "available",
          notes: "",
        });
      }
    }

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, booths: [...lvl.booths, ...created] }
      )
    );
    if (created[0]) {
      setSelectedKind("booth");
      setSelectedId(created[0].id);
    }
    markDirty();
  }

  function addLevel() {
    const id = uid("level");
    const n = levels.length + 1;
    setLevels((prev) => [...prev, { id, name: `Level ${n}`, booths: [], elements: [] }]);
    setActiveLevelId(id);
    setTab("floors");
    markDirty();
  }

  function deleteSelected() {
    if (!selectedKind || !selectedId) return;

    if (selectedKind === "booth") {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id !== activeLevelId
            ? lvl
            : { ...lvl, booths: lvl.booths.filter((b) => String(b.id) !== String(selectedId)) }
        )
      );
    } else {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id !== activeLevelId
            ? lvl
            : { ...lvl, elements: lvl.elements.filter((e) => e.id !== selectedId) }
        )
      );
    }

    setSelectedKind(null);
    setSelectedId(null);
    markDirty();
  }

  function updateSelectedBooth(patch: Partial<BoothLike>) {
    if (!selectedBooth) return;
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : {
              ...lvl,
              booths: lvl.booths.map((b) =>
                String(b.id) !== String(selectedBooth.id) ? b : { ...b, ...patch }
              ),
            }
      )
    );
    markDirty();
  }

  function addQuickElement(type: ElementType) {
    const id = uid("el");
    const el: MapElement = {
      id,
      type,
      x: 80,
      y: 80,
      width: type === "venue" ? 700 : type === "street" ? 700 : 220,
      height: type === "venue" ? 440 : type === "street" ? 80 : 140,
      label: type === "venue" ? "Venue" : type === "street" ? "Street" : type === "label" ? "Label" : "Shape",
    };

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, elements: [...lvl.elements, el] }
      )
    );
    setSelectedKind("element");
    setSelectedId(id);
    setTab("elements");
    setDrawerOpen(true);
    markDirty();
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

    setIsPublished(true);
    setStatusMsg("Published");
  }

  const gridBg = hideGrid
    ? "none"
    : `linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px),
       linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)`;

  const resizeHandleStyle: React.CSSProperties = {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 18,
    height: 18,
    borderRadius: 8,
    background: "#0f172a",
    border: "2px solid #fff",
    boxShadow: "0 4px 12px rgba(2,6,23,0.18)",
    cursor: "nwse-resize",
  };

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
      <div style={{ padding: "18px 18px 10px", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>Booth Map Editor</div>
            <div style={{ marginTop: 4, color: "#475569", fontWeight: 600 }}>Design your floor, configure booth details, and publish when ready.</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button style={pill(false)} onClick={() => navigate(-1)}>← Back</button>
            <button style={pill(false)} onClick={() => window.location.reload()}>Refresh</button>
            <button style={pill(true)} onClick={saveNow}>{isSaving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, color: "#0f172a" }}>View</span>
          <button style={pill(false)} onClick={fitToScreen}>Fit</button>
          <button style={pill(!hideGrid)} onClick={() => setHideGrid((v) => !v)}>Grid</button>
          <button style={pill(snapToGrid)} onClick={() => setSnapToGrid((v) => !v)}>Snap</button>
          <button style={pill(false)} onClick={() => setZoom((z) => clamp(+(z - 0.1).toFixed(2), 0.4, 2))}>−</button>
          <div style={{ minWidth: 50, textAlign: "center", fontWeight: 900 }}>{Math.round(zoom * 100)}%</div>
          <button style={pill(false)} onClick={() => setZoom((z) => clamp(+(z + 0.1).toFixed(2), 0.4, 2))}>+</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, color: "#0f172a" }}>Build</span>
          <button style={pill(false)} onClick={addBooth}>+ Add Booth</button>
          <button style={pill(false)} onClick={createBoothGrid}>+ Booth Grid</button>
          <button style={pill(false)} onClick={duplicateSelectedBooth} disabled={!selectedBooth}>Duplicate Booth</button>
          <button style={pill(false)} onClick={duplicateFloor}>Duplicate Floor</button>
          <button style={pill(false)} onClick={() => addQuickElement("label")}>Add Label</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, color: "#0f172a" }}>Output</span>
          <button style={pill(false)} onClick={() => window.print()}>Print</button>
          <button style={pill(isPublished)} onClick={publishEventNow}>Publish</button>
        </div>
      </div>

      <div style={{ padding: "0 18px 10px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Legend color="#22c55e" label="Available" />
        <Legend color="#f59e0b" label="Reserved" />
        <Legend color="#ef4444" label="Paid" />
        <Legend color="#8b5cf6" label="Assigned/Occupied" />
        <Legend color="#94a3b8" label="Blocked" />
        <span style={{ marginLeft: "auto", fontWeight: 900, color: saveError ? "#b91c1c" : "#334155" }}>
          {saveError || statusMsg}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: drawerOpen ? "1fr 420px" : "1fr", gap: 16, padding: "0 18px 18px", minHeight: 0, flex: 1 }}>
        <div style={{ ...softCard(), overflow: "hidden", minWidth: 0, minHeight: 0 }}>
          <div
            ref={canvasScrollerRef}
            onMouseDown={() => {
              setSelectedKind(null);
              setSelectedId(null);
            }}
            style={{
              position: "relative",
              overflow: "auto",
              minHeight: 0,
              height: "100%",
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
              }}
            >
              {activeLevel.elements.map((el) => {
                const selected = selectedKind === "element" && selectedId === el.id;
                return (
                  <div
                    key={el.id}
                    onMouseDown={(e) => {
                      setSelectedKind("element");
                      setSelectedId(el.id);
                      if (e.button === 0) beginDrag("element", el.id, e);
                    }}
                    style={{
                      position: "absolute",
                      left: el.x * zoom,
                      top: el.y * zoom,
                      width: el.width * zoom,
                      height: el.height * zoom,
                      borderRadius: 18,
                      border: selected ? "3px solid #4338ca" : "2px dashed rgba(15,23,42,0.25)",
                      background:
                        el.type === "street" ? "rgba(15,23,42,0.08)"
                        : el.type === "venue" ? "rgba(2,132,199,0.06)"
                        : "rgba(255,255,255,0.88)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#0f172a",
                      fontWeight: 900,
                      userSelect: "none",
                    }}
                  >
                    {el.label || el.type}
                    {selected ? (
                      <div onMouseDown={(e) => beginResize("element", el.id, e)} style={resizeHandleStyle} />
                    ) : null}
                  </div>
                );
              })}

              {activeLevel.booths.map((b) => {
                const selected = selectedKind === "booth" && selectedId === String(b.id);
                return (
                  <div
                    key={String(b.id)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedKind("booth");
                      setSelectedId(String(b.id));
                      setDrawerOpen(true);
                      setTab("booths");
                      if (e.button === 0) beginDrag("booth", String(b.id), e);
                    }}
                    style={{
                      position: "absolute",
                      left: Number(b.x || 0) * zoom,
                      top: Number(b.y || 0) * zoom,
                      width: Number(b.width || 120) * zoom,
                      height: Number(b.height || 90) * zoom,
                      borderRadius: 18,
                      background: statusColor(String(b.status || "available")),
                      border: selected ? "4px solid #1d4ed8" : "1px solid rgba(15,23,42,0.10)",
                      boxShadow: selected
                        ? "0 12px 24px rgba(37,99,235,0.24)"
                        : "0 10px 24px rgba(2,6,23,0.08)",
                      color: "#0f172a",
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      fontWeight: 900,
                      userSelect: "none",
                    }}
                  >
                    <div style={{ fontSize: 14 }}>{b.label || "Booth"}</div>
                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>
                        {b.category || "Uncategorized"}
                      </div>
                      <div style={{ fontSize: 14 }}>${Number(b.price || 0)}</div>
                    </div>

                    {selected ? (
                      <div onMouseDown={(e) => beginResize("booth", String(b.id), e)} style={resizeHandleStyle} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {drawerOpen ? (
          <div style={{ ...softCard(), overflow: "auto", padding: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button style={pill(tab === "floors")} onClick={() => setTab("floors")}>Floors</button>
              <button style={pill(tab === "booths")} onClick={() => setTab("booths")}>Booths</button>
              <button style={pill(tab === "elements")} onClick={() => setTab("elements")}>Elements</button>
              <button style={pill(tab === "settings")} onClick={() => setTab("settings")}>Settings</button>
            </div>

            {tab === "floors" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <Section title="Floors">
                  <button style={primaryButton()} onClick={addLevel}>+ Add Floor</button>
                  <button style={secondaryButton()} onClick={duplicateFloor}>Duplicate Active Floor</button>
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {levels.map((lvl) => (
                      <button
                        key={lvl.id}
                        onClick={() => setActiveLevelId(lvl.id)}
                        style={{
                          ...secondaryButton(),
                          textAlign: "left",
                          borderColor: lvl.id === activeLevelId ? "rgba(99,102,241,0.4)" : "rgba(15,23,42,0.12)",
                          background: lvl.id === activeLevelId ? "rgba(99,102,241,0.08)" : "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>{lvl.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{lvl.booths.length} booths • {lvl.elements.length} elements</div>
                      </button>
                    ))}
                  </div>
                </Section>
              </div>
            ) : null}

            {tab === "booths" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <Section title="Workflow">
                  <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                    <div><strong>1.</strong> Add booths or build a grid.</div>
                    <div><strong>2.</strong> Select a booth to edit status, category, size, and price.</div>
                    <div><strong>3.</strong> Save, then publish when the map is ready.</div>
                  </div>
                </Section>

                <Section title="Bulk Create / Section Builder">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Columns">
                      <input type="number" value={bulkColumns} onChange={(e) => setBulkColumns(Math.max(1, Number(e.target.value || 1)))} style={inputStyle()} />
                    </Field>
                    <Field label="Rows">
                      <input type="number" value={bulkRows} onChange={(e) => setBulkRows(Math.max(1, Number(e.target.value || 1)))} style={inputStyle()} />
                    </Field>
                    <Field label="Spacing X">
                      <input type="number" value={bulkSpacingX} onChange={(e) => setBulkSpacingX(Math.max(0, Number(e.target.value || 0)))} style={inputStyle()} />
                    </Field>
                    <Field label="Spacing Y">
                      <input type="number" value={bulkSpacingY} onChange={(e) => setBulkSpacingY(Math.max(0, Number(e.target.value || 0)))} style={inputStyle()} />
                    </Field>
                  </div>
                  <Field label="Booth Preset">
                    <select value={bulkPreset} onChange={(e) => setBulkPreset(e.target.value as keyof typeof PRESETS)} style={inputStyle()}>
                      <option value="standard">Standard</option>
                      <option value="compact">Compact</option>
                      <option value="premium">Premium</option>
                      <option value="island">Island</option>
                    </select>
                  </Field>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={primaryButton()} onClick={createBoothGrid}>Create Booth Grid</button>
                    <button style={secondaryButton()} onClick={addBooth}>+ Add Single Booth</button>
                  </div>
                </Section>

                <Section title="Selected Booth">
                  {!selectedBooth ? (
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Select a booth to edit.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <Field label="Label">
                          <input value={String(selectedBooth.label || "")} onChange={(e) => updateSelectedBooth({ label: e.target.value })} style={inputStyle()} />
                        </Field>
                        <Field label="Status">
                          <select value={String(selectedBooth.status || "available")} onChange={(e) => updateSelectedBooth({ status: e.target.value })} style={inputStyle()}>
                            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </Field>
                        <Field label="Booth Type / Category">
                          <select value={String(selectedBooth.category || "")} onChange={(e) => updateSelectedBooth({ category: e.target.value })} style={inputStyle()}>
                            <option value="">Select category</option>
                            {CATEGORY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </Field>
                        <Field label="Price">
                          <input type="number" value={Number(selectedBooth.price || 0)} onChange={(e) => updateSelectedBooth({ price: Number(e.target.value || 0) })} style={inputStyle()} />
                        </Field>
                        <Field label="Width">
                          <input type="number" value={Number(selectedBooth.width || 140)} onChange={(e) => updateSelectedBooth({ width: quantize(Math.max(40, Number(e.target.value || 40))) })} style={inputStyle()} />
                        </Field>
                        <Field label="Height">
                          <input type="number" value={Number(selectedBooth.height || 110)} onChange={(e) => updateSelectedBooth({ height: quantize(Math.max(28, Number(e.target.value || 28))) })} style={inputStyle()} />
                        </Field>
                        <Field label="X Position">
                          <input type="number" value={Number(selectedBooth.x || 0)} onChange={(e) => updateSelectedBooth({ x: quantize(Number(e.target.value || 0)) as any })} style={inputStyle()} />
                        </Field>
                        <Field label="Y Position">
                          <input type="number" value={Number(selectedBooth.y || 0)} onChange={(e) => updateSelectedBooth({ y: quantize(Number(e.target.value || 0)) as any })} style={inputStyle()} />
                        </Field>
                      </div>

                      <Field label="Notes">
                        <textarea value={String(selectedBooth.notes || "")} onChange={(e) => updateSelectedBooth({ notes: e.target.value })} style={{ ...inputStyle(), minHeight: 80, resize: "vertical" }} />
                      </Field>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button style={secondaryButton()} onClick={duplicateSelectedBooth}>Duplicate Booth</button>
                        <button style={secondaryButton()} onClick={() => {
                          updateSelectedBooth({ x: quantize(Number(selectedBooth.x || 0) - gridSize) as any });
                        }}>Nudge Left</button>
                        <button style={secondaryButton()} onClick={() => {
                          updateSelectedBooth({ x: quantize(Number(selectedBooth.x || 0) + gridSize) as any });
                        }}>Nudge Right</button>
                        <button style={secondaryButton()} onClick={() => {
                          updateSelectedBooth({ y: quantize(Number(selectedBooth.y || 0) - gridSize) as any });
                        }}>Nudge Up</button>
                        <button style={secondaryButton()} onClick={() => {
                          updateSelectedBooth({ y: quantize(Number(selectedBooth.y || 0) + gridSize) as any });
                        }}>Nudge Down</button>
                        <button style={dangerButton()} onClick={deleteSelected}>Delete Booth</button>
                      </div>
                    </div>
                  )}
                </Section>
              </div>
            ) : null}

            {tab === "elements" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <Section title="Quick Elements">
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={secondaryButton()} onClick={() => addQuickElement("venue")}>Add Venue</button>
                    <button style={secondaryButton()} onClick={() => addQuickElement("street")}>Add Street</button>
                    <button style={secondaryButton()} onClick={() => addQuickElement("label")}>Add Label</button>
                    <button style={secondaryButton()} onClick={() => addQuickElement("shape")}>Add Shape</button>
                  </div>
                </Section>

                <Section title="Selected Element">
                  {!selectedElement ? (
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Select an element to edit.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <Field label="Label">
                        <input value={String(selectedElement.label || "")} onChange={(e) => {
                          setLevels((prev) =>
                            prev.map((lvl) =>
                              lvl.id !== activeLevelId
                                ? lvl
                                : {
                                    ...lvl,
                                    elements: lvl.elements.map((el) =>
                                      el.id !== selectedElement.id ? el : { ...el, label: e.target.value }
                                    ),
                                  }
                            )
                          );
                          markDirty();
                        }} style={inputStyle()} />
                      </Field>
                      <button style={dangerButton()} onClick={deleteSelected}>Delete Element</button>
                    </div>
                  )}
                </Section>
              </div>
            ) : null}

            {tab === "settings" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <Section title="Canvas Settings">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Canvas Width">
                      <input type="number" value={canvasW} onChange={(e) => { setCanvasW(Math.max(400, Number(e.target.value || 400))); markDirty(); }} style={inputStyle()} />
                    </Field>
                    <Field label="Canvas Height">
                      <input type="number" value={canvasH} onChange={(e) => { setCanvasH(Math.max(300, Number(e.target.value || 300))); markDirty(); }} style={inputStyle()} />
                    </Field>
                    <Field label="Grid Size">
                      <input type="number" value={gridSize} onChange={(e) => { setGridSize(Math.max(8, Number(e.target.value || 8))); markDirty(); }} style={inputStyle()} />
                    </Field>
                  </div>
                </Section>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "#475569" }}>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: 16,
        padding: 14,
        display: "grid",
        gap: 12,
        background: "rgba(255,255,255,0.96)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{title}</div>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  };
}

function primaryButton(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(99,102,241,0.35)",
    background: "rgba(99,102,241,0.12)",
    color: "#4338ca",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function secondaryButton(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    color: "#0f172a",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function dangerButton(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.25)",
    background: "rgba(239,68,68,0.08)",
    color: "#b91c1c",
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
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
