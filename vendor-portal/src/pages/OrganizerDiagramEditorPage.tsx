// vendor-portal/src/pages/OrganizerDiagramEditorPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BoothSlot,
  DiagramPayload,
  SlotStatus,
  getOrganizerDiagram,
  saveOrganizerDiagram,
} from "../api/organizerDiagram";

type DiagramState = {
  width: number;
  height: number;
  slots: BoothSlot[];
};

// Backend width/height still exist, but the UI canvas
// will always render using these logical dimensions:
const DEFAULT_WIDTH = 32;
const DEFAULT_HEIGHT = 16;

// Each grid cell is 16px in our internal coordinate system
const CELL_SIZE = 16;

// Max on-screen width of the map in pixels
const MAX_CANVAS_PIXEL_WIDTH = 1100;

const OrganizerDiagramEditorPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const [diagram, setDiagram] = useState<DiagramState>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    slots: [],
  });
  const [version, setVersion] = useState<number>(0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load diagram from backend
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setLoadError(null);

        const diag = await getOrganizerDiagram(eventId);
        if (cancelled) return;

        const safeWidth =
          diag.width && diag.width > 0 ? diag.width : DEFAULT_WIDTH;
        const safeHeight =
          diag.height && diag.height > 0 ? diag.height : DEFAULT_HEIGHT;

        console.log(
          "[OrganizerDiagramEditor] loaded diagram from API",
          { width: safeWidth, height: safeHeight },
          "slots:",
          diag.slots?.length ?? 0
        );

        setDiagram({
          width: safeWidth,
          height: safeHeight,
          slots: Array.isArray(diag.slots) ? diag.slots : [],
        });
        setVersion(diag.version ?? 0);
        setSelectedSlotId(null);
      } catch (err) {
        console.error("[OrganizerDiagramEditor] load error", err);
        if (!cancelled) {
          setLoadError("Unable to load diagram.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const selectedSlot =
    selectedSlotId != null
      ? diagram.slots.find((s) => s.id === selectedSlotId) ?? null
      : null;

  // ---------------------------------------------------------------------------
  // Local mutators
  // ---------------------------------------------------------------------------
  function handleAddBooth() {
    const index = diagram.slots.length + 1;
    const id = `B${index}`;

    const newSlot: BoothSlot = {
      id,
      label: id,
      x: 1,
      y: 1,
      w: 2,
      h: 2,
    };

    setDiagram((prev) => ({
      ...prev,
      slots: [...prev.slots, newSlot],
    }));
    setSelectedSlotId(id);
  }

  function updateSelectedSlot<K extends keyof BoothSlot>(
    key: K,
    value: BoothSlot[K]
  ) {
    if (!selectedSlot) return;

    setDiagram((prev) => ({
      ...prev,
      slots: prev.slots.map((slot) =>
        slot.id === selectedSlot.id ? { ...slot, [key]: value } : slot
      ),
    }));
  }

  function handleDeleteSelected() {
    if (!selectedSlot) return;

    setDiagram((prev) => ({
      ...prev,
      slots: prev.slots.filter((s) => s.id !== selectedSlot.id),
    }));
    setSelectedSlotId(null);
  }

  // ---------------------------------------------------------------------------
  // Save to backend
  // ---------------------------------------------------------------------------
  async function handleSave() {
    if (!eventId) return;

    // We still send back whatever width/height are in state,
    // but the UI canvas is fixed to DEFAULT_* above.
    const payload: DiagramPayload = {
      width: diagram.width,
      height: diagram.height,
      slots: diagram.slots,
    };

    try {
      setSaving(true);

      const updated = await saveOrganizerDiagram(eventId, payload, version);

      const safeWidth =
        updated.width && updated.width > 0 ? updated.width : diagram.width;
      const safeHeight =
        updated.height && updated.height > 0 ? updated.height : diagram.height;

      setDiagram({
        width: safeWidth,
        height: safeHeight,
        slots: Array.isArray(updated.slots) ? updated.slots : [],
      });
      setVersion(updated.version ?? version);

      window.alert("Diagram saved.");
    } catch (err) {
      console.error("[OrganizerDiagramEditor] save error", err);
      window.alert(
        "Unable to save diagram. If another tab changed this map, refresh and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas dimensions & helpers
  // ---------------------------------------------------------------------------
  // 🔒 IMPORTANT: We *fix* the visible grid to DEFAULT_WIDTH/HEIGHT
  // so loading from the API cannot change the canvas size and "flip" the UI.
  const logicalWidth = DEFAULT_WIDTH;
  const logicalHeight = DEFAULT_HEIGHT;

  const canvasWidth = logicalWidth * CELL_SIZE;
  const canvasHeight = logicalHeight * CELL_SIZE;
  const aspectRatio = canvasWidth / canvasHeight;

  function getSlotFill(status?: SlotStatus | null): string {
    switch (status) {
      case "assigned":
        return "#3b82f6"; // blue
      case "pending":
        return "#facc15"; // amber
      case "reserved":
        return "#ef4444"; // red
      case "hidden":
        return "#6b7280"; // gray
      case "available":
      default:
        return "#22c55e"; // green
    }
  }

  const verticalLines = Array.from(
    { length: logicalWidth + 1 },
    (_, i) => i * CELL_SIZE
  );
  const horizontalLines = Array.from(
    { length: logicalHeight + 1 },
    (_, i) => i * CELL_SIZE
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              EP
            </div>
            <span className="font-semibold text-slate-900">Event Portal</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              Organizer — map editor
            </span>
            {eventId && (
              <span className="ml-2 text-[11px] text-slate-400">
                Event #{eventId} • v{version}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate("/organizer/events")}
            className="px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to events
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-6">
        {/* LEFT: Canvas */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-semibold text-slate-900">
              Event layout
            </h1>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddBooth}
                className="px-3 py-1 rounded-full border border-emerald-500 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                + Add booth
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 rounded-full bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save layout"}
              </button>
            </div>
          </div>

          {loading && (
            <p className="text-sm text-slate-500">Loading diagram…</p>
          )}
          {loadError && (
            <p className="text-sm text-red-600 mb-2">{loadError}</p>
          )}

          {/* SVG-based map, fixed-size grid */}
          <div className="mt-2 flex justify-center">
            <div
              className="w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
              style={{ maxWidth: MAX_CANVAS_PIXEL_WIDTH, aspectRatio }}
            >
              <svg
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                className="w-full h-full"
              >
                {/* Background */}
                <rect
                  x={0}
                  y={0}
                  width={canvasWidth}
                  height={canvasHeight}
                  fill="#020617"
                />

                {/* Grid lines */}
                {verticalLines.map((x) => (
                  <line
                    key={`v-${x}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={canvasHeight}
                    stroke="#111827"
                    strokeWidth={0.75}
                  />
                ))}
                {horizontalLines.map((y) => (
                  <line
                    key={`h-${y}`}
                    x1={0}
                    y1={y}
                    x2={canvasWidth}
                    y2={y}
                    stroke="#111827"
                    strokeWidth={0.75}
                  />
                ))}

                {/* Booths */}
                {diagram.slots.map((slot) => {
                  const isSelected = slot.id === selectedSlotId;
                  const x = slot.x * CELL_SIZE;
                  const y = slot.y * CELL_SIZE;
                  const w = slot.w * CELL_SIZE;
                  const h = slot.h * CELL_SIZE;

                  return (
                    <g
                      key={slot.id}
                      onClick={() => setSelectedSlotId(slot.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        rx={4}
                        ry={4}
                        fill={getSlotFill(slot.status)}
                        stroke={isSelected ? "#ffffff" : "#e5e7eb"}
                        strokeWidth={isSelected ? 2 : 1}
                        fillOpacity={0.9}
                      />
                      <text
                        x={x + w / 2}
                        y={y + h / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={CELL_SIZE * 0.7}
                        fill="#ffffff"
                        pointerEvents="none"
                      >
                        {slot.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        {/* RIGHT: Inspector */}
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1">
              Booth details
            </h2>
            <p className="text-xs text-slate-500">
              Select a booth on the map to adjust its position and size.
            </p>
          </div>

          {!selectedSlot && (
            <p className="text-sm text-slate-500">
              No booth selected. Click a booth on the map or press{" "}
              <span className="font-medium">+ Add booth</span> to create a new
              one.
            </p>
          )}

          {selectedSlot && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Label
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedSlot.label}
                  onChange={(e) =>
                    updateSelectedSlot(
                      "label",
                      e.target.value || selectedSlot.id
                    )
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    X
                  </label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={selectedSlot.x}
                    onChange={(e) =>
                      updateSelectedSlot("x", Number(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Y
                  </label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={selectedSlot.y}
                    onChange={(e) =>
                      updateSelectedSlot("y", Number(e.target.value) || 0)
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Width
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={selectedSlot.w}
                    onChange={(e) =>
                      updateSelectedSlot(
                        "w",
                        Math.max(1, Number(e.target.value) || 1)
                      )
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Height
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={selectedSlot.h}
                    onChange={(e) =>
                      updateSelectedSlot(
                        "h",
                        Math.max(1, Number(e.target.value) || 1)
                      )
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Status (visual only for now)
                </label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={selectedSlot.status ?? "available"}
                  onChange={(e) =>
                    updateSelectedSlot("status", e.target.value as SlotStatus)
                  }
                >
                  <option value="available">Available</option>
                  <option value="assigned">Assigned</option>
                  <option value="pending">Pending</option>
                  <option value="reserved">Reserved / blocked</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-between">
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Delete booth
                </button>
                <span className="text-[11px] text-slate-400">
                  Units are grid cells ({CELL_SIZE}px each)
                </span>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default OrganizerDiagramEditorPage;
