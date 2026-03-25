// src/components/DiagramEditor.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import {
  DiagramBody,
  getOrganizerDiagram,
  saveOrganizerDiagram,
} from "../api/organizerDiagram";
import { DiagramGrid } from "./DiagramGrid";

type LoadState = "idle" | "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

type SimpleBooth = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// ---------- overlap helpers ----------
function normalizeBooths(boothMap: Record<string, any>): SimpleBooth[] {
  return Object.entries(boothMap || {}).map(([label, raw]) => {
    const b: any = raw || {};
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
    };
  });
}

function countOverlaps(boothMap: Record<string, any>): number {
  const booths = normalizeBooths(boothMap);
  if (booths.length === 0) return 0;

  const colliding = new Set<string>();

  for (let i = 0; i < booths.length; i++) {
    const a = booths[i];
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;

    for (let j = i + 1; j < booths.length; j++) {
      const b = booths[j];
      const bx2 = b.x + b.width;
      const by2 = b.y + b.height;

      const overlap = a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
      if (overlap) {
        colliding.add(a.label);
        colliding.add(b.label);
      }
    }
  }

  return colliding.size;
}

function generateNextLabel(boothMap: Record<string, any>): string {
  let maxNum = 0;
  for (const label of Object.keys(boothMap || {})) {
    const m = /^B(\d+)$/i.exec(label.trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
    }
  }
  const next = maxNum + 1 || 1;
  return `B${next}`;
}

function findFreePosition(
  boothMap: Record<string, any>,
  width: number,
  height: number
): { x: number; y: number } {
  const booths = normalizeBooths(boothMap);

  let maxX = 0;
  let maxY = 0;
  for (const b of booths) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  const cols = Math.max(12, maxX + width + 2);
  const rows = Math.max(8, maxY + height + 2);

  const overlaps = (x: number, y: number, w: number, h: number): boolean => {
    const x2 = x + w;
    const y2 = y + h;
    return booths.some((b) => {
      const bx2 = b.x + b.width;
      const by2 = b.y + b.height;
      return x < bx2 && x2 > b.x && y < by2 && y2 > b.y;
    });
  };

  for (let y = 0; y <= rows - height; y++) {
    for (let x = 0; x <= cols - width; x++) {
      if (!overlaps(x, y, width, height)) return { x, y };
    }
  }

  return { x: maxX + 1, y: 0 };
}

function dollarsFromPriceCents(priceCents: any): string {
  if (typeof priceCents !== "number" || !Number.isFinite(priceCents)) return "";
  return (priceCents / 100).toFixed(2).replace(/\.00$/, "");
}

