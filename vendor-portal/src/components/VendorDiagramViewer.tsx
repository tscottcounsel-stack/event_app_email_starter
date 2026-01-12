import React, { useMemo } from "react";

type SlotStatus = "available" | "pending" | "approved" | "assigned" | "blocked" | "mine" | string;

export type DiagramSlot = {
  id: string;
  label: string;
  x: number; // 1-based grid
  y: number; // 1-based grid
  w: number; // grid cells
  h: number; // grid cells
  status?: SlotStatus;
  category?: string | null;
  db_slot_id?: number | null;
};

export type DiagramPayload = {
  width: number; // cols
  height: number; // rows
  slots: DiagramSlot[];
};

type Props = {
  diagram: DiagramPayload;
  myDbSlotId?: number | null;     // vendor's assigned_slot_id
  cellPx?: number;               // default 28
  boardHeightPx?: number;        // default 620
  onSelect?: (slotId: string) => void; // optional click handler for sidebar UX
  selectedId?: string | null;
};

function statusToBorder(status?: SlotStatus) {
  const s = (status || "available").toLowerCase();
  if (s === "mine") return "#f97316";       // orange
  if (s === "available") return "#22c55e";  // green
  if (s === "pending") return "#f59e0b";    // amber
  if (s === "approved") return "#3b82f6";   // blue
  if (s === "assigned") return "#8b5cf6";   // purple
  if (s === "blocked") return "#6b7280";    // gray
  return "#94a3b8";
}

export default function VendorDiagramViewer({
  diagram,
  myDbSlotId,
  cellPx = 28,
  boardHeightPx = 620,
  onSelect,
  selectedId,
}: Props) {
  const slots = useMemo(() => {
    return diagram.slots.map((s) => {
      const isMine = myDbSlotId != null && s.db_slot_id != null && s.db_slot_id === myDbSlotId;
      return {
        ...s,
        status: isMine ? ("mine" as SlotStatus) : (s.status || "available"),
      };
    });
  }, [diagram.slots, myDbSlotId]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: boardHeightPx,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          background: "#0b1220",
        }}
      >
        {/* grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: `${cellPx}px ${cellPx}px`,
            pointerEvents: "none",
          }}
        />

        {/* slots */}
        {slots.map((s) => {
          const left = (s.x - 1) * cellPx;
          const top = (s.y - 1) * cellPx;
          const w = s.w * cellPx;
          const h = s.h * cellPx;

          const border = statusToBorder(s.status);
          const isSelected = !!selectedId && s.id === selectedId;
          const isMine = (s.status || "").toLowerCase() === "mine";

          return (
            <button
              key={s.id}
              onClick={() => onSelect?.(s.id)}
              title={`${s.label || s.id}${s.db_slot_id ? ` (db_slot_id ${s.db_slot_id})` : ""}`}
              style={{
                position: "absolute",
                left,
                top,
                width: w,
                height: h,
                borderRadius: 12,
                border: `2px solid ${border}`,
                background: isMine ? "rgba(249,115,22,0.22)" : "rgba(0,0,0,0.35)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                cursor: onSelect ? "pointer" : "default",
                userSelect: "none",
                boxShadow: isSelected
                  ? "0 0 0 3px rgba(255,255,255,0.85), 0 0 0 6px rgba(14,165,233,0.45)"
                  : isMine
                    ? "0 0 0 3px rgba(249,115,22,0.55)"
                    : undefined,
              }}
            >
              <div style={{ fontWeight: 900, lineHeight: 1 }}>{s.label || s.id}</div>
              <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>
                {s.w}×{s.h}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>
        Vendor view is read-only. Your booth is highlighted in orange (if assigned).
      </div>
    </div>
  );
}
