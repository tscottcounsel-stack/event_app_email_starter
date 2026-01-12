// src/components/DiagramEditor.tsx
import React, { useMemo, useRef, useState } from "react";

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function snap(n: number) {
  // snap to integer grid
  return Math.round(n);
}

export default function DiagramEditor({
  gridPx,
  slots,
  onChangeSlots,
  readOnly = false,
}: {
  gridPx: number;
  slots: DiagramSlotDTO[];
  onChangeSlots: (next: DiagramSlotDTO[]) => void;
  readOnly?: boolean;
}) {
  const grid = Number(gridPx) > 0 ? Number(gridPx) : 32;

  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [dragId, setDragId] = useState<number | string | null>(null);
  const dragStart = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);

  const selected = useMemo(
    () => slots.find((s) => s.id === selectedId) || null,
    [slots, selectedId]
  );

  function updateSlot(id: number | string, patch: Partial<DiagramSlotDTO>) {
    const nextSlots = slots.map((s) => (s.id === id ? { ...s, ...patch } : s));
    onChangeSlots(nextSlots);
  }

  function handleMouseDownSlot(e: React.MouseEvent, slot: DiagramSlotDTO) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(slot.id);
    setDragId(slot.id);
    dragStart.current = { mx: e.clientX, my: e.clientY, sx: slot.x, sy: slot.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (readOnly) return;
    if (!dragId || !dragStart.current) return;
    const s = slots.find((x) => x.id === dragId);
    if (!s) return;

    const dx = (e.clientX - dragStart.current.mx) / grid;
    const dy = (e.clientY - dragStart.current.my) / grid;

    const nx = snap(dragStart.current.sx + dx);
    const ny = snap(dragStart.current.sy + dy);

    updateSlot(dragId, { x: clamp(nx, 0, 200), y: clamp(ny, 0, 200) });
  }

  function handleMouseUp() {
    setDragId(null);
    dragStart.current = null;
  }

  const widthPx = 900;
  const heightPx = 520;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
      <div
        style={{
          background: "#0b1220",
          borderRadius: 18,
          padding: 16,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: "relative",
            width: widthPx,
            height: heightPx,
            borderRadius: 14,
            overflow: "hidden",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: `${grid}px ${grid}px`,
            backgroundColor: "#0b1220",
          }}
        >
          {slots.map((s) => {
            const left = s.x * grid;
            const top = s.y * grid;
            const w = Math.max(1, s.w) * grid;
            const h = Math.max(1, s.h) * grid;
            const isSel = selectedId === s.id;

            return (
              <div
                key={String(s.id)}
                onMouseDown={(e) => handleMouseDownSlot(e, s)}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width: w,
                  height: h,
                  borderRadius: 12,
                  border: isSel ? "3px solid #34d399" : "2px solid #22c55e",
                  color: "white",
                  display: "grid",
                  placeItems: "center",
                  cursor: readOnly ? "default" : "grab",
                  userSelect: "none",
                  background: "rgba(0,0,0,0.25)",
                  boxShadow: isSel ? "0 0 0 3px rgba(52,211,153,0.25)" : "none",
                  opacity: readOnly ? 0.95 : 1,
                }}
                title={`id=${String(s.id)} • ${s.label} • (${s.x},${s.y})`}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 800 }}>{s.label}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {s.w}×{s.h}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 18,
          padding: 16,
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16 }}>Selected booth</div>

        {!selected ? (
          <div style={{ marginTop: 10, color: "#6b7280" }}>
            Click a booth on the map to edit it.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ color: "#6b7280", fontSize: 12 }}>
              id: <b>{String(selected.id)}</b>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Label</div>
              <input
                disabled={readOnly}
                value={selected.label}
                onChange={(e) => updateSlot(selected.id, { label: e.target.value })}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>X</div>
                <input
                  disabled={readOnly}
                  type="number"
                  value={selected.x}
                  onChange={(e) => updateSlot(selected.id, { x: Number(e.target.value) })}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Y</div>
                <input
                  disabled={readOnly}
                  type="number"
                  value={selected.y}
                  onChange={(e) => updateSlot(selected.id, { y: Number(e.target.value) })}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>W</div>
                <input
                  disabled={readOnly}
                  type="number"
                  value={selected.w}
                  onChange={(e) => updateSlot(selected.id, { w: Number(e.target.value) })}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>H</div>
                <input
                  disabled={readOnly}
                  type="number"
                  value={selected.h}
                  onChange={(e) => updateSlot(selected.id, { h: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
