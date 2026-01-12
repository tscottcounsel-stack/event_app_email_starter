// src/components/EventDiagramCanvas.tsx
import React from "react";
import type { Booth, BoothStatus, DiagramJson } from "../api/diagramTypes";

type ViewMode = "vendor" | "organizer";

export interface EventDiagramCanvasProps {
  diagram: DiagramJson | null;
  viewMode: ViewMode;

  onBoothClick?: (code: string, booth: Booth) => void;

  /**
   * Fired on hover with cursor position
   */
  onBoothHover?: (
    code: string | null,
    booth?: Booth,
    pos?: { x: number; y: number }
  ) => void;

  /**
   * Booth codes (ex: ["B1"]) OR slot ids as strings (ex: ["326"])
   * that belong to the current vendor.
   */
  mineBoothCodes?: string[];
}

const GRID_SIZE = 25;

/**
 * Color priority:
 * 1) Mine (always wins)
 * 2) Status
 */
function statusToColor(
  status: BoothStatus | undefined,
  view: ViewMode,
  isMine: boolean
): string {
  if (isMine) return "bg-sky-600/95";

  if (!status || status === "available") return "bg-emerald-600/80";
  if (status === "street") return "bg-slate-900";

  if (view === "organizer") {
    if (status === "assigned") return "bg-sky-600/90";
    if (status === "pending") return "bg-amber-500/90";
    if (status === "reserved") return "bg-rose-500/90";
    if (status === "blocked") return "bg-rose-700/90";
    if (status === "hidden") return "bg-slate-500/80";
  } else {
    if (status === "assigned") return "bg-sky-600/90";
    if (status === "pending") return "bg-amber-500/90";
    if (status === "reserved" || status === "blocked") return "bg-rose-500/90";
    if (status === "hidden") return "bg-slate-500/80";
  }

  return "bg-slate-600/80";
}

function normalizeToBoothMapAndGrid(diagram: any) {
  if (diagram && Array.isArray(diagram.slots)) {
    const cols = Math.max(1, Number(diagram.width ?? 32));
    const rows = Math.max(1, Number(diagram.height ?? 16));

    const boothMap: Record<string, Booth & { db_slot_id?: number | null }> = {};

    for (const s of diagram.slots) {
      const code = String(s?.id ?? s?.label ?? "B?");
      boothMap[code] = {
        label: String(s?.label ?? code),
        x: Math.max(0, Number(s?.x ?? 1) - 1),
        y: Math.max(0, Number(s?.y ?? 1) - 1),
        width: Math.max(1, Number(s?.w ?? 2)),
        height: Math.max(1, Number(s?.h ?? 2)),
        status: (s?.status ?? "available") as BoothStatus,
        db_slot_id: s?.db_slot_id ?? null,
      };
    }

    return {
      cols,
      rows,
      boothMap,
      widthPx: cols * GRID_SIZE,
      heightPx: rows * GRID_SIZE,
    };
  }

  // legacy fallback
  const widthPx = Math.max(1, Number(diagram?.width ?? 1200));
  const heightPx = Math.max(1, Number(diagram?.height ?? 800));
  const boothMap = (diagram?.boothMap ?? {}) as Record<string, Booth>;

  const cols = Math.max(1, Math.round(widthPx / GRID_SIZE));
  const rows = Math.max(1, Math.round(heightPx / GRID_SIZE));

  return { cols, rows, boothMap, widthPx, heightPx };
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

  const { cols, rows, boothMap, widthPx, heightPx } =
    normalizeToBoothMapAndGrid(diagram);

  const mineSet = new Set(mineBoothCodes.map((v) => String(v).toUpperCase()));

  return (
    <div className="relative">
      <div
        className="relative mx-auto max-w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
        style={{ aspectRatio: `${widthPx} / ${heightPx}` }}
      >
        {/* Grid */}
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
            const x = Number(booth.x ?? 0);
            const y = Number(booth.y ?? 0);
            const w = Number((booth as any).width ?? 1);
            const h = Number((booth as any).height ?? 1);

            const left = (x / cols) * 100;
            const top = (y / rows) * 100;
            const widthPct = (w / cols) * 100;
            const heightPct = (h / rows) * 100;

            const codeKey = code.toUpperCase();
            const slotKey =
              booth.db_slot_id != null ? String(booth.db_slot_id) : null;

            const isMine =
              mineSet.has(codeKey) ||
              (slotKey != null && mineSet.has(slotKey));

            const color = statusToColor(
              booth.status as BoothStatus | undefined,
              viewMode,
              isMine
            );

            return (
              <button
                key={code}
                type="button"
                className={`group absolute overflow-hidden rounded-md border text-[11px] font-medium text-white shadow-sm ${color}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  minWidth: 16,
                  minHeight: 16,
                  borderColor: "rgba(255,255,255,0.6)",
                }}
                onClick={() => onBoothClick?.(code, booth)}
                onMouseEnter={(e) =>
                  onBoothHover?.(code, booth, {
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseMove={(e) =>
                  onBoothHover?.(code, booth, {
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseLeave={() => onBoothHover?.(null)}
              >
                {/* Hover outline */}
                <div className="pointer-events-none absolute inset-0 ring-0 ring-white/80 group-hover:ring-2" />

                <div className="flex h-full w-full items-center justify-center px-1 text-center leading-tight">
                  <div className="space-y-0.5">
                    <div className="truncate text-xs font-semibold">
                      {booth.label ?? code}
                    </div>
                    <div className="text-[10px] opacity-80">
                      {w}×{h}
                    </div>
                    {isMine && (
                      <div className="text-[10px] font-semibold">
                        YOUR BOOTH
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EventDiagramCanvas;