function priceCentsFromDollarsString(s: string): number | null {
  const t = s.trim();
  if (!t.length) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const DiagramEditor: React.FC = () => {
  const { eventId: eventIdParam } = useParams<{ eventId: string }>();
  const eventId = Number(eventIdParam);

  const [diagram, setDiagram] = useState<DiagramBody | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  // ---- load
  useEffect(() => {
    if (!eventId || Number.isNaN(eventId)) {
      setError("Missing or invalid event id.");
      setLoadState("error");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoadState("loading");
        setError(null);

        const { version: v, body } = await getOrganizerDiagram(eventId);
        if (cancelled) return;

        setDiagram(body);
        setVersion(v ?? null);
        setIsDirty(false);
        setSaveState("idle");
        setLoadState("loaded");
        setSelectedLabel(null);
      } catch (err) {
        console.error("Failed to load diagram", err);
        if (cancelled) return;

        setError("Could not load diagram for this event.");
        setLoadState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId, reloadToken]);

  const conflictCount = useMemo(
    () => (diagram ? countOverlaps(diagram.boothMap) : 0),
    [diagram]
  );
  const hasConflicts = conflictCount > 0;

  const handleDiagramChange = (next: any) => {
    if (!diagram) return;

    const safe: DiagramBody = {
      width: next?.width ?? diagram.width,
      height: next?.height ?? diagram.height,
      boothMap: next?.boothMap ?? diagram.boothMap,
    };

    setDiagram(safe);
    setIsDirty(true);
    if (saveState === "saved" || saveState === "error") setSaveState("idle");
  };

  const handleSave = async () => {
    if (!diagram || !eventId || Number.isNaN(eventId)) return;
    if (hasConflicts) return;

    try {
      setSaveState("saving");
      setError(null);

      const { version: newVersion, body } = await saveOrganizerDiagram(eventId, diagram, {
        expectVersion: version ?? undefined,
      });

      setDiagram(body);
      setVersion(newVersion ?? null);
      setIsDirty(false);
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to save diagram", err);
      setError("Could not save changes. Please try again.");
      setSaveState("error");
    }
  };

  const handleRetry = () => setReloadToken((p) => p + 1);

  const statusText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved" && !isDirty
      ? "All changes saved"
      : isDirty
      ? "Unsaved changes"
      : null;

  const conflictText =
    !diagram || conflictCount === 0
      ? null
      : conflictCount === 1
      ? "1 overlapping booth – fix before saving."
      : `${conflictCount} overlapping booths – fix before saving.`;

  // ---- add / delete
  const handleAddBooth = () => {
    if (!diagram) return;

    const DEFAULT_W = 2;
    const DEFAULT_H = 2;

    const label = generateNextLabel(diagram.boothMap);
    const { x, y } = findFreePosition(diagram.boothMap, DEFAULT_W, DEFAULT_H);

    const next: DiagramBody = {
      ...diagram,
      boothMap: {
        ...diagram.boothMap,
        [label]: {
          label,
          x,
          y,
          width: DEFAULT_W,
          height: DEFAULT_H,
          status: "available",

          // ✅ defaults so grid can show inside-booth data immediately
          priceCents: 50000, // $500 default (matches your screenshot vibe)
          category: "Food & Beverage",
        },
      },
    };

    setDiagram(next);
    setIsDirty(true);
    setSaveState("idle");
    setSelectedLabel(label);
  };

  const handleDeleteBooth = () => {
    if (!diagram || !selectedLabel) return;
    if (!diagram.boothMap[selectedLabel]) return;

    const nextBoothMap = { ...diagram.boothMap };
    delete nextBoothMap[selectedLabel];

    setDiagram({ ...diagram, boothMap: nextBoothMap });
    setIsDirty(true);
    setSaveState("idle");
    setSelectedLabel(null);
  };

  // ---- side-panel editing
  const updateSelectedBooth = (patch: Partial<any>) => {
    if (!diagram || !selectedLabel) return;
    const current = diagram.boothMap[selectedLabel];
    if (!current) return;

    const updated = { ...current, ...patch };

    setDiagram({
      ...diagram,
      boothMap: { ...diagram.boothMap, [selectedLabel]: updated },
    });
    setIsDirty(true);
    if (saveState === "saved" || saveState === "error") setSaveState("idle");
  };

  // ---- render states
  if (loadState === "loading" && !diagram) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">Loading diagram…</p>
      </div>
    );
  }

  if (loadState === "error" && !diagram) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-red-700">
          {error ?? "Something went wrong loading the diagram."}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!diagram) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">No diagram data available for this event.</p>
      </div>
    );
  }

  const selectedBooth =
    selectedLabel && diagram.boothMap[selectedLabel] ? diagram.boothMap[selectedLabel] : null;

  const canDelete = !!selectedLabel && !!selectedBooth;

  const boothStatus = (selectedBooth?.status as string | undefined) ?? "available";

  const boothPriceInput =
    selectedBooth && typeof selectedBooth.priceCents === "number"
      ? dollarsFromPriceCents(selectedBooth.priceCents)
      : "";

  const boothCategory =
    selectedBooth && typeof selectedBooth.category === "string"
      ? selectedBooth.category
      : "";

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Booth Map Editor</h1>
          <p className="text-xs text-gray-500">
            Drag / resize booths. Booth label, price, and category show inside each booth.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {statusText && <span className="text-xs text-gray-500">{statusText}</span>}
            {conflictText && <span className="text-xs font-medium text-red-500">{conflictText}</span>}
          </div>

          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddBooth}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              + Add booth
            </button>

            <button
              type="button"
              onClick={handleDeleteBooth}
              disabled={!canDelete}
              className="inline-flex items-center rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete selected
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saveState === "saving" || hasConflicts || loadState !== "loaded"}
              title={hasConflicts ? "Resolve overlapping booths before saving." : undefined}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </header>

      {error && loadState !== "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 flex gap-4">
        {/* Left */}
        <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white p-3">
          <DiagramGrid
            diagram={diagram}
            onDiagramChange={handleDiagramChange}
            selectedLabel={selectedLabel ?? undefined}
            onSelectBooth={setSelectedLabel}
          />
        </div>

        {/* Right */}
        <div className="w-80 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Booth Properties
          </h2>

          {!selectedBooth ? (
            <p className="text-xs text-gray-500">Click a booth to edit its details.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold text-gray-700">Booth Label</div>
                <div className="mt-1 rounded-md border bg-gray-50 px-3 py-2 font-bold">
                  {selectedBooth.label ?? selectedLabel}
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  (Label is the booth key right now. If you want rename support, we’ll do it safely in a separate step.)
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-gray-700">Status</div>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={boothStatus}
                  onChange={(e) => updateSelectedBooth({ status: e.target.value })}
                >
                  <option value="available">Available</option>
                  <option value="pending">Pending</option>
                  <option value="reserved">Reserved</option>
                  <option value="assigned">Booked</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-gray-700">Price ($)</div>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={boothPriceInput}
                  onChange={(e) => {
                    const cents = priceCentsFromDollarsString(e.target.value);
                    updateSelectedBooth({
                      priceCents: cents ?? undefined,
                    });
                  }}
                  placeholder="500"
                />
                <div className="mt-1 text-[11px] text-gray-500">This displays inside the booth.</div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-gray-700">Category</div>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={boothCategory}
                  onChange={(e) => updateSelectedBooth({ category: e.target.value })}
                  placeholder="Food & Beverage"
                />
                <div className="mt-1 text-[11px] text-gray-500">This displays inside the booth.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiagramEditor;





