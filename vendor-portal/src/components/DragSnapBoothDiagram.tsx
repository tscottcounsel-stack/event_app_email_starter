// src/components/DragSnapBoothDiagram.tsx
import React, { useMemo, useRef, useState, MouseEvent } from "react";

export type BoothStatus =
  | "available"
  | "assignedToYou"
  | "assigned"
  | "reserved"
  | "pending"
  | "rejected"
  | "hidden"
  | "blocked";

export type Booth = {
  id: string;
  label: string;
  x: number; // pixels
  y: number; // pixels
  width: number; // pixels
  height: number; // pixels
  status?: BoothStatus;
};

type ViewMode = "vendor" | "organizer";

export type DragSnapBoothDiagramProps = {
  booths: Booth[];
  gridSize: number; // px per grid cell, e.g. 20
  readOnly?: boolean;
  viewMode?: ViewMode;
  onBoothsChange?: (next: Booth[]) => void; // used when drag is enabled
  onSelectBooth?: (label: string | null) => void; // notify parent which booth is selected
};

type DragState = {
  boothId: string;
  offsetX: number;
  offsetY: number;
} | null;

function boothClasses(
  status: BoothStatus | undefined,
  viewMode: ViewMode
): string {
  // Vendor view:
  //  - Green  = available
  //  - Blue   = assigned to YOU
  //  - Red    = reserved / blocked
  //
  // Organizer view:
  //  - Green  = available
  //  - Blue   = assigned (any vendor / reserved)
  //  - Gold   = pending
  //  - Red    = rejected / blocked
  //  - Gray   = hidden

  switch (status) {
    case "assignedToYou":
      // always blue highlight
      return "bg-sky-500 border-sky-300 text-white";

    case "assigned":
      if (viewMode === "organizer") {
        return "bg-sky-500 border-sky-300 text-white"; // assigned booth
      }
      return "bg-rose-500 border-rose-300 text-white"; // vendor: treat as taken

    case "reserved":
      if (viewMode === "organizer") {
        return "bg-sky-400 border-sky-300 text-white"; // reserved / assigned
      }
      return "bg-rose-500 border-rose-300 text-white"; // vendor: someone else has it

    case "pending":
      return "bg-amber-400 border-amber-500 text-slate-900";

    case "rejected":
    case "blocked":
      return "bg-red-500 border-red-400 text-white";

    case "hidden":
      return "bg-slate-500 border-slate-400 text-white";

    case "available":
    default:
      return "bg-emerald-400 border-emerald-500 text-emerald-950";
  }
}

const DragSnapBoothDiagram: React.FC<DragSnapBoothDiagramProps> = ({
  booths,
  gridSize,
  readOnly = false,
  viewMode = "vendor",
  onBoothsChange,
  onSelectBooth,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Canvas size based on booth extents
  const { width, height } = useMemo(() => {
    if (!booths.length) {
      return { width: 12 * gridSize, height: 8 * gridSize };
    }
    let maxX = 0;
    let maxY = 0;
    for (const b of booths) {
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return {
      width: maxX + gridSize,
      height: maxY + gridSize,
    };
  }, [booths, gridSize]);

  function handleBoothMouseDown(b: Booth, e: MouseEvent<HTMLButtonElement>) {
  // Never let this bubble up to the container's click handler
  e.stopPropagation();

  if (!readOnly) {
    e.preventDefault();
  }

  if (readOnly) {
    const next = selectedId === b.id ? null : b.id;
    setSelectedId(next);
    onSelectBooth?.(next ? b.label : null);
    return;
  }

  const container = containerRef.current;
  if (!container) return;
  const rect = container.getBoundingClientRect();

  const cursorX = e.clientX - rect.left;
  const cursorY = e.clientY - rect.top;

  setDrag({
    boothId: b.id,
    offsetX: cursorX - b.x,
    offsetY: cursorY - b.y,
  });
  setSelectedId(b.id);
  onSelectBooth?.(b.label);
}

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!drag || readOnly || !onBoothsChange) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    let newX = cursorX - drag.offsetX;
    let newY = cursorY - drag.offsetY;

    // clamp to canvas
    newX = Math.max(0, Math.min(width - gridSize, newX));
    newY = Math.max(0, Math.min(height - gridSize, newY));

    // snap to nearest grid cell
    const snappedX = Math.round(newX / gridSize) * gridSize;
    const snappedY = Math.round(newY / gridSize) * gridSize;

    onBoothsChange(
      booths.map((b) =>
        b.id === drag.boothId ? { ...b, x: snappedX, y: snappedY } : b
      )
    );
  }

  function endDrag() {
    if (drag) setDrag(null);
  }

  function clearSelection() {
    setSelectedId(null);
    onSelectBooth?.(null);
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative overflow-auto rounded-lg border border-slate-800 bg-slate-950"
        style={{ maxHeight: 500 }}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
          onClick={(e) => {
    if (e.target === e.currentTarget) {
      clearSelection();
    }
  }}
>

        <div
          className="relative"
          style={{
            width,
            height,
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px)," +
              "linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)",
            backgroundSize: `${gridSize}px ${gridSize}px`,
          }}
        >
          {booths.map((b) => {
            const isSelected = b.id === selectedId;
            return (
              <button
                key={b.id}
                type="button"
                onMouseDown={(e) => handleBoothMouseDown(b, e)}
                className={[
                  "absolute flex flex-col items-center justify-center rounded-md border text-[10px] font-semibold px-1 text-center select-none",
                  boothClasses(b.status, viewMode),
                  isSelected
                    ? "ring-2 ring-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.9)]"
                    : "shadow-sm",
                  readOnly ? "cursor-default" : "cursor-move",
                ].join(" ")}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.width,
                  height: b.height,
                }}
                title={b.label}
              >
                <span className="truncate w-full">{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        <span className="font-semibold text-slate-300">Legend:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-emerald-400 border border-emerald-500" />
          Available
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-sky-500 border border-sky-300" />
          Assigned / mine
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-amber-400 border border-amber-500" />
          Pending
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-rose-500 border border-rose-300" />
          Reserved / blocked / rejected
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-slate-500 border border-slate-400" />
          Hidden
        </span>
      </div>
    </div>
  );
};

export default DragSnapBoothDiagram;
