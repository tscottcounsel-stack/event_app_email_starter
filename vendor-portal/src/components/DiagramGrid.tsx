// src/components/DiagramGrid.tsx
import React, { useEffect, useMemo, useState } from "react";

export type DiagramGridProps = {
  diagram: any;
  onDiagramChange: (next: any) => void;
  selectedLabel?: string | null;
  onSelectBooth?: (label: string | null) => void;
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
      label: string;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
    }
  | {
      mode: "resize";
      label: string;
      startClientX: number;
      startClientY: number;
      origWidth: number;
      origHeight: number;
    }
  | null;

const CELL_SIZE = 40;

function normalizeStatus(status: any): string {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s || "available";
}

function getCategory(raw: any): string | null {
  const v = raw?.category;
  if (typeof v === "string" && v.trim().length) return v.trim();
  return null;
}

function moneyFromBooth(raw: any): string | null {
  // Supports:
  // - priceCents (int)
  // - price (number dollars)
  // - priceDollars (number dollars)
  const cents = typeof raw?.priceCents === "number" ? raw.priceCents : null;
  if (typeof cents === "number" && Number.isFinite(cents)) {
    const dollars = cents / 100;
    if (!Number.isFinite(dollars)) return null;
    return dollars.toFixed(2).replace(/\.00$/, "");
  }

  const price = typeof raw?.price === "number" ? raw.price : null;
  if (typeof price === "number" && Number.isFinite(price)) {
    return price.toFixed(2).replace(/\.00$/, "");
  }

  const dollars = typeof raw?.priceDollars === "number" ? raw.priceDollars : null;
  if (typeof dollars === "number" && Number.isFinite(dollars)) {
    return dollars.toFixed(2).replace(/\.00$/, "");
  }

  return null;
}

function statusColors(status: string) {
  const s = normalizeStatus(status);

  // These are tuned to look like your screenshot:
  // - strong fill
  // - subtle border
  // - readable white text
  switch (s) {
    case "pending":
      return {
        bg: "bg-amber-500",
        border: "border-amber-300/60",
        shadow: "shadow-amber-500/40",
      };
    case "reserved":
      return {
        bg: "bg-orange-500",
        border: "border-orange-300/60",
        shadow: "shadow-orange-500/40",
      };
    case "assigned":
    case "booked":
      return {
        bg: "bg-red-500",
        border: "border-red-300/60",
        shadow: "shadow-red-500/40",
      };
    case "blocked":
      return {
        bg: "bg-slate-800",
        border: "border-slate-400/40",
        shadow: "shadow-slate-900/40",
      };
    case "available":
    default:
      return {
        bg: "bg-emerald-500",
        border: "border-emerald-300/60",
        shadow: "shadow-emerald-500/40",
      };
  }
}

export const DiagramGrid: React.FC<DiagramGridProps> = ({
  diagram,
  onDiagramChange,
  selectedLabel,
  onSelectBooth,
}) => {
  const [drag, setDrag] = useState<DragState>(null);

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

      return {
        label,
        x: typeof b.x === "number" ? b.x : 0,
        y: typeof b.y === "number" ? b.y : 0,
        width,
        height,
        status: normalizeStatus(b.status),
        raw: b,
      };
    });
  }, [diagram]);

  const widthPx = (diagram?.width ?? 1200) || 1200;
  const heightPx = (diagram?.height ?? 800) || 800;

  // Drag / resize behavior
  useEffect(() => {
    if (!drag) return;

    function handleMove(e: MouseEvent) {
      if (!drag || !diagram) return;

      const dxPx = e.clientX - drag.startClientX;
      const dyPx = e.clientY - drag.startClientY;
      const dxCells = Math.round(dxPx / CELL_SIZE);
      const dyCells = Math.round(dyPx / CELL_SIZE);

      const map = { ...(diagram.boothMap || {}) };
      const current: any = map[drag.label];
      if (!current) return;

      if (drag.mode === "move") {
        const newX = Math.max(0, drag.origX + dxCells);
        const newY = Math.max(0, drag.origY + dyCells);
        map[drag.label] = { ...current, x: newX, y: newY };
      } else if (drag.mode === "resize") {
        const newW = Math.max(1, drag.origWidth + dxCells);
        const newH = Math.max(1, drag.origHeight + dyCells);
        map[drag.label] = { ...current, width: newW, height: newH };
      }

      onDiagramChange({ ...diagram, boothMap: map });
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

  const handleBoothMouseDown = (e: React.MouseEvent, booth: BoothView) => {
    e.stopPropagation();
    onSelectBooth?.(booth.label);

    // left click only
    if (e.button === 0) {
      setDrag({
        mode: "move",
        label: booth.label,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: booth.x,
        origY: booth.y,
      });
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent, booth: BoothView) => {
    e.stopPropagation();
    onSelectBooth?.(booth.label);

    setDrag({
      mode: "resize",
      label: booth.label,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origWidth: booth.width,
      origHeight: booth.height,
    });
  };

  const handleBackgroundMouseDown = () => {
    onSelectBooth?.(null);
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-md bg-white"
      style={{ minHeight: 320 }}
      onMouseDown={handleBackgroundMouseDown}
    >
      {/* Grid background like the Figma editor look */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px), " +
            "linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)",
          backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
        }}
      />

      <div className="relative" style={{ width: widthPx, height: heightPx }}>
        {booths.map((booth) => {
          const left = booth.x * CELL_SIZE;
          const top = booth.y * CELL_SIZE;
          const w = booth.width * CELL_SIZE;
          const h = booth.height * CELL_SIZE;

          const isSelected = selectedLabel === booth.label;
          const { bg, border, shadow } = statusColors(booth.status);

          const price = moneyFromBooth(booth.raw);
          const category = getCategory(booth.raw);

          return (
            <div
              key={booth.label}
              onMouseDown={(e) => handleBoothMouseDown(e, booth)}
              className={[
                "absolute rounded-lg border",
                bg,
                border,
                "text-white",
                "shadow-lg",
                shadow,
                isSelected ? "ring-4 ring-blue-500/70 border-blue-500" : "",
              ].join(" ")}
              style={{
                left,
                top,
                width: w,
                height: h,
              }}
              title={booth.label}
            >
              {/* Content INSIDE booth (matches your screenshot intent) */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center leading-tight">
                <div className="font-extrabold drop-shadow-sm text-[12px]">
                  {booth.label}
                </div>

                {price ? (
                  <div className="mt-1 font-bold drop-shadow-sm text-[11px] opacity-95">
                    ${price}
                  </div>
                ) : null}

                {category ? (
                  <div className="mt-1 font-semibold drop-shadow-sm text-[11px] opacity-95">
                    {category}
                  </div>
                ) : null}
              </div>

              {/* Resize handle */}
              <div
                className="absolute bottom-0 right-0 h-3 w-3 translate-x-1 translate-y-1 cursor-se-resize rounded-sm bg-white/90"
                onMouseDown={(e) => handleResizeMouseDown(e, booth)}
                title="Resize"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
