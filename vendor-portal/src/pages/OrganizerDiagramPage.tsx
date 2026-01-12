// src/pages/OrganizerDiagramPage.tsx
//
// Organizer Diagram — Assignment Wiring (CONTRACT LOCKED)
//
// ✅ GET   /organizer/events/{event_id}/diagram   (grid-based layout per DIAGRAM_CONTRACT)
// ✅ GET   /organizer/events/{event_id}/applications
// ✅ PATCH /organizer/events/{event_id}/applications/{app_id}
//      body: { assigned_slot_id: db_slot_id }
//
// 🔒 assignment uses db_slot_id ONLY
// 🔒 never send nulls
// 🔒 no OpenAPI discovery
// 🔒 no diagram geometry editing here (keeps rebuild stable)

import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../api";

// ---- Types for normalized assignment diagram ----

type Slot = {
  id: string; // logical id for React key ("B1")
  label: string;
  x: number; // 1-based grid
  y: number;
  w: number; // width in grid cells
  h: number; // height in grid cells
  status?: string;
  db_slot_id: number | null;
};

type Diagram = {
  width: number; // in grid cells
  height: number; // in grid cells
  slots: Slot[];
};

// ---- Raw diagram response from /organizer/events/{id}/diagram ----
// This matches the grid-based DIAGRAM_CONTRACT that the map editor is using.

type RawSlot = {
  id: number; // db slot id
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status?: string | null;
  kind?: string | null;
  price_cents?: number | null;
  category_id?: number | null;
};

type RawDiagramResponse = {
  event_id: number;
  version?: number;
  grid_px?: number;
  slots: RawSlot[];
  meta?: Record<string, unknown>;
};

type DiagramResponse = RawDiagramResponse; // for clarity below

type Application = {
  id: number;
  event_id: number;
  vendor_profile_id: number;
  status: "pending" | "approved" | "rejected" | string;
  assigned_slot_id?: number | null;
  vendor_name?: string | null;
  business_name?: string | null;
};

type ApplicationsResponse = {
  event_id: number;
  items: Application[];
};

function getToken() {
  return localStorage.getItem("access_token");
}

async function apiJson(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Helpers ----

// Status → color classes. Keep aligned with Map Editor where possible.
function statusClass(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "assigned") return "bg-emerald-600 text-white border-emerald-700";
  if (s === "approved") return "bg-sky-600 text-white border-sky-700";
  if (s === "pending") return "bg-amber-500 text-black border-amber-700";
  if (s === "blocked") return "bg-slate-700 text-white border-slate-800";
  return "bg-white text-slate-900 border-slate-300";
}

/**
 * Normalize raw grid-based diagram into a simple width/height + slots
 * structure for the assignment UI.
 *
 * 🔒 db_slot_id comes from rawSlot.id
 * 🔒 geometry stays in grid coordinates (1-based)
 */
function normalizeDiagram(raw: RawDiagramResponse): Diagram {
  const rawSlots = raw.slots || [];

  const slots: Slot[] = rawSlots.map((s) => {
    const x = s.x && s.x > 0 ? s.x : 1;
    const y = s.y && s.y > 0 ? s.y : 1;
    const w = s.w && s.w > 0 ? s.w : 1;
    const h = s.h && s.h > 0 ? s.h : 1;

    return {
      id: s.label || `slot-${s.id}`,
      label: s.label || `#${s.id}`,
      x,
      y,
      w,
      h,
      status: s.status || undefined,
      db_slot_id: typeof s.id === "number" ? s.id : null,
    };
  });

  // Compute bounding box in grid cells
  let maxX = 1;
  let maxY = 1;
  for (const s of slots) {
    maxX = Math.max(maxX, s.x + s.w - 1);
    maxY = Math.max(maxY, s.y + s.h - 1);
  }

  // Add one cell of padding so booths at the edge don't hug the border
  const width = Math.max(10, maxX + 1);
  const height = Math.max(6, maxY + 1);

  return { width, height, slots };
}

// ---- Component ----

