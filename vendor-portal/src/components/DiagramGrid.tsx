// src/components/DiagramGrid.tsx
import React, {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type SlotStatus =
  | "available"
  | "pending"
  | "approved"
  | "assigned"
  | "blocked"
  | string;

type SlotLike = {
  id?: number;
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
  coord_x?: number;
  coord_y?: number;
  status?: SlotStatus;
  db_slot_id?: number | null;
  price_cents?: number;
  kind?: string;
  category_id?: number | null;
};

type BoothMapEntry = {
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
  coord_x?: number;
  coord_y?: number;
  status?: SlotStatus;
  db_slot_id?: number | null;
  price_cents?: number;
  kind?: string;
  category_id?: number | null;
};

type DiagramLike = {
  grid_px?: number;
  slots?: SlotLike[];
  boothMap?: Record<string, BoothMapEntry>;
  slotsByLabel?: Record<string, BoothMapEntry>;
};

type BoothView = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: SlotStatus;
  db_slot_id: number | null;
};

type NormalizedDiagram = {
  grid_px: number;
  slots: SlotLike[];
  boothMap: Record<string, BoothMapEntry> | null;
};

export type DiagramGridProps = {
  diagram?: DiagramLike | null;
  onDiagramChange?: (next: { grid_px: number; slots: SlotLike[] }) => void;

  selectedLabel?: string | null;
  onSelectedLabelChange?: (label: string | null) => void;
};

/**
 * Normalize whatever the backend gives us into a safe shape.
 */
function normalizeDiagram(diagram?: DiagramLike | null): NormalizedDiagram {
  const grid_px =
    typeof diagram?.grid_px === "number" && diagram.grid_px > 0
      ? diagram.grid_px
      : 32;

  let boothMap: Record<string, BoothMapEntry> | null = null;
  let slots: SlotLike[] = [];

  // Primary source: slots[]
  if (Array.isArray(diagram?.slots)) {
    slots = diagram!.slots!.map((s) => ({ ...s }));
  }

  // Optional: boothMap / slotsByLabel
  const rawMap =
    (diagram &&
      (diagram.boothMap || diagram.slotsByLabel)) as
      | Record<string, BoothMapEntry>
      | undefined;

  if (rawMap && typeof rawMap === "object") {
    boothMap = { ...rawMap };

    // If slots is empty, derive slots from the map
    if (slots.length === 0) {
      slots = Object.keys(rawMap).map((label) => ({
        label,
        ...(rawMap[label] || {}),
      }));
    }
  }

  return { grid_px, slots, boothMap };
}

/**
 * Turn normalized slots into view-model booths.
 */
function boothsFromDiagram(d: NormalizedDiagram): BoothView[] {
  const sourceSlots: SlotLike[] = Array.isArray(d.slots) ? d.slots : [];

  return sourceSlots.map((raw, index) => {
    const label = raw.label ?? `#${index + 1}`;
    const w =
      typeof raw.w === "number"
        ? raw.w
        : typeof raw.width === "number"
        ? raw.width
        : 1;
    const h =
      typeof raw.h === "number"
        ? raw.h
        : typeof raw.height === "number"
        ? raw.height
        : 1;
    const x =
      typeof raw.x === "number"
        ? raw.x
        : typeof raw.coord_x === "number"
        ? raw.coord_x
        : 1;
    const y =
      typeof raw.y === "number"
        ? raw.y
        : typeof raw.coord_y === "number"
        ? raw.coord_y
        : 1;

    const status: SlotStatus =
      typeof raw.status === "string" && raw.status.length > 0
        ? raw.status
        : "available";

    const db_slot_id =
      typeof raw.db_slot_id === "number"
        ? raw.db_slot_id
        : typeof raw.id === "number"
        ? raw.id
        : null;

    return {
      label,
      x,
      y,
      width: w || 1,
      height: h || 1,
      status,
      db_slot_id,
    };
  });
}

/**
 * Turn edited booths back into slots for the backend.
 */
function boothsToSlots(
  booths: BoothView[],
  templateSlots: SlotLike[],
): SlotLike[] {
  const byLabel = new Map<string, SlotLike>();
  for (const s of templateSlots) {
    if (s.label) byLabel.set(s.label, s);
  }

  return booths.map((b) => {
    const base = byLabel.get(b.label) ?? {};
    return {
      ...base,
      label: b.label,
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      status: (b.status as SlotStatus) ?? base.status ?? "available",
      db_slot_id:
        typeof b.db_slot_id === "number"
          ? b.db_slot_id
          : base.db_slot_id ?? null,
    };
  });
}

type DragState =
  | null
  | {
      type: "move";
      label: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      type: "resize";
      label: string;
      startX: number;
      startY: number;
      originW: number;
      originH: number;
    };

