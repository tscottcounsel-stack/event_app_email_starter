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
  locked?: boolean;
  sectionId?: string;
};

type BoothSection = {
  id: string;
  name: string;
  color: string;
  boothIds: string[];
};

type Level = {
  id: string;
  name: string;
  booths: BoothLike[];
  elements: MapElement[];
  sections: BoothSection[];
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
    sections?: BoothSection[];
  }>;
  booths?: BoothLike[];
  elements?: MapElement[];
};

type SelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type ClipboardDoc = {
  booths: BoothLike[];
};

type AlignAction =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute-h"
  | "distribute-v";

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

const SECTION_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f97316",
  "#eab308",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
];

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
      (l) =>
        (l.booths?.length ?? 0) === 0 &&
        (l.elements?.length ?? 0) === 0 &&
        (l.sections?.length ?? 0) === 0
    );
  }
  return legacyBooths.length === 0;
}

function normalizeLevel(input: Partial<Level> | any, index = 0): Level {
  return {
    id: String(input?.id || `level-${index + 1}`),
    name: String(input?.name || `Level ${index + 1}`),
    booths: Array.isArray(input?.booths) ? input.booths : [],
    elements: Array.isArray(input?.elements) ? input.elements : [],
    sections: Array.isArray(input?.sections) ? input.sections : [],
  };
}

