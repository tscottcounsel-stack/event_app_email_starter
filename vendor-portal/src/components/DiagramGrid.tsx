// src/components/DiagramGrid.tsx
import React, { useEffect, useMemo, useState } from "react";

export type DiagramGridProps = {
  diagram: any;
  onDiagramChange: (next: any) => void;
  selectedLabels?: string[];
  onSelectionChange?: (labels: string[]) => void;
};

type BoothView = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  raw: any;
};

type DragState =
  | {
      mode: "move";
      labels: string[];
      startClientX: number;
      startClientY: number;
      origins: { label: string; x: number; y: number }[];
    }
  | {
      mode: "resize";
      labels: string[];
      startClientX: number;
      startClientY: number;
      origins: { label: string; width: number; height: number }[];
    }
  | null;

const CELL_SIZE = 40;

// Map status -> Tailwind classes
function statusClasses(status: string, selected: boolean): string {
  const base =
    "absolute rounded-md border text-xs transition-colors duration-75 flex items-center justify-center select-none";
  const ring = selected ? " ring-2 ring-offset-2 ring-offset-slate-900" : "";

  switch (status) {
    case "assigned": // blue
      return (
        base +
        " border-sky-400 bg-sky-900/70 text-sky-100 hover:bg-sky-800" +
        ring
      );
    case "reserved": // orange
      return (
        base +
        " border-orange-400 bg-orange-900/70 text-orange-100 hover:bg-orange-800" +
        ring
      );
    case "pending": // yellow
      return (
        base +
        " border-amber-400 bg-amber-900/70 text-amber-100 hover:bg-amber-800" +
        ring
      );
    case "blocked": // red
      return (
        base +
        " border-red-400 bg-red-900/70 text-red-100 hover:bg-red-800" +
        ring
      );
    case "street": // 🛣 street / walkway
      return (
        base +
        " border-slate-400 border-dashed bg-slate-900/90 text-slate-100 hover:bg-slate-800" +
        ring
      );
    case "available":
    default: // green
      return (
        base +
        " border-emerald-400 bg-emerald-900/70 text-emerald-100 hover:bg-emerald-800" +
        ring
      );
  }
}
export const DiagramGrid: React.FC<DiagramGridProps> = ({
  diagram,
  onDiagramChange,
  selectedLabels = [],
  onSelectionChange,
}) => {
  const [drag, setDrag] = useState<DragState>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    label: string;
    booth: BoothView;
    x: number;
    y: number;
  } | null>(null);

  const booths: BoothView[] = useMemo(() => {
    const map = (diagram && diagram.boothMap) || {};
    return Object.keys(map).map((label) => {
      const b: any = map[label] || {};

      const width =
        typeof b.width === "number"
          ? b.width
          : typeof b.w === "number"
          ? b.w
          : 1;
      const height =
        typeof b.height === "number"
          ? b.height
          : typeof b.h === "number"
          ? b.h
          : 1;

      const statusRaw =
        typeof b.status === "string" && b.status.length > 0
          ? b.status.toLowerCase()
          : "available";

      return {
        label,
        x: typeof b.x === "number" ? b.x : 0,
        y: typeof b.y === "number" ? b.y : 0,
        width,
        height,
        status: statusRaw,
        raw: b,
      };
    });
  }, [diagram]);

  const widthPx = (diagram?.width ?? 1200) || 1200;
  const heightPx = (diagram?.height ?? 800) || 800;

  // ---------------- drag / resize behavior ----------------

  useEffect(() => {
    if (!drag) return;

    function handleMove(e: MouseEvent) {
      if (!drag || !diagram) return;

      const dxPx = e.clientX - drag.startClientX;
      const dyPx = e.clientY - drag.startClientY;
      const dxCells = Math.round(dxPx / CELL_SIZE);
      const dyCells = Math.round(dyPx / CELL_SIZE);

      const map = { ...(diagram.boothMap || {}) };

      if (drag.mode === "move") {
        for (const origin of drag.origins) {
          const current: any = map[origin.label];
          if (!current) continue;

          const newX = Math.max(0, origin.x + dxCells);
          const newY = Math.max(0, origin.y + dyCells);

          map[origin.label] = {
            ...current,
            x: newX,
            y: newY,
          };
        }
      } else if (drag.mode === "resize") {
        for (const origin of drag.origins) {
          const current: any = map[origin.label];
          if (!current) continue;

          const newW = Math.max(1, origin.width + dxCells);
          const newH = Math.max(1, origin.height + dyCells);

          map[origin.label] = {
            ...current,
            width: newW,
            height: newH,
          };
        }
      }

      onDiagramChange({
        ...diagram,
        boothMap: map,
      });
    }

    function handleUp() {
      setDrag(null);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [drag, diagram, onDiagramChange]);

  const handleBoothMouseDown = (
    e: React.MouseEvent,
    booth: BoothView
  ) => {
    e.stopPropagation();

    // Multi-select logic
    let nextSelection: string[];
    const multiKey = e.shiftKey || e.ctrlKey || e.metaKey;

    if (multiKey) {
      const alreadySelected = selectedLabels.includes(booth.label);
      if (alreadySelected) {
        nextSelection = selectedLabels.filter((l) => l !== booth.label);
      } else {
        nextSelection = [...selectedLabels, booth.label];
      }
    } else {
      nextSelection = [booth.label];
    }

    onSelectionChange?.(nextSelection);

    const activeLabels =
      nextSelection.length > 0 ? nextSelection : [booth.label];

    // Get origins for all active labels
    const originsMove: { label: string; x: number; y: number }[] = [];
    const originsResize: { label: string; width: number; height: number }[] =
      [];

    for (const lbl of activeLabels) {
      const b = booths.find((x) => x.label === lbl);
      if (!b) continue;
      originsMove.push({ label: lbl, x: b.x, y: b.y });
      originsResize.push({ label: lbl, width: b.width, height: b.height });
    }

    if (e.button === 0) {
      // left click -> move
      setDrag({
        mode: "move",
        labels: activeLabels,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origins: originsMove,
      });
    }
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    booth: BoothView
  ) => {
    e.stopPropagation();

    const activeLabels =
      selectedLabels.length > 0 && selectedLabels.includes(booth.label)
        ? selectedLabels
        : [booth.label];

    onSelectionChange?.(
      activeLabels.includes(booth.label) ? activeLabels : [booth.label]
    );

    const originsResize: { label: string; width: number; height: number }[] =
      [];

    for (const lbl of activeLabels) {
      const b = booths.find((x) => x.label === lbl);
      if (!b) continue;
      originsResize.push({ label: lbl, width: b.width, height: b.height });
    }

    setDrag({
      mode: "resize",
      labels: activeLabels,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origins: originsResize,
    });
  };

  const handleBackgroundMouseDown = () => {
    onSelectionChange?.([]);
  };

  const handleBackgroundMouseLeave = () => {
    setHoverInfo(null);
  };

  // ---------------- render ----------------

  return (
    <div
      className="relative w-full overflow-hidden rounded-md bg-slate-950"
      style={{ minHeight: 320 }}
      onMouseDown={handleBackgroundMouseDown}
      onMouseLeave={handleBackgroundMouseLeave}
    >
      {/* grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.15) 1px, transparent 1px), " +
            "linear-gradient(to bottom, rgba(148,163,184,0.15) 1px, transparent 1px)",
          backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
        }}
      />

      <div
        className="relative"
        style={{
          width: widthPx,
          height: heightPx,
        }}
      >
        {booths.map((booth) => {
          const left = booth.x * CELL_SIZE;
          const top = booth.y * CELL_SIZE;
          const w = booth.width * CELL_SIZE;
          const h = booth.height * CELL_SIZE;
          const isSelected = selectedLabels.includes(booth.label);

          return (
            <div
              key={booth.label}
              className={statusClasses(booth.status, isSelected)}
              style={{ left, top, width: w, height: h }}
              onMouseDown={(e) => handleBoothMouseDown(e, booth)}
              onMouseEnter={(e) =>
                setHoverInfo({
                  label: booth.label,
                  booth,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onMouseMove={(e) =>
                setHoverInfo((info) =>
                  info ? { ...info, x: e.clientX, y: e.clientY } : null,
                )
              }
              onMouseLeave={() => setHoverInfo(null)}
            >
              <div className="pointer-events-none flex flex-col items-center justify-center px-1 text-center leading-tight">
                <div className="text-[10px] font-semibold">
                  {booth.label}
                </div>
                <div className="text-[10px] opacity-75">
                  {booth.width}×{booth.height}
                </div>
              </div>

              {/* resize handle */}
              <div
                className="absolute bottom-0 right-0 h-3 w-3 translate-x-1 translate-y-1 cursor-se-resize rounded-sm bg-white/80"
                onMouseDown={(e) => handleResizeMouseDown(e, booth)}
              />
            </div>
          );
        })}
      </div>

      {hoverInfo && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-black/80 px-2 py-1 text-xs text-white shadow-lg"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
        >
          <div className="font-semibold">{hoverInfo.label}</div>
          <div className="text-[11px] opacity-80">
            Size: {hoverInfo.booth.width}×{hoverInfo.booth.height}
          </div>
          <div className="text-[11px] opacity-80">
            Status: {hoverInfo.booth.status}
          </div>
        </div>
      )}
    </div>
  );
};
