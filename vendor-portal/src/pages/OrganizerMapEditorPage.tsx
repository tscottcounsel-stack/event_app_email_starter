// src/pages/OrganizerMapEditorPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DiagramEditor from "../components/DiagramEditor";
import { ApiError, apiGet, apiPut } from "../api";

type Slot = {
  // NOTE: negative ids are TEMP client ids (new slots not yet in DB)
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
};

type DiagramDTO = {
  event_id: number;
  version: number;
  grid_px: number;
  slots: Array<{
    id?: number;
    label?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    status?: string;
    kind?: string;
    price_cents?: number;
    category_id?: number | null;
  }>;
  meta?: any;
};

const DEFAULT_GRID_PX = 32;

function normalizeSlot(s: any): Slot {
  const rawId = Number(s?.id ?? 0);
  return {
    id: Number.isFinite(rawId) ? rawId : 0,
    label: String(s?.label ?? ""),
    x: Number(s?.x ?? 0),
    y: Number(s?.y ?? 0),
    w: Math.max(1, Number(s?.w ?? 1)),
    h: Math.max(1, Number(s?.h ?? 1)),
    status: s?.status ?? "available",
    kind: s?.kind ?? "standard",
    price_cents: Number(s?.price_cents ?? 0),
    category_id: s?.category_id ?? null,
  };
}

function buildStarterLayout(): Slot[] {
  // TEMP ids (negative) so backend won't think these are existing DB slot ids
  return [
    { id: -1, label: "A1", x: 1, y: 1, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
    { id: -2, label: "A2", x: 4, y: 1, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
    { id: -3, label: "A3", x: 7, y: 1, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
    { id: -4, label: "B1", x: 1, y: 4, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
    { id: -5, label: "B2", x: 3, y: 7, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
    { id: -6, label: "B3", x: 8, y: 6, w: 2, h: 2, status: "available", kind: "standard", price_cents: 15000, category_id: null },
  ];
}

function errToMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // show server detail if present
    const d: any = e.data as any;
    const detail =
      (typeof d === "string" && d) ||
      (d?.detail && (typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail))) ||
      (d && JSON.stringify(d)) ||
      "";
    return `HTTP ${e.status}${detail ? ` — ${detail}` : ""}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export default function OrganizerMapEditorPage() {
  const nav = useNavigate();
  const params = useParams();

  const raw = (params as any).eventId ?? (params as any).id;
  const eventId = Number(raw);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [gridPx, setGridPx] = useState(DEFAULT_GRID_PX);
  const [slots, setSlots] = useState<Slot[]>([]);

  const hasLayout = useMemo(() => (slots?.length ?? 0) > 0, [slots]);

  async function load() {
    if (!Number.isFinite(eventId) || eventId <= 0) return;

    setErr(null);
    setLoading(true);

    try {
      const data = await apiGet<DiagramDTO>(`/organizer/events/${eventId}/diagram`);
      setGridPx(Number(data?.grid_px ?? DEFAULT_GRID_PX));
      const incoming = Array.isArray(data?.slots) ? data.slots.map(normalizeSlot) : [];
      setSlots(incoming);
    } catch (e) {
      // If diagram doesn't exist yet, treat as "no layout yet"
      const msg = errToMessage(e);
      // Many setups return 404 if no slots/diagram yet — we still allow starter layout
      if (e instanceof ApiError && e.status === 404) {
        setGridPx(DEFAULT_GRID_PX);
        setSlots([]);
      } else {
        setErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!Number.isFinite(eventId) || eventId <= 0) return;

    setErr(null);
    setSaving(true);

    try {
      const payload = {
        grid_px: gridPx,
        slots: slots.map((s) => {
          const idNum = Number(s.id);
          const base = {
            label: s.label,
            x: s.x,
            y: s.y,
            w: s.w,
            h: s.h,
            status: s.status ?? "available",
            kind: s.kind ?? "standard",
            price_cents: Number(s.price_cents ?? 0),
            category_id: s.category_id ?? null,
          };

          // IMPORTANT:
          // - if id > 0 => existing DB slot, include id
          // - if id <= 0 => TEMP/new, OMIT id so backend can create it
          if (Number.isFinite(idNum) && idNum > 0) return { id: idNum, ...base };
          return base;
        }),
      };

      await apiPut(`/organizer/events/${eventId}/diagram`, payload);
      await load();
    } catch (e) {
      setErr(errToMessage(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-2xl font-bold">Invalid event id</div>
          <div className="mt-3">
            <Link className="underline text-slate-200" to="/organizer/events">
              Back to events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <Link to="/organizer/events" className="text-slate-200 hover:text-white">
              ← Back to events
            </Link>
            <div className="mt-2 text-4xl font-extrabold">Map Editor #{eventId}</div>
            <div className="mt-1 text-sm text-slate-300">Layout editor</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => nav(`/organizer/events/${eventId}/edit`)}
              className="rounded-full border border-slate-400/60 bg-slate-900/30 px-4 py-2 text-sm font-semibold hover:bg-slate-900/60"
            >
              Edit details
            </button>

            <button
              onClick={load}
              className="rounded-full border border-slate-400/60 bg-slate-900/30 px-4 py-2 text-sm font-semibold hover:bg-slate-900/60"
              disabled={loading || saving}
            >
              Refresh
            </button>

            <button
              onClick={onSave}
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-extrabold hover:bg-emerald-500 disabled:opacity-60"
              disabled={saving || loading || !hasLayout}
              title={!hasLayout ? "Create a starter layout first" : "Save layout"}
            >
              {saving ? "Saving..." : "Save layout"}
            </button>
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 p-4 text-red-100">
            {err}
          </div>
        )}

        {!hasLayout && !loading && (
          <div className="mb-4 rounded-2xl border border-slate-700/60 bg-slate-900/20 p-5">
            <div className="text-xl font-bold">No layout yet</div>
            <div className="mt-1 text-slate-300">
              New events start without a diagram. Create a starter layout, then Save layout.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setSlots(buildStarterLayout())}
                className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-bold hover:bg-indigo-500"
              >
                Create starter layout
              </button>
              <button
                onClick={() => nav(`/organizer/events/${eventId}/diagram`)}
                className="rounded-full border border-slate-400/60 bg-slate-900/30 px-5 py-2 text-sm font-bold hover:bg-slate-900/60"
              >
                Go to Diagram Assignments
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/20 p-4">
          <DiagramEditor gridPx={gridPx} slots={slots} onChangeSlots={setSlots} readOnly={false} />
        </div>
      </div>
    </div>
  );
}