function getRectFromSelection(box: SelectionBox) {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);
  return { left, top, width, height };
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function sectionColor(index: number) {
  return SECTION_COLORS[index % SECTION_COLORS.length];
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

  const [canvasW, setCanvasW] = useState(1600);
  const [canvasH, setCanvasH] = useState(1000);
  const [gridSize, setGridSize] = useState(20);
  const [hideGrid, setHideGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [isPublished, setIsPublished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Loaded");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [levels, setLevels] = useState<Level[]>([
    { id: "level-1", name: "Level 1", booths: [], elements: [], sections: [] },
  ]);
  const [activeLevelId, setActiveLevelId] = useState("level-1");

  const [selectedKind, setSelectedKind] = useState<"booth" | "element" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBoothIds, setSelectedBoothIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  const [bulkColumns, setBulkColumns] = useState(4);
  const [bulkRows, setBulkRows] = useState(2);
  const [bulkSpacingX, setBulkSpacingX] = useState(18);
  const [bulkSpacingY, setBulkSpacingY] = useState(18);
  const [bulkPreset, setBulkPreset] = useState<keyof typeof PRESETS>("standard");
  const [newSectionName, setNewSectionName] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");

  const canvasScrollerRef = useRef<HTMLDivElement | null>(null);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<ClipboardDoc | null>(null);

  const activeLevel = useMemo(
    () => levels.find((l) => l.id === activeLevelId) || levels[0],
    [levels, activeLevelId]
  );

  const selectedBooths = useMemo(() => {
    const set = new Set(selectedBoothIds.map(String));
    return activeLevel.booths.filter((b) => set.has(String(b.id)));
  }, [activeLevel.booths, selectedBoothIds]);

  const selectedBooth = useMemo(() => {
    if (selectedBoothIds.length === 1) {
      return selectedBooths[0] || null;
    }
    if (selectedKind !== "booth" || !selectedId) return null;
    return activeLevel.booths.find((b) => String(b.id) === String(selectedId)) || null;
  }, [selectedBoothIds, selectedBooths, selectedKind, selectedId, activeLevel.booths]);

  const selectedElement = useMemo(() => {
    if (selectedKind !== "element" || !selectedId) return null;
    return activeLevel.elements.find((e) => e.id === selectedId) || null;
  }, [selectedKind, selectedId, activeLevel.elements]);

  const [drag, setDrag] = useState<
    | null
    | {
        ids: string[];
        anchorClientX: number;
        anchorClientY: number;
        startPositions: Array<{ id: string; x: number; y: number }>;
      }
  >(null);

  const [resize, setResize] = useState<
    | null
    | {
        id: string;
        startWidth: number;
        startHeight: number;
        anchorClientX: number;
        anchorClientY: number;
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
    const pad = 48;
    const availW = Math.max(200, rect.width - pad);
    const availH = Math.max(200, rect.height - pad);
    const z = Math.min(availW / canvasW, availH / canvasH);
    setZoom(+clamp(z, 0.4, 1.5).toFixed(2));
  }

  function clearSelection() {
    setSelectedKind(null);
    setSelectedId(null);
    setSelectedBoothIds([]);
  }

  function selectSingleBooth(id: string) {
    setSelectedKind("booth");
    setSelectedId(id);
    setSelectedBoothIds([id]);
  }

  function toggleBoothSelection(id: string) {
    setSelectedKind("booth");
    setSelectedId(id);
    setSelectedBoothIds((prev) => {
      const exists = prev.some((x) => String(x) === String(id));
      if (exists) {
        const next = prev.filter((x) => String(x) !== String(id));
        return next;
      }
      return [...prev, id];
    });
  }

  function updateLevelBooths(updater: (booths: BoothLike[], sections: BoothSection[]) => { booths: BoothLike[]; sections?: BoothSection[] }) {
    setLevels((prev) =>
      prev.map((lvl) => {
        if (lvl.id !== activeLevelId) return lvl;
        const result = updater(lvl.booths, lvl.sections);
        return {
          ...lvl,
          booths: result.booths,
          sections: result.sections ?? lvl.sections,
        };
      })
    );
  }

  function normalizeSectionMembership(booths: BoothLike[], sections: BoothSection[]) {
    const boothIdSet = new Set(booths.map((b) => String(b.id)));
    const cleanedSections = sections.map((section) => ({
      ...section,
      boothIds: section.boothIds.filter((id) => boothIdSet.has(String(id))),
    }));
    const sectionIdSet = new Set(cleanedSections.map((s) => s.id));
    const normalizedBooths = booths.map((b) =>
      b.sectionId && !sectionIdSet.has(String(b.sectionId))
        ? { ...b, sectionId: undefined }
        : b
    );
    return { booths: normalizedBooths, sections: cleanedSections };
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
          setCanvasW(raw.canvas?.width ?? 1600);
          setCanvasH(raw.canvas?.height ?? 1000);
          setGridSize(raw.canvas?.gridSize ?? 20);

          if (raw.levels?.length) {
            setLevels(raw.levels.map((lvl, index) => normalizeLevel(lvl, index)));
            setActiveLevelId(String(raw.levels[0].id));
          } else {
            setLevels([
              normalizeLevel(
                {
                  id: "level-1",
                  name: "Level 1",
                  booths: Array.isArray(raw.booths) ? raw.booths : [],
                  elements: Array.isArray(raw.elements) ? raw.elements : [],
                  sections: [],
                },
                0
              ),
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
            setCanvasW(doc.canvas?.width ?? 1600);
            setCanvasH(doc.canvas?.height ?? 1000);
            setGridSize(doc.canvas?.gridSize ?? 20);
            if (doc.levels?.length) {
              setLevels(doc.levels.map((lvl, index) => normalizeLevel(lvl, index)));
              setActiveLevelId(String(doc.levels[0].id));
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
    if (!drag && !resize && !selectionBox) return;

    const onMove = (e: MouseEvent) => {
      if (drag) {
        const dx = (e.clientX - drag.anchorClientX) / zoom;
        const dy = (e.clientY - drag.anchorClientY) / zoom;

        updateLevelBooths((booths, sections) => ({
          booths: booths.map((b) => {
            const start = drag.startPositions.find((p) => String(p.id) === String(b.id));
            if (!start) return b;
            if (b.locked) return b;
            return {
              ...b,
              x: quantize(start.x + dx),
              y: quantize(start.y + dy),
            };
          }),
          sections,
        }));
        markDirty();
      }

      if (resize) {
        updateLevelBooths((booths, sections) => ({
          booths: booths.map((b) => {
            if (String(b.id) !== String(resize.id)) return b;
            const dx = (e.clientX - resize.anchorClientX) / zoom;
            const dy = (e.clientY - resize.anchorClientY) / zoom;
            return {
              ...b,
              width: quantize(Math.max(40, resize.startWidth + dx)),
              height: quantize(Math.max(28, resize.startHeight + dy)),
            };
          }),
          sections,
        }));
        markDirty();
      }

      if (selectionBox) {
        const stageRect = canvasStageRef.current?.getBoundingClientRect();
        if (!stageRect) return;
        const stageX = (e.clientX - stageRect.left) / zoom;
        const stageY = (e.clientY - stageRect.top) / zoom;
        const nextBox = {
          ...selectionBox,
          currentX: clamp(stageX, 0, canvasW),
          currentY: clamp(stageY, 0, canvasH),
        };
        setSelectionBox(nextBox);

        const rect = getRectFromSelection(nextBox);
        const hitIds = activeLevel.booths
          .filter((b) =>
            intersects(
              {
                x: Number(b.x || 0),
                y: Number(b.y || 0),
                width: Number(b.width || 120),
                height: Number(b.height || 90),
              },
              {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
              }
            )
          )
          .map((b) => String(b.id));

        setSelectedKind("booth");
        setSelectedId(hitIds[0] || null);
        setSelectedBoothIds(hitIds);
      }
    };

    const onUp = () => {
      setDrag(null);
      setResize(null);
      setSelectionBox(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, resize, selectionBox, zoom, activeLevelId, activeLevel.booths, snapToGrid, gridSize, canvasW, canvasH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (!selectedBoothIds.length) return;
        e.preventDefault();
        clipboardRef.current = {
          booths: selectedBooths.map((b) => ({ ...b })),
        };
        setStatusMsg(`${selectedBoothIds.length} booth${selectedBoothIds.length === 1 ? "" : "s"} copied`);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (!clipboardRef.current?.booths?.length) return;
        e.preventDefault();
        pasteClipboard();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (!selectedBoothIds.length) return;
        e.preventDefault();
        duplicateSelectedBooths();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedBoothIds.length && !selectedElement) return;
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (!selectedBoothIds.length) return;

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? gridSize : Math.max(1, Math.floor(gridSize / 2));
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;

        updateLevelBooths((booths, sections) => ({
          booths: booths.map((b) =>
            selectedBoothIds.includes(String(b.id)) && !b.locked
              ? {
                  ...b,
                  x: quantize(Number(b.x || 0) + dx),
                  y: quantize(Number(b.y || 0) + dy),
                }
              : b
          ),
          sections,
        }));
        markDirty();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBoothIds, selectedBooths, selectedElement, gridSize, snapToGrid]);

  const currentSection = useMemo(
    () => activeLevel.sections.find((section) => section.id === selectedSectionId) || null,
    [activeLevel.sections, selectedSectionId]
  );

  const selectionMetrics = useMemo(() => {
    if (!selectedBooths.length) return null;
    const xs = selectedBooths.map((b) => Number(b.x || 0));
    const ys = selectedBooths.map((b) => Number(b.y || 0));
    const rights = selectedBooths.map((b) => Number(b.x || 0) + Number(b.width || 0));
    const bottoms = selectedBooths.map((b) => Number(b.y || 0) + Number(b.height || 0));
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...rights),
      maxY: Math.max(...bottoms),
    };
  }, [selectedBooths]);

  function beginDragBooths(ids: string[], e: React.MouseEvent) {
    e.stopPropagation();
    const startPositions = activeLevel.booths
      .filter((b) => ids.includes(String(b.id)))
      .map((b) => ({
        id: String(b.id),
        x: Number(b.x || 0),
        y: Number(b.y || 0),
      }));
    setDrag({
      ids,
      anchorClientX: e.clientX,
      anchorClientY: e.clientY,
      startPositions,
    });
  }

  function beginResizeBooth(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const booth = activeLevel.booths.find((b) => String(b.id) === String(id));
    if (!booth) return;
    setResize({
      id,
      startWidth: Number(booth.width || 120),
      startHeight: Number(booth.height || 90),
      anchorClientX: e.clientX,
      anchorClientY: e.clientY,
    });
  }

  function onCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const stageRect = canvasStageRef.current?.getBoundingClientRect();
    if (!stageRect) return;
    const x = (e.clientX - stageRect.left) / zoom;
    const y = (e.clientY - stageRect.top) / zoom;
    clearSelection();
    setSelectionBox({
      startX: clamp(x, 0, canvasW),
      startY: clamp(y, 0, canvasH),
      currentX: clamp(x, 0, canvasW),
      currentY: clamp(y, 0, canvasH),
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
      locked: false,
    };

    updateLevelBooths((booths, sections) => ({ booths: [...booths, booth], sections }));
    setSelectedKind("booth");
    setSelectedId(id);
    setSelectedBoothIds([id]);
    setDrawerOpen(true);
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
          locked: false,
        });
      }
    }

    updateLevelBooths((booths, sections) => ({ booths: [...booths, ...created], sections }));
    setSelectedKind("booth");
    setSelectedId(created[0]?.id || null);
    setSelectedBoothIds(created.map((b) => String(b.id)));
    markDirty();
  }

  function duplicateSelectedBooths() {
    if (!selectedBooths.length) return;

    const mapping = new Map<string, string>();
    const created = selectedBooths.map((b, index) => {
      const newId = uid("booth");
      mapping.set(String(b.id), newId);
      return {
        ...b,
        id: newId,
        label: `${b.label || `Booth ${index + 1}`} Copy`,
        x: quantize(Number(b.x || 0) + gridSize * 2),
        y: quantize(Number(b.y || 0) + gridSize * 2),
      };
    });

    updateLevelBooths((booths, sections) => {
      const nextBooths = [...booths, ...created];
      const nextSections = sections.map((section) => ({
        ...section,
        boothIds: [
          ...section.boothIds,
          ...section.boothIds
            .filter((id) => mapping.has(String(id)))
            .map((id) => String(mapping.get(String(id)))),
        ],
      }));
      return normalizeSectionMembership(nextBooths, nextSections);
    });
    setSelectedBoothIds(created.map((b) => String(b.id)));
    setSelectedId(created[0]?.id || null);
    setSelectedKind("booth");
    markDirty();
  }

  function pasteClipboard() {
    const data = clipboardRef.current;
    if (!data?.booths?.length) return;

    const pasted = data.booths.map((b, index) => ({
      ...b,
      id: uid("booth"),
      label: `${b.label || `Booth ${index + 1}`} Copy`,
      x: quantize(Number(b.x || 0) + gridSize * 2),
      y: quantize(Number(b.y || 0) + gridSize * 2),
    }));

    updateLevelBooths((booths, sections) => ({
      booths: [...booths, ...pasted],
      sections,
    }));
    setSelectedKind("booth");
    setSelectedId(pasted[0]?.id || null);
    setSelectedBoothIds(pasted.map((b) => String(b.id)));
    setStatusMsg(`Pasted ${pasted.length} booth${pasted.length === 1 ? "" : "s"}`);
    markDirty();
  }

  function addLevel() {
    const id = uid("level");
    const n = levels.length + 1;
    setLevels((prev) => [
      ...prev,
      { id, name: `Level ${n}`, booths: [], elements: [], sections: [] },
    ]);
    setActiveLevelId(id);
    clearSelection();
    markDirty();
  }

  function duplicateFloor() {
    const copyId = uid("level");
    const oldToNewId = new Map<string, string>();
    const boothCopies = activeLevel.booths.map((b, idx) => {
      const nextId = uid("booth");
      oldToNewId.set(String(b.id), nextId);
      return {
        ...b,
        id: nextId,
        label: b.label || `Booth ${idx + 1}`,
      };
    });
    const elementCopies = activeLevel.elements.map((el) => ({ ...el, id: uid("el") }));
    const sectionCopies = activeLevel.sections.map((section) => ({
      ...section,
      id: uid("section"),
      boothIds: section.boothIds.map((id) => String(oldToNewId.get(String(id)) || id)),
    }));
    const newLevel: Level = {
      id: copyId,
      name: `${activeLevel.name} Copy`,
      booths: boothCopies,
      elements: elementCopies,
      sections: sectionCopies,
    };
    setLevels((prev) => [...prev, newLevel]);
    setActiveLevelId(copyId);
    clearSelection();
    markDirty();
  }

  function deleteSelected() {
    if (selectedElement) {
      setLevels((prev) =>
        prev.map((lvl) =>
          lvl.id !== activeLevelId
            ? lvl
            : {
                ...lvl,
                elements: lvl.elements.filter((e) => e.id !== selectedElement.id),
              }
        )
      );
      setSelectedKind(null);
      setSelectedId(null);
      markDirty();
      return;
    }

    if (!selectedBoothIds.length) return;

    updateLevelBooths((booths, sections) => {
      const removeSet = new Set(selectedBoothIds.map(String));
      const nextBooths = booths.filter((b) => !removeSet.has(String(b.id)));
      const nextSections = sections.map((section) => ({
        ...section,
        boothIds: section.boothIds.filter((id) => !removeSet.has(String(id))),
      }));
      return normalizeSectionMembership(nextBooths, nextSections);
    });
    clearSelection();
    markDirty();
  }

  function updateSelectedBooths(patch: Partial<BoothLike>) {
    if (!selectedBoothIds.length) return;
    const set = new Set(selectedBoothIds.map(String));
    updateLevelBooths((booths, sections) => ({
      booths: booths.map((b) =>
        set.has(String(b.id))
          ? {
              ...b,
              ...patch,
            }
          : b
      ),
      sections,
    }));
    markDirty();
  }

  function assignSelectedToSection(sectionId: string) {
    if (!selectedBoothIds.length) return;
    const idSet = new Set(selectedBoothIds.map(String));

    updateLevelBooths((booths, sections) => {
      const nextBooths = booths.map((b) =>
        idSet.has(String(b.id))
          ? { ...b, sectionId: sectionId || undefined }
          : b
      );
      const nextSections = sections.map((section) => ({
        ...section,
        boothIds:
          section.id === sectionId
            ? Array.from(new Set([...section.boothIds, ...selectedBoothIds]))
            : section.boothIds.filter((id) => !idSet.has(String(id))),
      }));
      return normalizeSectionMembership(nextBooths, nextSections);
    });
    setSelectedSectionId(sectionId);
    markDirty();
  }

  function createSection() {
    const name = newSectionName.trim() || `Section ${activeLevel.sections.length + 1}`;
    const section: BoothSection = {
      id: uid("section"),
      name,
      color: sectionColor(activeLevel.sections.length),
      boothIds: [],
    };
    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId
          ? lvl
          : { ...lvl, sections: [...lvl.sections, section] }
      )
    );
    setSelectedSectionId(section.id);
    setNewSectionName("");
    markDirty();
  }

  function duplicateSection(sectionId: string) {
    const section = activeLevel.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const sourceBooths = activeLevel.booths.filter((b) => section.boothIds.includes(String(b.id)));
    if (!sourceBooths.length) return;

    const nextSectionId = uid("section");
    const newBoothIds: string[] = [];
    const copiedBooths = sourceBooths.map((b) => {
      const nextId = uid("booth");
      newBoothIds.push(nextId);
      return {
        ...b,
        id: nextId,
        label: `${b.label || "Booth"} Copy`,
        x: quantize(Number(b.x || 0) + gridSize * 3),
        y: quantize(Number(b.y || 0) + gridSize * 3),
        sectionId: nextSectionId,
      };
    });

    const duplicatedSection: BoothSection = {
      id: nextSectionId,
      name: `${section.name} Copy`,
      color: sectionColor(activeLevel.sections.length),
      boothIds: newBoothIds,
    };

    updateLevelBooths((booths, sections) => ({
      booths: [...booths, ...copiedBooths],
      sections: [...sections, duplicatedSection],
    }));
    setSelectedSectionId(nextSectionId);
    setSelectedBoothIds(newBoothIds);
    setSelectedId(newBoothIds[0] || null);
    setSelectedKind("booth");
    markDirty();
  }

  function applyAlignment(action: AlignAction) {
    if (selectedBooths.length < 2 || !selectionMetrics) return;
    const ids = new Set(selectedBoothIds.map(String));
    const orderedByX = [...selectedBooths].sort((a, b) => Number(a.x || 0) - Number(b.x || 0));
    const orderedByY = [...selectedBooths].sort((a, b) => Number(a.y || 0) - Number(b.y || 0));

    const firstX = selectionMetrics.minX;
    const firstY = selectionMetrics.minY;
    const lastX = selectionMetrics.maxX;
    const lastY = selectionMetrics.maxY;
    const centerX = firstX + (lastX - firstX) / 2;
    const centerY = firstY + (lastY - firstY) / 2;

    updateLevelBooths((booths, sections) => {
      let nextBooths = booths.map((b) => {
        if (!ids.has(String(b.id)) || b.locked) return b;
        const width = Number(b.width || 0);
        const height = Number(b.height || 0);
        if (action === "left") return { ...b, x: quantize(firstX) };
        if (action === "center") return { ...b, x: quantize(centerX - width / 2) };
        if (action === "right") return { ...b, x: quantize(lastX - width) };
        if (action === "top") return { ...b, y: quantize(firstY) };
        if (action === "middle") return { ...b, y: quantize(centerY - height / 2) };
        if (action === "bottom") return { ...b, y: quantize(lastY - height) };
        return b;
      });

      if (action === "distribute-h" && orderedByX.length >= 3) {
        const totalWidth = orderedByX.reduce((sum, b) => sum + Number(b.width || 0), 0);
        const available = lastX - firstX - totalWidth;
        const gap = available / (orderedByX.length - 1);
        let cursor = firstX;
        const map = new Map<string, number>();
        orderedByX.forEach((b) => {
          map.set(String(b.id), cursor);
          cursor += Number(b.width || 0) + gap;
        });
        nextBooths = nextBooths.map((b) =>
          map.has(String(b.id)) && !b.locked
            ? { ...b, x: quantize(Number(map.get(String(b.id)))) }
            : b
        );
      }

      if (action === "distribute-v" && orderedByY.length >= 3) {
        const totalHeight = orderedByY.reduce((sum, b) => sum + Number(b.height || 0), 0);
        const available = lastY - firstY - totalHeight;
        const gap = available / (orderedByY.length - 1);
        let cursor = firstY;
        const map = new Map<string, number>();
        orderedByY.forEach((b) => {
          map.set(String(b.id), cursor);
          cursor += Number(b.height || 0) + gap;
        });
        nextBooths = nextBooths.map((b) =>
          map.has(String(b.id)) && !b.locked
            ? { ...b, y: quantize(Number(map.get(String(b.id)))) }
            : b
        );
      }

      return { booths: nextBooths, sections };
    });
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
      label:
        type === "venue"
          ? "Venue"
          : type === "street"
          ? "Street"
          : type === "label"
          ? "Label"
          : "Shape",
    };

    setLevels((prev) =>
      prev.map((lvl) =>
        lvl.id !== activeLevelId ? lvl : { ...lvl, elements: [...lvl.elements, el] }
      )
    );
    setSelectedKind("element");
    setSelectedId(id);
    setSelectedBoothIds([]);
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
        version: 3,
        published: isPublished,
        meta: { published: isPublished },
        canvas: { width: canvasW, height: canvasH, gridSize },
        levels: levels.map((lvl) => ({
          id: lvl.id,
          name: lvl.name,
          booths: lvl.booths,
          elements: lvl.elements,
          sections: lvl.sections,
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
    right: -10,
    bottom: -10,
    width: 20,
    height: 20,
    borderRadius: 8,
    background: "#0f172a",
    border: "2px solid #fff",
    boxShadow: "0 4px 12px rgba(2,6,23,0.18)",
    cursor: "nwse-resize",
    zIndex: 3,
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
              Booth Map Editor
            </div>
            <div style={{ marginTop: 4, color: "#475569", fontWeight: 600 }}>
              Power layout builder for fast booth design, bulk editing, sections, and publishing.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button style={pill(false)} onClick={() => navigate(-1)}>
              ← Back
            </button>
            <button style={pill(false)} onClick={() => setDrawerOpen((v) => !v)}>
              {drawerOpen ? "Hide Sidebar" : "Show Sidebar"}
            </button>
            <button style={pill(true)} onClick={saveNow}>
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 18px 10px", display: "grid", gap: 12 }}>
        <ToolbarGroup
          title="View"
          items={
            <>
              <button style={pill(false)} onClick={fitToScreen}>
                Fit
              </button>
              <button style={pill(!hideGrid)} onClick={() => setHideGrid((v) => !v)}>
                Grid
              </button>
              <button style={pill(snapToGrid)} onClick={() => setSnapToGrid((v) => !v)}>
                Snap
              </button>
              <button
                style={pill(false)}
                onClick={() => setZoom((z) => clamp(+(z - 0.1).toFixed(2), 0.4, 2))}
              >
                −
              </button>
              <div style={{ minWidth: 56, textAlign: "center", fontWeight: 900 }}>
                {Math.round(zoom * 100)}%
              </div>
              <button
                style={pill(false)}
                onClick={() => setZoom((z) => clamp(+(z + 0.1).toFixed(2), 0.4, 2))}
              >
                +
              </button>
            </>
          }
        />

        <ToolbarGroup
          title="Build"
          items={
            <>
              <button style={pill(false)} onClick={addBooth}>
                Add Booth
              </button>
              <button style={pill(false)} onClick={createBoothGrid}>
                Booth Grid
              </button>
              <button style={pill(false)} onClick={duplicateSelectedBooths} disabled={!selectedBoothIds.length}>
                Duplicate Selected
              </button>
              <button style={pill(false)} onClick={duplicateFloor}>
                Duplicate Floor
              </button>
              <button style={pill(false)} onClick={() => addQuickElement("label")}>
                Add Label
              </button>
            </>
          }
        />

        <ToolbarGroup
          title="Align"
          items={
            <>
              <button style={pill(false)} onClick={() => applyAlignment("left")} disabled={selectedBoothIds.length < 2}>
                Left
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("center")} disabled={selectedBoothIds.length < 2}>
                Center
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("right")} disabled={selectedBoothIds.length < 2}>
                Right
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("top")} disabled={selectedBoothIds.length < 2}>
                Top
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("middle")} disabled={selectedBoothIds.length < 2}>
                Middle
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("bottom")} disabled={selectedBoothIds.length < 2}>
                Bottom
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("distribute-h")} disabled={selectedBoothIds.length < 3}>
                Distribute H
              </button>
              <button style={pill(false)} onClick={() => applyAlignment("distribute-v")} disabled={selectedBoothIds.length < 3}>
                Distribute V
              </button>
            </>
          }
        />

        <ToolbarGroup
          title="Output"
          items={
            <>
              <button style={pill(false)} onClick={() => window.print()}>
                Print
              </button>
              <button style={pill(isPublished)} onClick={publishEventNow}>
                Publish
              </button>
            </>
          }
        />
      </div>

      <div
        style={{
          padding: "0 18px 10px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Legend color="#22c55e" label="Available" />
        <Legend color="#f59e0b" label="Reserved" />
        <Legend color="#ef4444" label="Paid" />
        <Legend color="#8b5cf6" label="Assigned/Occupied" />
        <Legend color="#94a3b8" label="Blocked" />
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
          Shift+Click multi-select • Drag on empty canvas to box-select • Ctrl/Cmd+C/V/D supported
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontWeight: 900,
            color: saveError ? "#b91c1c" : "#334155",
          }}
        >
          {saveError || statusMsg}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: drawerOpen ? "1fr 430px" : "1fr",
          gap: 16,
          padding: "0 18px 18px",
          minHeight: 0,
          flex: 1,
        }}
      >
        <div style={{ ...softCard(), overflow: "hidden", minWidth: 0, minHeight: 0 }}>
          <div
            ref={canvasScrollerRef}
            style={{
              position: "relative",
              overflow: "auto",
              minHeight: 0,
              height: "100%",
              background: "#fff",
            }}
          >
            <div
              ref={canvasStageRef}
              onMouseDown={onCanvasMouseDown}
              style={{
                position: "relative",
                width: canvasW * zoom,
                height: canvasH * zoom,
                backgroundImage: gridBg,
                backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                cursor: selectionBox ? "crosshair" : "default",
              }}
            >
              {activeLevel.sections.map((section) => {
                const sectionBooths = activeLevel.booths.filter(
                  (b) => String(b.sectionId || "") === String(section.id)
                );
                if (!sectionBooths.length) return null;
                const minX = Math.min(...sectionBooths.map((b) => Number(b.x || 0)));
                const minY = Math.min(...sectionBooths.map((b) => Number(b.y || 0)));
                const maxX = Math.max(
                  ...sectionBooths.map((b) => Number(b.x || 0) + Number(b.width || 0))
                );
                const maxY = Math.max(
                  ...sectionBooths.map((b) => Number(b.y || 0) + Number(b.height || 0))
                );
                return (
                  <div
                    key={section.id}
                    style={{
                      position: "absolute",
                      left: (minX - 16) * zoom,
                      top: (minY - 38) * zoom,
                      width: (maxX - minX + 32) * zoom,
                      height: (maxY - minY + 54) * zoom,
                      border: `2px dashed ${section.color || "#94a3b8"}`,
                      borderRadius: 20,
                      pointerEvents: "none",
                      background: `${section.color || "#94a3b8"}10`,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 12,
                        top: 8,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: section.color || "#94a3b8",
                        color: "#fff",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      {section.name}
                    </div>
                  </div>
                );
              })}

              {activeLevel.elements.map((el) => {
                const selected = selectedKind === "element" && selectedId === el.id;
                return (
                  <div
                    key={el.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedKind("element");
                      setSelectedId(el.id);
                      setSelectedBoothIds([]);
                    }}
                    style={{
                      position: "absolute",
                      left: el.x * zoom,
                      top: el.y * zoom,
                      width: el.width * zoom,
                      height: el.height * zoom,
                      borderRadius: 18,
                      border: selected
                        ? "3px solid #4338ca"
                        : "2px dashed rgba(15,23,42,0.25)",
                      background:
                        el.type === "street"
                          ? "rgba(15,23,42,0.08)"
                          : el.type === "venue"
                          ? "rgba(2,132,199,0.06)"
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
                  </div>
                );
              })}

              {activeLevel.booths.map((b) => {
                const isSelected = selectedBoothIds.includes(String(b.id));
                const isPrimary = selectedId === String(b.id);
                const boothSection = activeLevel.sections.find(
                  (section) => String(section.id) === String(b.sectionId || "")
                );
                return (
                  <div
                    key={String(b.id)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDrawerOpen(true);

                      if (e.shiftKey) {
                        toggleBoothSelection(String(b.id));
                        return;
                      }

                      const alreadyIncluded = selectedBoothIds.includes(String(b.id));
                      const dragIds = alreadyIncluded ? selectedBoothIds : [String(b.id)];
                      selectSingleBooth(String(b.id));
                      if (e.button === 0) beginDragBooths(dragIds, e);
                    }}
                    style={{
                      position: "absolute",
                      left: Number(b.x || 0) * zoom,
                      top: Number(b.y || 0) * zoom,
                      width: Number(b.width || 120) * zoom,
                      height: Number(b.height || 90) * zoom,
                      borderRadius: 18,
                      background: statusColor(String(b.status || "available")),
                      border: isSelected
                        ? "4px solid #1d4ed8"
                        : "1px solid rgba(15,23,42,0.10)",
                      boxShadow: isSelected
                        ? "0 12px 24px rgba(37,99,235,0.24)"
                        : "0 10px 24px rgba(2,6,23,0.08)",
                      color: "#0f172a",
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      fontWeight: 900,
                      userSelect: "none",
                      opacity: b.locked ? 0.72 : 1,
                      outline: boothSection?.color ? `2px solid ${boothSection.color}` : "none",
                      outlineOffset: -2,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.label || "Booth"}
                      </div>
                      {b.locked ? (
                        <span style={{ fontSize: 11, background: "rgba(15,23,42,0.15)", padding: "2px 6px", borderRadius: 999 }}>
                          Locked
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: 11, opacity: 0.9 }}>
                          {b.category || "Uncategorized"}
                        </div>
                        <div style={{ fontSize: 14 }}>${Number(b.price || 0)}</div>
                      </div>
                      {boothSection ? (
                        <div style={{ fontSize: 11, opacity: 0.9 }}>{boothSection.name}</div>
                      ) : null}
                    </div>

                    {isPrimary && !b.locked ? (
                      <div
                        onMouseDown={(e) => beginResizeBooth(String(b.id), e)}
                        style={resizeHandleStyle}
                      />
                    ) : null}
                  </div>
                );
              })}

              {selectionBox ? (
                <div
                  style={{
                    position: "absolute",
                    left: getRectFromSelection(selectionBox).left * zoom,
                    top: getRectFromSelection(selectionBox).top * zoom,
                    width: getRectFromSelection(selectionBox).width * zoom,
                    height: getRectFromSelection(selectionBox).height * zoom,
                    border: "2px dashed rgba(37,99,235,0.9)",
                    background: "rgba(37,99,235,0.10)",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {drawerOpen ? (
          <div style={{ ...softCard(), overflow: "auto", padding: 16 }}>
            <div style={{ display: "grid", gap: 14 }}>
              <Section title="1. Workflow">
                <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                  <div><strong>Step 1:</strong> Add a booth or create a grid.</div>
                  <div><strong>Step 2:</strong> Drag, resize, shift-select, or box-select booths.</div>
                  <div><strong>Step 3:</strong> Edit single or bulk fields in the panels below.</div>
                  <div><strong>Step 4:</strong> Save and publish when the map is clean.</div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={primaryButton()} onClick={addBooth}>Add Booth</button>
                  <button style={secondaryButton()} onClick={createBoothGrid}>Create Grid</button>
                  <button style={secondaryButton()} onClick={duplicateFloor}>Duplicate Floor</button>
                </div>
              </Section>

              <Section title="2. Bulk Create">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Columns">
                    <input
                      type="number"
                      value={bulkColumns}
                      onChange={(e) => setBulkColumns(Math.max(1, Number(e.target.value || 1)))}
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Rows">
                    <input
                      type="number"
                      value={bulkRows}
                      onChange={(e) => setBulkRows(Math.max(1, Number(e.target.value || 1)))}
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Spacing X">
                    <input
                      type="number"
                      value={bulkSpacingX}
                      onChange={(e) => setBulkSpacingX(Math.max(0, Number(e.target.value || 0)))}
                      style={inputStyle()}
                    />
                  </Field>
                  <Field label="Spacing Y">
                    <input
                      type="number"
                      value={bulkSpacingY}
                      onChange={(e) => setBulkSpacingY(Math.max(0, Number(e.target.value || 0)))}
                      style={inputStyle()}
                    />
                  </Field>
                </div>
                <Field label="Booth Preset">
                  <select
                    value={bulkPreset}
                    onChange={(e) => setBulkPreset(e.target.value as keyof typeof PRESETS)}
                    style={inputStyle()}
                  >
                    <option value="standard">Standard</option>
                    <option value="compact">Compact</option>
                    <option value="premium">Premium</option>
                    <option value="island">Island</option>
                  </select>
                </Field>
                <button style={primaryButton()} onClick={createBoothGrid}>
                  Build Booth Grid
                </button>
              </Section>

              <Section title="3. Selection Editor">
                {!selectedBoothIds.length ? (
                  <div style={{ color: "#64748b", fontWeight: 700 }}>
                    Select one or more booths to edit status, category, price, size, position, notes, and lock state.
                  </div>
                ) : selectedBoothIds.length === 1 && selectedBooth ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <SelectionSummary count={1} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Label">
                        <input
                          value={String(selectedBooth.label || "")}
                          onChange={(e) => updateSelectedBooths({ label: e.target.value })}
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Status">
                        <select
                          value={String(selectedBooth.status || "available")}
                          onChange={(e) => updateSelectedBooths({ status: e.target.value })}
                          style={inputStyle()}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Booth Type / Category">
                        <select
                          value={String(selectedBooth.category || "")}
                          onChange={(e) => updateSelectedBooths({ category: e.target.value })}
                          style={inputStyle()}
                        >
                          <option value="">Select category</option>
                          {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Price">
                        <input
                          type="number"
                          value={Number(selectedBooth.price || 0)}
                          onChange={(e) => updateSelectedBooths({ price: Number(e.target.value || 0) })}
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Width">
                        <input
                          type="number"
                          value={Number(selectedBooth.width || 140)}
                          onChange={(e) =>
                            updateSelectedBooths({
                              width: quantize(Math.max(40, Number(e.target.value || 40))),
                            })
                          }
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Height">
                        <input
                          type="number"
                          value={Number(selectedBooth.height || 110)}
                          onChange={(e) =>
                            updateSelectedBooths({
                              height: quantize(Math.max(28, Number(e.target.value || 28))),
                            })
                          }
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="X Position">
                        <input
                          type="number"
                          value={Number(selectedBooth.x || 0)}
                          onChange={(e) => updateSelectedBooths({ x: quantize(Number(e.target.value || 0)) as any })}
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Y Position">
                        <input
                          type="number"
                          value={Number(selectedBooth.y || 0)}
                          onChange={(e) => updateSelectedBooths({ y: quantize(Number(e.target.value || 0)) as any })}
                          style={inputStyle()}
                        />
                      </Field>
                    </div>

                    <Field label="Section Assignment">
                      <select
                        value={String(selectedBooth.sectionId || "")}
                        onChange={(e) => assignSelectedToSection(e.target.value)}
                        style={inputStyle()}
                      >
                        <option value="">No section</option>
                        {activeLevel.sections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Notes">
                      <textarea
                        value={String(selectedBooth.notes || "")}
                        onChange={(e) => updateSelectedBooths({ notes: e.target.value })}
                        style={{ ...inputStyle(), minHeight: 86, resize: "vertical" }}
                      />
                    </Field>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedBooth.locked)}
                        onChange={(e) => updateSelectedBooths({ locked: e.target.checked })}
                      />
                      Lock booth
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button style={secondaryButton()} onClick={duplicateSelectedBooths}>
                        Duplicate Booth
                      </button>
                      <button style={dangerButton()} onClick={deleteSelected}>
                        Delete Booth
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    <SelectionSummary count={selectedBoothIds.length} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Bulk Status">
                        <select
                          defaultValue=""
                          onChange={(e) => e.target.value && updateSelectedBooths({ status: e.target.value })}
                          style={inputStyle()}
                        >
                          <option value="">Apply status…</option>
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Bulk Category">
                        <select
                          defaultValue=""
                          onChange={(e) => updateSelectedBooths({ category: e.target.value })}
                          style={inputStyle()}
                        >
                          <option value="">Apply category…</option>
                          {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Bulk Price">
                        <input
                          type="number"
                          placeholder="Set price for selected"
                          onBlur={(e) => {
                            if (e.target.value !== "") {
                              updateSelectedBooths({ price: Number(e.target.value || 0) });
                            }
                          }}
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Assign to Section">
                        <select
                          value={selectedSectionId}
                          onChange={(e) => {
                            setSelectedSectionId(e.target.value);
                            assignSelectedToSection(e.target.value);
                          }}
                          style={inputStyle()}
                        >
                          <option value="">No section</option>
                          {activeLevel.sections.map((section) => (
                            <option key={section.id} value={section.id}>
                              {section.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Bulk Width">
                        <input
                          type="number"
                          placeholder="Apply width"
                          onBlur={(e) => {
                            if (e.target.value !== "") {
                              updateSelectedBooths({
                                width: quantize(Math.max(40, Number(e.target.value || 40))),
                              });
                            }
                          }}
                          style={inputStyle()}
                        />
                      </Field>
                      <Field label="Bulk Height">
                        <input
                          type="number"
                          placeholder="Apply height"
                          onBlur={(e) => {
                            if (e.target.value !== "") {
                              updateSelectedBooths({
                                height: quantize(Math.max(28, Number(e.target.value || 28))),
                              });
                            }
                          }}
                          style={inputStyle()}
                        />
                      </Field>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button style={secondaryButton()} onClick={() => updateSelectedBooths({ locked: true })}>
                        Lock Selected
                      </button>
                      <button style={secondaryButton()} onClick={() => updateSelectedBooths({ locked: false })}>
                        Unlock Selected
                      </button>
                      <button style={secondaryButton()} onClick={duplicateSelectedBooths}>
                        Duplicate Selected
                      </button>
                      <button style={dangerButton()} onClick={deleteSelected}>
                        Delete Selected
                      </button>
                    </div>
                  </div>
                )}
              </Section>

              <Section title="4. Sections">
                <Field label="New Section Name">
                  <input
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    placeholder="Example: Food Court"
                    style={inputStyle()}
                  />
                </Field>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={primaryButton()} onClick={createSection}>
                    Create Section
                  </button>
                  <button
                    style={secondaryButton()}
                    disabled={!currentSection}
                    onClick={() => currentSection && duplicateSection(currentSection.id)}
                  >
                    Duplicate Section
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {activeLevel.sections.length ? (
                    activeLevel.sections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => {
                          setSelectedSectionId(section.id);
                          setSelectedBoothIds([...section.boothIds]);
                          setSelectedId(section.boothIds[0] || null);
                          setSelectedKind(section.boothIds.length ? "booth" : null);
                        }}
                        style={{
                          ...secondaryButton(),
                          textAlign: "left",
                          borderColor:
                            section.id === selectedSectionId
                              ? "rgba(99,102,241,0.35)"
                              : "rgba(15,23,42,0.12)",
                          background:
                            section.id === selectedSectionId
                              ? "rgba(99,102,241,0.08)"
                              : "#fff",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 999,
                                background: section.color,
                                display: "inline-block",
                              }}
                            />
                            <span style={{ fontWeight: 900 }}>{section.name}</span>
                          </div>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {section.boothIds.length} booths
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div style={{ color: "#64748b", fontWeight: 700 }}>
                      No sections yet. Create one, then assign selected booths to it.
                    </div>
                  )}
                </div>
              </Section>

              <Section title="Floor + Canvas">
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={primaryButton()} onClick={addLevel}>Add Floor</button>
                    <button style={secondaryButton()} onClick={duplicateFloor}>Duplicate Active Floor</button>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {levels.map((lvl) => (
                      <button
                        key={lvl.id}
                        onClick={() => {
                          setActiveLevelId(lvl.id);
                          clearSelection();
                        }}
                        style={{
                          ...secondaryButton(),
                          textAlign: "left",
                          borderColor:
                            lvl.id === activeLevelId
                              ? "rgba(99,102,241,0.35)"
                              : "rgba(15,23,42,0.12)",
                          background:
                            lvl.id === activeLevelId
                              ? "rgba(99,102,241,0.08)"
                              : "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>{lvl.name}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {lvl.booths.length} booths • {lvl.sections.length} sections
                        </div>
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Canvas Width">
                      <input
                        type="number"
                        value={canvasW}
                        onChange={(e) => {
                          setCanvasW(Math.max(400, Number(e.target.value || 400)));
                          markDirty();
                        }}
                        style={inputStyle()}
                      />
                    </Field>
                    <Field label="Canvas Height">
                      <input
                        type="number"
                        value={canvasH}
                        onChange={(e) => {
                          setCanvasH(Math.max(300, Number(e.target.value || 300)));
                          markDirty();
                        }}
                        style={inputStyle()}
                      />
                    </Field>
                    <Field label="Grid Size">
                      <input
                        type="number"
                        value={gridSize}
                        onChange={(e) => {
                          setGridSize(Math.max(8, Number(e.target.value || 8)));
                          markDirty();
                        }}
                        style={inputStyle()}
                      />
                    </Field>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolbarGroup({
  title,
  items,
}: {
  title: string;
  items: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "12px 14px",
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: 16,
        background: "rgba(255,255,255,0.96)",
      }}
    >
      <div style={{ minWidth: 58, fontWeight: 900, color: "#0f172a" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {items}
      </div>
    </div>
  );
}

function SelectionSummary({ count }: { count: number }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: "10px 12px",
        background: "rgba(99,102,241,0.08)",
        color: "#4338ca",
        fontWeight: 900,
      }}
    >
      {count} booth{count === 1 ? "" : "s"} selected
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
