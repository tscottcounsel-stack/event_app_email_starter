import React, { useEffect, useMemo, useRef, useState } from "react";

export type DiagramSlotDTO = {
  id: number | string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status?: string;
  kind?: string;
  price_cents?: number;
  category_id?: number | null;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function snap(n: number) {
  return Math.round(n);
}

type BoothStyle = {
  fill: string;
  border: string;
  dot: string;
  text: string;
  subtext: string;
};

function normalizeStatus(s?: string | null): "available" | "pending" | "booked" | "blocked" {
  const v = String(s || "available").toLowerCase();
  if (v === "pending") return "pending";
  if (v === "booked") return "booked";
  if (v === "blocked") return "blocked";
  return "available";
}

function styleForStatusSolid(status?: string | null): BoothStyle {
  const s = normalizeStatus(status);
  switch (s) {
    case "pending":
      return {
        fill: "#F59E0B",
        border: "#D97706",
        dot: "#FFFBEB",
        text: "#FFFFFF",
        subtext: "rgba(255,255,255,0.85)",
      };
    case "booked":
      return {
        fill: "#EF4444",
        border: "#DC2626",
        dot: "#FEF2F2",
        text: "#FFFFFF",
        subtext: "rgba(255,255,255,0.85)",
      };
    case "blocked":
      return {
        fill: "#6B7280",
        border: "#4B5563",
        dot: "#F3F4F6",
        text: "#FFFFFF",
        subtext: "rgba(255,255,255,0.85)",
      };
    case "available":
    default:
      return {
        fill: "#10B981",
        border: "#059669",
        dot: "#ECFDF5",
        text: "#FFFFFF",
        subtext: "rgba(255,255,255,0.85)",
      };
  }
}

// No-overlap helpers (grid units)
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  // [x, x+w) and [y, y+h)
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function wouldOverlap(
  slots: { id: number | string; x: number; y: number; w: number; h: number }[],
  movingId: number | string,
  next: { x: number; y: number; w: number; h: number }
) {
  for (const s of slots) {
    if (s.id === movingId) continue;
    if (rectsOverlap(next, s)) return true;
  }
  return false;
}

export default function DiagramEditor({
  gridPx,
  slots = [],
  onChangeSlots,
  selectedId,
  onSelectId,
  readOnly = false,
  widthPx = 1000,
  heightPx = 620,
  showGrid = true,
  zoom = 1,
  gridTheme = "light",
}: {
  gridPx: number;
  slots?: DiagramSlotDTO[];
  onChangeSlots: (next: DiagramSlotDTO[]) => void;

  selectedId: number | string | null;
  onSelectId: (id: number | string | null) => void;

  readOnly?: boolean;
  widthPx?: number;
  heightPx?: number;
  showGrid?: boolean;
  zoom?: number;
  gridTheme?: "light" | "dark";
}) {
  const baseGrid = Number(gridPx) > 0 ? Number(gridPx) : 32;
  const z = clamp(Number(zoom || 1), 0.5, 2);
  const effGrid = baseGrid * z;

  const [dragId, setDragId] = useState<number | string | null>(null);
  const dragStart = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);

  const [resize, setResize] = useState<{
    id: number | string;
    handle: ResizeHandle;
    mx: number;
    my: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  } | null>(null);

  useEffect(() => {
    if (selectedId == null && slots.length) onSelectId(slots[0].id);
    if (selectedId != null && !slots.some((s) => s.id === selectedId)) {
      onSelectId(slots.length ? slots[0].id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // widthPx/heightPx are treated as GRID units (your existing convention)
  const bounds = useMemo(() => {
    const maxX = Math.max(0, Math.floor(widthPx) - 1);
    const maxY = Math.max(0, Math.floor(heightPx) - 1);
    return { maxX, maxY };
  }, [widthPx, heightPx]);

  function updateSlot(id: number | string, patch: Partial<DiagramSlotDTO>) {
    onChangeSlots(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function onMouseDownSlot(e: React.MouseEvent, slot: DiagramSlotDTO) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectId(slot.id);
    setDragId(slot.id);
    dragStart.current = { mx: e.clientX, my: e.clientY, sx: slot.x, sy: slot.y };
  }

  function onMouseDownResize(e: React.MouseEvent, slot: DiagramSlotDTO, handle: ResizeHandle) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectId(slot.id);
    setResize({
      id: slot.id,
      handle,
      mx: e.clientX,
      my: e.clientY,
      sx: slot.x,
      sy: slot.y,
      sw: slot.w,
      sh: slot.h,
    });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (readOnly) return;

    // Resize
    if (resize) {
      const dx = (e.clientX - resize.mx) / effGrid;
      const dy = (e.clientY - resize.my) / effGrid;

      let x = resize.sx;
      let y = resize.sy;
      let w = resize.sw;
      let h = resize.sh;

      if (resize.handle === "se") {
        w = snap(resize.sw + dx);
        h = snap(resize.sh + dy);
      } else if (resize.handle === "sw") {
        x = snap(resize.sx + dx);
        w = snap(resize.sw - dx);
        h = snap(resize.sh + dy);
      } else if (resize.handle === "ne") {
        y = snap(resize.sy + dy);
        w = snap(resize.sw + dx);
        h = snap(resize.sh - dy);
      } else if (resize.handle === "nw") {
        x = snap(resize.sx + dx);
        y = snap(resize.sy + dy);
        w = snap(resize.sw - dx);
        h = snap(resize.sh - dy);
      }

      w = Math.max(1, w);
      h = Math.max(1, h);

      // Keep top-left inside
      x = clamp(x, 0, bounds.maxX);
      y = clamp(y, 0, bounds.maxY);

      // Keep bottom/right inside (so the full booth stays visible)
      w = Math.min(w, Math.max(1, bounds.maxX - x + 1));
      h = Math.min(h, Math.max(1, bounds.maxY - y + 1));

      const candidate = { x, y, w, h };
      if (wouldOverlap(slots, resize.id, candidate)) return;

      updateSlot(resize.id, candidate);
      return;
    }

    // Drag
    if (!dragId || !dragStart.current) return;

    const dx = (e.clientX - dragStart.current.mx) / effGrid;
    const dy = (e.clientY - dragStart.current.my) / effGrid;

    const me = slots.find((s) => s.id === dragId);
    if (!me) return;

    let nx = snap(dragStart.current.sx + dx);
    let ny = snap(dragStart.current.sy + dy);

    // Clamp using booth size so it stays fully visible
    nx = clamp(nx, 0, Math.max(0, bounds.maxX - me.w + 1));
    ny = clamp(ny, 0, Math.max(0, bounds.maxY - me.h + 1));

    const candidate = { x: nx, y: ny, w: me.w, h: me.h };
    if (wouldOverlap(slots, dragId, candidate)) return;

    updateSlot(dragId, { x: nx, y: ny });
  }

  function stopInteractions() {
    setDragId(null);
    dragStart.current = null;
    setResize(null);
  }

  const gridLine = gridTheme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";
  const canvasBg = gridTheme === "dark" ? "#0B1220" : "white";
  const gridBg = showGrid
    ? `linear-gradient(${gridLine} 1px, transparent 1px), linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`
    : "none";

  return (
    <div
      onMouseMove={onMouseMove}
      onMouseUp={stopInteractions}
      onMouseLeave={stopInteractions}
      onMouseDown={() => {
        if (!readOnly) onSelectId(null);
      }}
      style={{
        position: "relative",
        width: widthPx * z,
        height: heightPx * z,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: canvasBg,
        border: gridTheme === "dark" ? "1px solid rgba(255,255,255,0.10)" : "1px solid #e5e7eb",
        backgroundImage: gridBg,
        backgroundSize: `${effGrid}px ${effGrid}px`,
      }}
    >
      {slots.map((s) => {
        const left = s.x * effGrid;
        const top = s.y * effGrid;
        const wpx = Math.max(1, s.w) * effGrid;
        const hpx = Math.max(1, s.h) * effGrid;

        const isSel = selectedId === s.id;
        const st = styleForStatusSolid(s.status);

        return (
          <div
            key={String(s.id)}
            onMouseDown={(e) => onMouseDownSlot(e, s)}
            style={{
              position: "absolute",
              left,
              top,
              width: wpx,
              height: hpx,
              borderRadius: 14,
              background: st.fill,
              border: isSel ? "3px solid #34d399" : `1px solid ${st.border}`,
              boxShadow: isSel
                ? "0 0 0 3px rgba(52, 211, 153, 0.22)"
                : "0 10px 22px rgba(0,0,0,0.20)",
              cursor: readOnly ? "default" : "grab",
              userSelect: "none",
              display: "grid",
              placeItems: "center",
            }}
            title={normalizeStatus(s.status)}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                background:
                  "radial-gradient(120px 80px at 30% 25%, rgba(255,255,255,0.35), transparent 60%)",
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "absolute",
                left: 10,
                top: 10,
                width: 10,
                height: 10,
                borderRadius: 999,
                background: st.dot,
                boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
              }}
            />

            <div style={{ textAlign: "center", lineHeight: 1.1, color: st.text }}>
              <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: st.subtext }}>
                {s.w}×{s.h}
              </div>
            </div>

            {!readOnly && isSel && (
              <>
                {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((h) => {
                  const size = 12;
                  const pos: Record<ResizeHandle, React.CSSProperties> = {
                    nw: { left: -6, top: -6, cursor: "nwse-resize" },
                    ne: { right: -6, top: -6, cursor: "nesw-resize" },
                    sw: { left: -6, bottom: -6, cursor: "nesw-resize" },
                    se: { right: -6, bottom: -6, cursor: "nwse-resize" },
                  };
                  return (
                    <div
                      key={h}
                      onMouseDown={(e) => onMouseDownResize(e, s, h)}
                      style={{
                        position: "absolute",
                        width: size,
                        height: size,
                        borderRadius: 999,
                        background: "#34d399",
                        border: "2px solid white",
                        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
                        ...pos[h],
                      }}
                      title="Resize"
                    />
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
