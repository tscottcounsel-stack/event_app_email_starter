// src/components/EventDiagramCanvas.tsx
import React from "react";
import type { Booth, BoothStatus, DiagramJson } from "../api/diagramTypes";

type ViewMode = "vendor" | "organizer";

export interface EventDiagramCanvasProps {
  diagram: DiagramJson | null;
  viewMode: ViewMode;
  onBoothClick?: (code: string, booth: Booth) => void;
  onBoothHover?: (code: string | null, booth?: Booth) => void;
  mineBoothCodes?: string[]; // codes that should be highlighted as "mine"
}

const GRID_SIZE = 25; // pixels per grid cell for the read-only canvas

function statusToColor(
  status: BoothStatus | undefined,
  view: ViewMode,
  isMine: boolean
): string {
  if (isMine) {
    // Your booth always blue, regardless of status
    return "bg-sky-600/90";
  }

  if (!status || status === "available") return "bg-emerald-600/80";

  if (status === "street") return "bg-slate-900";

  if (view === "organizer") {
    if (status === "assigned") return "bg-sky-600/90";
    if (status === "pending") return "bg-amber-500/90";
    if (status === "reserved") return "bg-rose-500/90";
    if (status === "blocked") return "bg-rose-700/90";
    if (status === "hidden") return "bg-slate-500/80";
  } else {
    // vendor view: group non-available into fewer buckets
    if (status === "pending") return "bg-amber-500/90";
    if (status === "reserved" || status === "blocked") return "bg-rose-500/90";
    if (status === "hidden") return "bg-slate-500/80";
    if (status === "assigned") return "bg-sky-600/90";
  }

  return "bg-slate-600/80";
}

const EventDiagramCanvas: React.FC<EventDiagramCanvasProps> = ({
  diagram,
  viewMode,
  onBoothClick,
  onBoothHover,
  mineBoothCodes = [],
}) => {
  if (!diagram) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        No map has been created for this event yet.
      </div>
    );
  }

  const width = diagram.width ?? 1200;
  const height = diagram.height ?? 800;
  const boothMap = (diagram.boothMap ?? {}) as Record<string, Booth>;

  const cols = Math.max(1, Math.round(width / GRID_SIZE));
  const rows = Math.max(1, Math.round(height / GRID_SIZE));

  const mineSet = new Set(mineBoothCodes ?? []);

  return (
    <div className="relative">
      {/* Outer frame */}
      <div
        className="relative mx-auto max-w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
        style={{
          aspectRatio: `${width} / ${height}`,
        }}
      >
        {/* Grid background */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)",
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        />

        {/* Booths */}
        <div className="absolute inset-0">
          {Object.entries(boothMap).map(([code, booth]) => {
            const x = booth.x ?? 0;
            const y = booth.y ?? 0;
            const w = booth.width ?? 1;
            const h = booth.height ?? 1;

            const left = (x / cols) * 100;
            const top = (y / rows) * 100;
            const widthPct = (w / cols) * 100;
            const heightPct = (h / rows) * 100;

            const isMine = mineSet.has(code);
            const color = statusToColor(
              booth.status as BoothStatus | undefined,
              viewMode,
              isMine,
            );

            const label = booth.label ?? code;

            return (
              <button
                key={code}
                type="button"
                className={`group absolute overflow-hidden rounded-md border border-slate-200/60 text-[11px] font-medium text-white shadow-sm ${color}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  minWidth: 16,
                  minHeight: 16,
                }}
                onClick={() => onBoothClick?.(code, booth)}
                onMouseEnter={() => onBoothHover?.(code, booth)}
                onMouseLeave={() => onBoothHover?.(null)}
              >
                {/* Label + size */}
                <div className="flex h-full w-full items-center justify-center px-1 text-center leading-tight">
                  <div className="space-y-0.5">
                    <div className="truncate text-xs font-semibold">
                      {label}
                    </div>
                    <div className="text-[10px] opacity-80">
                      {w}×{h}
                    </div>
                  </div>
                </div>

                {/* Visual handle hint */}
                <div className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 rounded-sm border border-white/60 bg-white/80 opacity-40 group-hover:opacity-90" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EventDiagramCanvas;