export default function OrganizerDiagramPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const nav = useNavigate();
  const eid = useMemo(() => Number(eventId), [eventId]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const [apps, setApps] = useState<Application[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);

  // Simple zoom (safe)
  const [zoom, setZoom] = useState(1);

  const selectedApp = useMemo(
    () => apps.find((a) => a.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );

  const assignedSlotIds = useMemo(() => {
    const set = new Set<number>();
    for (const a of apps) {
      if (a.assigned_slot_id) set.add(a.assigned_slot_id);
    }
    return set;
  }, [apps]);

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      const [d, a] = await Promise.all([
        apiJson(`/organizer/events/${eid}/diagram`) as Promise<DiagramResponse>,
        apiJson(`/organizer/events/${eid}/applications`) as Promise<ApplicationsResponse>,
      ]);

      const normalized = normalizeDiagram(d);
      setDiagram(normalized);
      setVersion(typeof d.version === "number" ? d.version : null);
      setApps(a.items || []);

      // If previously selected app is no longer eligible, clear it.
      if (selectedAppId) {
        const still = (a.items || []).find((x) => x.id === selectedAppId);
        if (!still) setSelectedAppId(null);
      }
    } catch (e: any) {
      setErr(e.message ?? "Failed to load diagram/applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(eid) || eid <= 0) {
      setErr("Invalid event id.");
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  async function assignToSlot(slot: Slot) {
    setErr(null);

    if (!selectedApp) {
      setErr("Select an approved application first, then click a booth.");
      return;
    }
    if (selectedApp.status !== "approved") {
      setErr("Only approved applications can be assigned to a booth.");
      return;
    }
    if (selectedApp.assigned_slot_id) {
      setErr(
        "That application is already assigned. (Unassign/reassign is not enabled here.)"
      );
      return;
    }
    if (!slot.db_slot_id) {
      setErr("This booth does not have a db_slot_id and cannot be assigned.");
      return;
    }
    if (assignedSlotIds.has(slot.db_slot_id)) {
      setErr("That booth is already assigned to another application.");
      return;
    }

    setSaving(true);
    try {
      // 🔒 Contracted assignment call — no nulls, no extra fields
      await apiJson(`/organizer/events/${eid}/applications/${selectedApp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_slot_id: slot.db_slot_id }),
      });

      // Reload to reflect assignment + highlight
      await loadAll();
    } catch (e: any) {
      setErr(e.message ?? "Assignment failed.");
    } finally {
      setSaving(false);
    }
  }

  const eligibleApps = useMemo(
    () => apps.filter((a) => a.status === "approved" && !a.assigned_slot_id),
    [apps]
  );

  const otherApps = useMemo(
    () => apps.filter((a) => !(a.status === "approved" && !a.assigned_slot_id)),
    [apps]
  );

  // Render params
  const baseGridPx = 32;
  const gridPx = baseGridPx * zoom;
  const px = (n: number) => n * gridPx;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/organizer/events"
            className="text-sm text-emerald-700 hover:underline"
          >
            ← Back to events
          </Link>
          <div className="text-xl font-extrabold">
            Map Assignment — Event #{eid}
            {version !== null ? (
              <span className="ml-2 text-sm font-semibold text-slate-500">
                v{version}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border px-3 py-1 text-sm"
            onClick={() =>
              setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))
            }
            disabled={loading || saving}
          >
            −
          </button>
          <div className="w-16 text-center text-sm font-semibold">
            {Math.round(zoom * 100)}%
          </div>
          <button
            className="rounded-lg border px-3 py-1 text-sm"
            onClick={() =>
              setZoom((z) => Math.min(2.0, Math.round((z + 0.1) * 10) / 10))
            }
            disabled={loading || saving}
          >
            +
          </button>

          <button
            className="rounded-lg border px-3 py-1 text-sm"
            onClick={() => loadAll()}
            disabled={loading || saving}
            title="Refresh diagram and applications"
          >
            Refresh
          </button>

          <button
            className="rounded-lg bg-slate-900 px-3 py-1 text-sm text-white"
            onClick={() => nav(`/organizer/events/${eid}/applications`)}
            disabled={loading || saving}
          >
            Applications
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-900">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* Diagram */}
        <div className="rounded-2xl border bg-white p-3 overflow-auto">
          {loading ? (
            <div className="p-4 text-slate-600">Loading…</div>
          ) : !diagram ? (
            <div className="p-4 text-slate-600">No diagram found.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                Tip: Select an <b>approved</b> app on the right, then click a
                booth to assign.
              </div>

              <div
                className="relative border rounded-xl bg-slate-50"
                style={{
                  width: px(diagram.width),
                  height: px(diagram.height),
                  minWidth: 400,
                  minHeight: 260,
                }}
              >
                {diagram.slots.map((s) => {
                  const isAssignable =
                    !!s.db_slot_id && !assignedSlotIds.has(s.db_slot_id);
                  const isSelectedTarget =
                    !!selectedApp &&
                    isAssignable &&
                    selectedApp.status === "approved" &&
                    !selectedApp.assigned_slot_id;

                  return (
                    <button
                      key={`${s.id}-${s.db_slot_id ?? "null"}`}
                      type="button"
                      onClick={() => assignToSlot(s)}
                      disabled={
                        saving || loading || !isAssignable || !isSelectedTarget
                      }
                      title={
                        s.db_slot_id
                          ? `Booth ${s.label} (db_slot_id=${s.db_slot_id})`
                          : `Booth ${s.label} (not assignable: db_slot_id is null)`
                      }
                      className={[
                        "absolute rounded-lg border text-xs font-extrabold",
                        "flex items-center justify-center",
                        statusClass(s.status),
                        isAssignable && isSelectedTarget
                          ? "hover:opacity-90 cursor-pointer"
                          : "opacity-60 cursor-not-allowed",
                      ].join(" ")}
                      style={{
                        left: px(s.x - 1),
                        top: px(s.y - 1),
                        width: px(s.w),
                        height: px(s.h),
                      }}
                    >
                      {s.label}
                      {s.db_slot_id ? (
                        <span className="ml-1 opacity-80">
                          #{s.db_slot_id}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Applications panel */}
        <div className="rounded-2xl border bg-white p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-extrabold">
              Assign an approved application
            </div>
            {saving ? (
              <div className="text-sm font-semibold text-slate-600">
                Saving…
              </div>
            ) : null}
          </div>

          {/* Selected app */}
          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="text-sm font-bold mb-1">Selected application</div>
            {selectedApp ? (
              <div className="text-sm">
                <div>
                  <b>#{selectedApp.id}</b> —{" "}
                  {selectedApp.business_name ||
                    selectedApp.vendor_name ||
                    `Vendor ${selectedApp.vendor_profile_id}`}
                </div>
                <div className="text-slate-600">
                  status: <b>{selectedApp.status}</b>
                  {selectedApp.assigned_slot_id ? (
                    <>
                      {" "}
                      • assigned_slot_id:{" "}
                      <b>{selectedApp.assigned_slot_id}</b>
                    </>
                  ) : (
                    <> • not assigned</>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                Pick an approved application below.
              </div>
            )}
          </div>

          {/* Approved & unassigned */}
          <div className="space-y-2">
            <div className="text-sm font-bold">Approved & unassigned</div>
            {eligibleApps.length === 0 ? (
              <div className="text-sm text-slate-600">
                No approved/unassigned applications right now.
              </div>
            ) : (
              <div className="max-h-[280px] overflow-auto rounded-xl border">
                {eligibleApps.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAppId(a.id)}
                    className={[
                      "w-full text-left p-3 border-b last:border-b-0",
                      "hover:bg-slate-50",
                      selectedAppId === a.id ? "bg-emerald-50" : "bg-white",
                    ].join(" ")}
                    disabled={saving || loading}
                  >
                    <div className="font-extrabold text-sm">#{a.id}</div>
                    <div className="text-xs text-slate-600">
                      {a.business_name ||
                        a.vendor_name ||
                        `Vendor ${a.vendor_profile_id}`}{" "}
                      • status: {a.status}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Other apps */}
          <div className="space-y-2">
            <div className="text-sm font-bold text-slate-700">
              Other applications
            </div>
            <div className="max-h-[220px] overflow-auto rounded-xl border">
              {otherApps.length === 0 ? (
                <div className="p-3 text-sm text-slate-600">None</div>
              ) : (
                otherApps.map((a) => (
                  <div
                    key={a.id}
                    className="p-3 border-b last:border-b-0 bg-white"
                  >
                    <div className="font-bold text-sm">#{a.id}</div>
                    <div className="text-xs text-slate-600">
                      {a.business_name ||
                        a.vendor_name ||
                        `Vendor ${a.vendor_profile_id}`}{" "}
                      • status: {a.status}
                      {a.assigned_slot_id ? (
                        <> • assigned_slot_id: {a.assigned_slot_id}</>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Assignment uses <b>db_slot_id</b> from the diagram. Slots without
            db_slot_id are not assignable.
          </div>
        </div>
      </div>
    </div>
  );
}
