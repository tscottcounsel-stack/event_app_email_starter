import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DiagramEditor, { DiagramSlotDTO } from "../components/DiagramEditor";
import { ApiError, apiGet, apiPut } from "../api";

type DiagramResponse = {
  event_id: number;
  version?: number;
  grid_px: number;
  slots: Array<{
    id: number;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    status?: string;
    kind?: string;
    price_cents?: number;
    category_id?: number | null;
  }>;
};

function centsToDollars(cents?: number | null) {
  if (cents == null) return "";
  return String(Math.round(cents / 100));
}
function dollarsToCents(dollars: string) {
  const n = Number(dollars || "0");
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

type SizePreset = { key: string; label: string; w: number; h: number };
const SIZE_PRESETS: SizePreset[] = [
  { key: "custom", label: "Custom Size", w: 0, h: 0 },
  { key: "s", label: "Small (3×3)", w: 3, h: 3 },
  { key: "m", label: "Medium (4×4)", w: 4, h: 4 },
  { key: "l", label: "Large (5×4)", w: 5, h: 4 },
];

export default function OrganizerMapEditorPage() {
  const nav = useNavigate();
  const { eventId } = useParams();
  const eid = Number(eventId);

  const [gridPx, setGridPx] = useState(32);
  const [slots, setSlots] = useState<DiagramSlotDTO[]>([]);
  const [selectedId, setSelectedId] = useState<number | string | null>(null);

  const [showGrid, setShowGrid] = useState(true);
  const [darkGrid, setDarkGrid] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; msg: string } | null>(
    null
  );

  const selected = useMemo(
    () => (selectedId == null ? null : slots.find((s) => s.id === selectedId) || null),
    [slots, selectedId]
  );

  async function load() {
    setErr(null);
    try {
      const data = await apiGet<DiagramResponse>(`/organizer/events/${eid}/diagram`);
      setGridPx(data.grid_px || 32);
      setSlots(
        (data.slots || []).map((s) => ({
          id: s.id,
          label: s.label,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          status: s.status,
          kind: s.kind,
          price_cents: s.price_cents,
          category_id: s.category_id ?? null,
        }))
      );
      setToast({ kind: "info", msg: "Layout loaded." });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("404")) {
        setSlots([]);
        setToast({ kind: "info", msg: "No layout yet — add booths, then Save Layout." });
        return;
      }
      setErr(msg);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(eid)) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  function addBooth() {
    const nextNum = slots.length + 1;
    const next: DiagramSlotDTO = {
      id: `tmp-${Date.now()}`,
      label: `Booth ${nextNum}`,
      x: 2,
      y: 2 + nextNum * 2,
      w: 3,
      h: 3,
      status: "available",
      kind: "standard",
      price_cents: 0,
      category_id: null,
    };
    setSlots((prev) => [...prev, next]);
    setSelectedId(next.id);
  }

  async function saveLayout() {
    setBusy(true);
    setErr(null);
    try {
      await apiPut(`/organizer/events/${eid}/diagram`, {
        grid_px: gridPx,
        slots: slots.map((s) => ({
          id: typeof s.id === "string" && String(s.id).startsWith("tmp-") ? null : s.id,
          label: s.label,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
          status: s.status ?? "available",
          kind: s.kind ?? "standard",
          price_cents: s.price_cents ?? 0,
          category_id: s.category_id ?? null,
        })),
      });

      setToast({ kind: "success", msg: "Layout saved." });
      await load();
    } catch (e: any) {
      if (e instanceof ApiError) setErr(`${e.status}: ${e.body || e.message}`);
      else setErr(e?.message || String(e));
      setToast({ kind: "error", msg: "Save failed." });
    } finally {
      setBusy(false);
    }
  }

  function updateSelected(patch: Partial<DiagramSlotDTO>) {
    if (!selected) return;
    setSlots((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  }

  function deleteSelected() {
    if (!selected) return;
    setSlots((prev) => prev.filter((s) => s.id !== selected.id));
    setSelectedId(null);
  }

  const selectedPresetKey = useMemo(() => {
    if (!selected) return "custom";
    const match = SIZE_PRESETS.find(
      (p) => p.key !== "custom" && p.w === selected.w && p.h === selected.h
    );
    return match ? match.key : "custom";
  }, [selected]);

  return (
    <div className="px-6 py-6 h-full flex flex-col">
      {/* Header: stable layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="shrink-0 rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={() => nav(-1)}
          >
            ← Back
          </button>

          <div className="min-w-0">
            <div className="truncate text-2xl font-extrabold leading-tight">Booth Map Editor</div>
            <div className="text-sm text-gray-500">Event #{eid}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
          <button
            className="rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={() => setShowGrid((v) => !v)}
          >
            {showGrid ? "Hide Grid" : "Show Grid"}
          </button>

          <button
            className="rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={() => setDarkGrid((v) => !v)}
            title="Dark grid affects the canvas only"
          >
            {darkGrid ? "Light Grid" : "Dark Grid"}
          </button>

          <button
            className="rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={load}
            disabled={busy}
          >
            Refresh
          </button>

          <button
            className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            onClick={saveLayout}
            disabled={busy}
          >
            {busy ? "Saving..." : "Save Layout"}
          </button>

          <button
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            onClick={() => setToast({ kind: "info", msg: "Finish & Publish (next step)" })}
          >
            Finish &amp; Publish
          </button>
        </div>
      </div>

      {/* Toast / Error */}
      <div className="mt-4 space-y-3">
        {toast ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              toast.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : toast.kind === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-blue-200 bg-blue-50 text-blue-800"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>{toast.msg}</div>
              <button className="text-xs underline" onClick={() => setToast(null)}>
                close
              </button>
            </div>
          </div>
        ) : null}

        {err ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {err}
          </div>
        ) : null}
      </div>

      {/* Controls row */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          onClick={addBooth}
        >
          + Add Booth
        </button>

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-semibold">Grid:</span>
          <select
            className="rounded-lg border px-2 py-1"
            value={gridPx}
            onChange={(e) => setGridPx(Number(e.target.value))}
          >
            <option value={16}>16px</option>
            <option value={24}>24px</option>
            <option value={32}>32px</option>
            <option value={40}>40px</option>
            <option value={48}>48px</option>
          </select>

          <span className="ml-4 text-gray-500">
            Click a booth to edit • Drag to move • Resize handles to change size
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Available
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            Pending
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
            Booked
          </div>
        </div>
      </div>

      {/* Main grid (KEY FIX: min-w-0 so the canvas column can shrink) */}
      <div className="mt-4 grid min-w-0 items-start gap-5 lg:grid-cols-[1fr_360px] flex-1 min-h-0">
        {/* LEFT: canvas card (KEY FIX: min-w-0 + overflow-hidden so it doesn't force horizontal overflow) */}
        <div
          className={`min-w-0 overflow-hidden rounded-2xl p-4 shadow-sm ring-1 ${
            darkGrid ? "bg-slate-950 ring-white/10" : "bg-white ring-gray-200"
          }`}
        >
          {/* This wrapper is where we want scrolling (only if canvas is larger) */}
          <div className="max-w-full overflow-auto rounded-2xl">
            <DiagramEditor
              gridPx={gridPx}
              slots={slots}
              onChangeSlots={setSlots}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              readOnly={false}
              widthPx={1100}
              heightPx={640}
              showGrid={showGrid}
              gridTheme={darkGrid ? "dark" : "light"}
            />
          </div>

          <div className={`mt-3 text-xs ${darkGrid ? "text-slate-300" : "text-gray-500"}`}>
            Tip: set canvas to 1200×800 like Figma, then scroll to work with larger layouts.
          </div>
        </div>

        {/* RIGHT: panel (allowed to shrink too; avoids being pushed off-screen) */}
        <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200 h-full overflow-visible">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 bg-white px-4 pt-4 pb-3 border-b flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-extrabold">Booth Properties</div>
              <div className="text-xs text-gray-500">Edit selected booth details</div>
            </div>
            <button
              className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50"
              onClick={() => setSelectedId(null)}
              title="Close"
            >
              ✕
            </button>
          </div>

          {!selected ? (
            <div className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
              Select a booth on the canvas to edit its properties.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700">Booth Label</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={selected.label || ""}
                  onChange={(e) => updateSelected({ label: e.target.value })}
                />
              </div>

              <div className="grid min-w-0 grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-gray-700">Width (grid)</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    type="number"
                    min={1}
                    value={selected.w}
                    onChange={(e) => updateSelected({ w: Math.max(1, Number(e.target.value || 1)) })}
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-gray-700">Height (grid)</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    type="number"
                    min={1}
                    value={selected.h}
                    onChange={(e) => updateSelected({ h: Math.max(1, Number(e.target.value || 1)) })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Price ($)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="numeric"
                  value={centsToDollars(selected.price_cents)}
                  onChange={(e) => updateSelected({ price_cents: dollarsToCents(e.target.value) })}
                />
                <div className="mt-1 text-xs text-gray-500">Vendors will see this price</div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Category</label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={selected.category_id ?? ""}
                  onChange={(e) =>
                    updateSelected({ category_id: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">— None —</option>
                  <option value="1">Food &amp; Beverage</option>
                  <option value="2">Arts &amp; Crafts</option>
                  <option value="3">Services</option>
                </select>
                <div className="mt-1 text-xs text-gray-500">
                  (Temporary list) We’ll wire this to real categories later.
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Size</label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={selectedPresetKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    const preset = SIZE_PRESETS.find((p) => p.key === key) || SIZE_PRESETS[0];
                    if (preset.key === "custom") return;
                    updateSelected({ w: preset.w, h: preset.h });
                  }}
                >
                  {SIZE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-gray-500">
                  Select a preset or manually adjust width/height
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Status</label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={selected.status ?? "available"}
                  onChange={(e) => updateSelected({ status: e.target.value })}
                >
                  <option value="available">Available</option>
                  <option value="pending">Pending</option>
                  <option value="booked">Booked</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Assign Vendor</label>
                <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value="">
                  <option value="">No vendor assigned</option>
                </select>
                <div className="mt-1 text-xs text-gray-500">
                  (Coming soon) Vendor assignment will be enabled after approvals.
                </div>
              </div>

              <div className="pt-2">
                <button
                  className="w-full rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-600"
                  onClick={deleteSelected}
                >
                  ✕ Delete Booth
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