const GRID_COLOR = "rgba(255,255,255,0.04)";
const BOOTH_BORDER = "rgba(155, 246, 255, 0.9)";
const BOOTH_FILL = "rgba(24, 190, 210, 0.9)";
const BOOTH_FILL_SELECTED = "rgba(120, 247, 255, 0.9)";

const DiagramGrid: React.FC<DiagramGridProps> = ({
  diagram,
  onDiagramChange,
  selectedLabel,
  onSelectedLabelChange,
}) => {
  const normalized = useMemo(() => normalizeDiagram(diagram), [diagram]);
  const [booths, setBooths] = useState<BoothView[]>(() =>
    boothsFromDiagram(normalized),
  );

  // Reset local booths when server diagram changes (e.g. Refresh button)
  useEffect(() => {
    setBooths(boothsFromDiagram(normalized));
  }, [normalized.grid_px, normalized.slots.length]);

  const [dragState, setDragState] = useState<DragState>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const gridSize = normalized.grid_px || 32;

  const handleSelect = (label: string | null) => {
    onSelectedLabelChange?.(label);
  };

  const handleMouseDownBooth = (
    e: ReactMouseEvent<HTMLDivElement>,
    booth: BoothView,
    mode: "move" | "resize",
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    if (mode === "move") {
      setDragState({
        type: "move",
        label: booth.label,
        startX,
        startY,
        originX: booth.x,
        originY: booth.y,
      });
    } else {
      setDragState({
        type: "resize",
        label: booth.label,
        startX,
        startY,
        originW: booth.width,
        originH: booth.height,
      });
    }

    handleSelect(booth.label);
  };

  const handleCanvasMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Click on empty space clears selection
    if (e.target === canvasRef.current) {
      handleSelect(null);
    }
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragState) return;

    e.preventDefault();
    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;

    setBooths((prev) => {
      const next = prev.map((b) => {
        if (b.label !== dragState.label) return b;

        if (dragState.type === "move") {
          const nextX =
            dragState.originX + Math.round(deltaX / gridSize);
          const nextY =
            dragState.originY + Math.round(deltaY / gridSize);

          return {
            ...b,
            x: Math.max(1, nextX),
            y: Math.max(1, nextY),
          };
        } else {
          const nextW =
            dragState.originW + Math.round(deltaX / gridSize);
          const nextH =
            dragState.originH + Math.round(deltaY / gridSize);

          return {
            ...b,
            width: Math.max(1, nextW),
            height: Math.max(1, nextH),
          };
        }
      });

      // Push updated layout up to the page so "Save layout" can send it
      onDiagramChange?.({
        grid_px: gridSize,
        slots: boothsToSlots(next, normalized.slots),
      });

      return next;
    });
  };

  const handleMouseUp = () => {
    if (dragState) setDragState(null);
  };

  // These just control how big the canvas is visually
  const rows = 30;
  const cols = 40;

  return (
    <div
      ref={canvasRef}
      className="diagram-grid-canvas"
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: "relative",
        width: cols * gridSize,
        height: rows * gridSize,
        backgroundColor: "#050914",
        backgroundImage: `
          linear-gradient(${GRID_COLOR} 1px, transparent 1px),
          linear-gradient(90deg, ${GRID_COLOR} 1px, transparent 1px)
        `,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {booths.map((booth) => {
        const left = (booth.x - 1) * gridSize;
        const top = (booth.y - 1) * gridSize;
        const width = booth.width * gridSize;
        const height = booth.height * gridSize;
        const isSelected = selectedLabel === booth.label;

        return (
          <div
            key={booth.label}
            onMouseDown={(e) => handleMouseDownBooth(e, booth, "move")}
            style={{
              position: "absolute",
              left,
              top,
              width,
              height,
              borderRadius: 10,
              border: `2px solid ${BOOTH_BORDER}`,
              backgroundColor: isSelected
                ? BOOTH_FILL_SELECTED
                : BOOTH_FILL,
              boxShadow: isSelected
                ? "0 0 0 2px rgba(255,255,255,0.7)"
                : "0 0 0 1px rgba(0,0,0,0.4)",
              cursor: "grab",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 12,
              userSelect: "none",
            }}
          >
            <span>
              {booth.label}{" "}
              {booth.width}x{booth.height}
            </span>

            {/* Resize handle in bottom-right corner */}
            <div
              onMouseDown={(e) => handleMouseDownBooth(e, booth, "resize")}
              style={{
                position: "absolute",
                right: 4,
                bottom: 4,
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: "#fff",
                cursor: "nwse-resize",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export default DiagramGrid;
