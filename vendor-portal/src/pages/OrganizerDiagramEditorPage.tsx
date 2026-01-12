// src/pages/OrganizerDiagramEditorPage.tsx
//
// Organizer Diagram Editor — ASSIGN + REASSIGN + UNASSIGN (CONTRACTED)
// ✅ GET   /organizer/events/{event_id}/diagram
// ✅ GET   /organizer/events/{event_id}/applications?limit=200&offset=0
// ✅ PATCH /organizer/events/{event_id}/applications/{app_id}
//      body: { assigned_slot_id: <db_slot_id> }  => assign/reassign
//      body: { assigned_slot_id: null }         => unassign (return booth to available)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { API_BASE } from "../api";

type SlotStatus = "available" | "pending" | "approved" | "assigned" | "blocked" | string;

type Slot = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  status: SlotStatus;
  db_slot_id?: number | null;
};

type Diagram = {
  width: number;
  height: number;
  slots: Slot[];
};

type Application = {
  id: number;
  vendor_name?: string | null;
  business_name?: string | null;
  status: string;
  assigned_slot_id?: number | null;
  requested_slots?: number | null;
  payment_status?: string | null;
  total_due_cents?: number | null;
};

type ApplicationsResponse = {
  event_id: number;
  items: Application[];
};

function token() {
  return localStorage.getItem("access_token");
}

async function apiJson(path: string, init?: RequestInit) {
  const t = token();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

type ToastKind = "info" | "success" | "error";

function Toast({
  kind,
  message,
  onClose,
}: {
  kind: ToastKind;
  message: string;
  onClose: () => void;
}) {
  const klass =
    kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`fixed top-3 right-3 z-50 max-w-[460px] rounded-2xl border p-3 shadow ${klass}`}>
      <div className="flex items-start gap-3">
        <div className="text-sm font-semibold flex-1">{message}</div>
        <button
          className="text-sm opacity-70 hover:opacity-100"
          onClick={onClose}
          aria-label="Close toast"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function OrganizerDiagramEditorPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const nav = useNavigate();
  const eid = useMemo(() => Number(eventId), [eventId]);
  const location = useLocation();

  const armedAppIdFromQuery = useMemo(() => {
    const search = location.search || "";
    const params = new URLSearchParams(search);
    const raw = params.get("appId");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }, [location.search]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const [apps, setApps] = useState<Application[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);

  // If arriving with ?appId=XYZ in the URL, auto-select that application once.
  useEffect(() => {
    if (!armedAppIdFromQuery || selectedAppId !== null || apps.length === 0) {
      return;
    }
    const match = apps.find((a) => a.id === armedAppIdFromQuery);
    if (match) {
      setSelectedAppId(match.id);
    }
  }, [armedAppIdFromQuery, apps, selectedAppId]);

  const [hoverSlotId, setHoverSlotId] = useState<string | null>(null);

  const [pulseSlotId, setPulseSlotId] = useState<string | null>(null);
  const pulseTimer = useRef<number | null>(null);

  const appCardRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const slotRowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  function showToast(kind: ToastKind, message: string, ms = 2400) {
    setToast({ kind, message });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  function formatMoney(cents?: number | null): string {
    if (typeof cents !== "number") return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  }

  const selectedApp = useMemo(
    () => apps.find((a) => a.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );

  const selectedSlot = useMemo(
    () => diagram?.slots.find((s) => s.id === selectedSlotId) ?? null,
    [diagram, selectedSlotId]
  );

  const appsAssignedToSelectedSlot = useMemo(() => {
    if (!selectedSlot || !diagram) return [];
    if (!selectedSlot.db_slot_id) return [];
    return apps.filter((a) => a.assigned_slot_id === selectedSlot.db_slot_id);
  }, [apps, selectedSlot, diagram]);

  function boothLabelForDbSlotId(dbSlotId?: number | null): string | null {
    if (!diagram || !dbSlotId) return null;
    const s = diagram.slots.find((x) => x.db_slot_id === dbSlotId);
    return s?.label ?? null;
  }

  function boothDiagramIdForDbSlotId(dbSlotId?: number | null): string | null {
    if (!diagram || !dbSlotId) return null;
    const s = diagram.slots.find((x) => x.db_slot_id === dbSlotId);
    return s?.id ?? null;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [d, a] = await Promise.all([
        apiJson(`/organizer/events/${eid}/diagram`) as Promise<DiagramResponse>,
        apiJson(
          `/organizer/events/${eid}/applications?limit=200&offset=0`
        ) as Promise<ApplicationsResponse>,
      ]);

      setDiagram(d.diagram);
      setVersion(typeof d.version === "number" ? d.version : null);
      setApps(a.items || []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load diagram/applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(eid) || eid <= 0) {
      setError("Invalid event id.");
      setLoading(false);
      return;
    }
    loadAll();
  }, [eid]);

  function onSelectApp(appId: number) {
    setSelectedAppId(appId);
    const ref = appCardRefs.current.get(appId);
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function onSelectSlot(slotId: string) {
    setSelectedSlotId(slotId);
    const ref = slotRowRefs.current.get(slotId);
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function slotStatusColor(status: SlotStatus) {
    const s = (status || "").toLowerCase();
    if (s === "available") return "bg-emerald-100 border-emerald-400";
    if (s === "pending") return "bg-amber-100 border-amber-400";
    if (s === "approved") return "bg-sky-100 border-sky-400";
    if (s === "assigned") return "bg-violet-100 border-violet-500";
    if (s === "blocked") return "bg-slate-200 border-slate-500";
    return "bg-slate-100 border-slate-400";
  }

  function slotTextColor(status: SlotStatus) {
    const s = (status || "").toLowerCase();
    if (s === "available") return "text-emerald-900";
    if (s === "pending") return "text-amber-900";
    if (s === "approved") return "text-sky-900";
    if (s === "assigned") return "text-violet-900";
    if (s === "blocked") return "text-slate-900";
    return "text-slate-900";
  }

  function slotBorderExtra(slot: Slot) {
    if (slot.id === selectedSlotId) return "ring-2 ring-slate-900 ring-offset-1";
    if (slot.id === hoverSlotId) return "ring-2 ring-slate-500 ring-offset-1";
    if (slot.id === pulseSlotId)
      return "animate-pulse ring-2 ring-slate-900 ring-offset-1";
    return "";
  }

  const gridPx = 36;
  const boardW = diagram ? diagram.width * gridPx : 900;
  const boardH = diagram ? diagram.height * gridPx : 520;

  const armedText = useMemo(() => {
    if (!selectedApp) return null;
    const label = `Selected App #${selectedApp.id}`;
    const boothLabel = boothLabelForDbSlotId(selectedApp.assigned_slot_id);
    if (boothLabel) {
      return `${label} — currently assigned to ${boothLabel}. Click another booth to move them, or Unassign.`;
    }
    return `${label} — click a booth to assign.`;
  }, [selectedApp]);

  async function assignSelectedAppToSlot(slot: Slot) {
    if (!selectedApp) {
      setError("Select an application first.");
      showToast("error", "Select an application first.");
      return;
    }
    if (!slot.db_slot_id) {
      setError("This booth is missing db_slot_id.");
      showToast(
        "error",
        "This booth does not have db_slot_id. Fix in Map Editor first."
      );
      return;
    }

    const payload = { assigned_slot_id: slot.db_slot_id };
    setSaving(true);
    setError(null);
    try {
      await apiJson(
        `/organizer/events/${eid}/applications/${selectedApp.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      showToast(
        "success",
        `Assigned App #${selectedApp.id} to ${slot.label} (db_slot_id=${slot.db_slot_id}).`
      );
      await loadAll();
      setSelectedSlotId(slot.id);
    } catch (e: any) {
      setError(e.message ?? "Assignment failed.");
      showToast("error", "Assignment failed. Check Network → Response.");
    } finally {
      setSaving(false);
    }
  }

  async function unassignSelectedApp() {
    if (!selectedApp) return;
    if (!selectedApp.assigned_slot_id) {
      showToast("info", "This application is not assigned to a booth.");
      return;
    }

    const slotLabel = boothLabelForDbSlotId(selectedApp.assigned_slot_id) ?? "";

    setSaving(true);
    setError(null);
    try {
      await apiJson(
        `/organizer/events/${eid}/applications/${selectedApp.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ assigned_slot_id: null }),
        }
      );
      showToast(
        "success",
        `Unassigned App #${selectedApp.id}${
          slotLabel ? ` from ${slotLabel}` : ""
        }.`
      );
      await loadAll();
      const diagId = boothDiagramIdForDbSlotId(selectedApp.assigned_slot_id);
      if (diagId) {
        setSelectedSlotId(diagId);
      }
    } catch (e: any) {
      setError(e.message ?? "Unassign failed.");
      showToast("error", "Unassign failed. Check Network → Response.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-slate-600 text-sm">Loading diagram & applications…</div>
      </div>
    );
  }

  if (error && !diagram) {
    return (
      <div className="p-6 space-y-4">
        <button
          onClick={() => nav("/organizer/events")}
          className="text-sm text-emerald-700 hover:underline"
        >
          ← Back to events
        </button>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {toast && (
        <Toast
          kind={toast.kind}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => nav("/organizer/events")}
          className="text-sm text-emerald-700 hover:underline"
        >
          ← Back to events
        </button>
        <div className="text-xs text-slate-500">
          Event #{eid} • Diagram version{" "}
          {version !== null ? version : "—"}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)] gap-4">
        {/* LEFT: BOARD */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">
              Diagram editor (assign / reassign / unassign)
            </h1>
            {selectedApp && (
              <div className="text-xs rounded-full bg-slate-900 text-white px-3 py-1">
                Armed: App #{selectedApp.id}
              </div>
            )}
          </div>

          {armedText && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              {armedText}
            </div>
          )}

          {!diagram && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              No diagram yet. Use the Map Editor to create a layout first.
            </div>
          )}

          {diagram && (
            <div className="relative overflow-auto rounded-2xl border bg-slate-50 p-4">
              <div
                className="relative bg-white border border-slate-200"
                style={{
                  width: `${boardW}px`,
                  height: `${boardH}px`,
                  backgroundImage:
                    "linear-gradient(to right, #e5e7eb 1px, transparent 1px), linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)",
                  backgroundSize: `${gridPx}px ${gridPx}px`,
                }}
              >
                {diagram.slots.map((slot) => {
                  const appsOnThisSlot = apps.filter(
                    (a) => a.assigned_slot_id === slot.db_slot_id
                  );
                  const isSelected = slot.id === selectedSlotId;
                  const isHover = slot.id === hoverSlotId;

                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className={`absolute flex flex-col items-center justify-center border text-[10px] font-medium rounded ${
                        slotStatusColor(slot.status)
                      } ${slotTextColor(slot.status)} ${slotBorderExtra(slot)}`}
                      style={{
                        left: (slot.x - 1) * gridPx,
                        top: (slot.y - 1) * gridPx,
                        width: slot.w * gridPx,
                        height: slot.h * gridPx,
                      }}
                      onMouseEnter={() => setHoverSlotId(slot.id)}
                      onMouseLeave={() => setHoverSlotId((prev) =>
                        prev === slot.id ? null : prev
                      )}
                      onClick={() => {
                        if (selectedApp) {
                          assignSelectedAppToSlot(slot);
                        } else {
                          onSelectSlot(slot.id);
                        }
                      }}
                    >
                      <div className="truncate max-w-[90%]">{slot.label}</div>
                      {appsOnThisSlot.length > 0 && (
                        <div className="mt-0.5 text-[9px] opacity-80">
                          {appsOnThisSlot.length} app
                          {appsOnThisSlot.length !== 1 ? "s" : ""}
                        </div>
                      )}
                      {isSelected && !selectedApp && (
                        <div className="mt-0.5 text-[9px]">
                          Selected (no app armed)
                        </div>
                      )}
                      {isSelected && selectedApp && (
                        <div className="mt-0.5 text-[9px]">
                          Clicked with App #{selectedApp.id}
                        </div>
                      )}
                      {isHover && !isSelected && (
                        <div className="mt-0.5 text-[9px]">
                          Click to{" "}
                          {selectedApp ? "assign here" : "inspect booth"}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500">
            <div>
              Click an application on the right to arm it, then click a booth on
              the map to assign or move.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={unassignSelectedApp}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Unassign selected app
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: APPLICATIONS LIST */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Applications</h2>
            <button
              type="button"
              disabled={loading || saving}
              onClick={loadAll}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh list
            </button>
          </div>

          <div className="rounded-2xl border bg-slate-50 p-2 max-h-[540px] overflow-auto">
            {apps.length === 0 && (
              <div className="p-3 text-xs text-slate-500">
                No applications yet.
              </div>
            )}

            <div className="flex flex-col gap-2">
              {apps.map((app) => {
                const isSelected = app.id === selectedAppId;
                const boothLabel = boothLabelForDbSlotId(app.assigned_slot_id);

                return (
                  <button
                    key={app.id}
                    ref={(el) => appCardRefs.current.set(app.id, el)}
                    type="button"
                    onClick={() => onSelectApp(app.id)}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs ${
                      isSelected
                        ? "border-slate-900 bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-semibold">
                        #{app.id} •{" "}
                        {app.business_name || app.vendor_name || "Vendor"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Status: {app.status}
                      </div>
                      {boothLabel && (
                        <div className="text-[11px] text-emerald-700">
                          Assigned: {boothLabel}
                        </div>
                      )}
                      {app.total_due_cents != null && (
                        <div className="text-[11px] text-slate-500">
                          Total: {formatMoney(app.total_due_cents)} •{" "}
                          {app.payment_status || "unpaid"}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          app.assigned_slot_id
                            ? "bg-violet-100 text-violet-900"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {app.assigned_slot_id
                          ? "Has booth"
                          : "No booth yet"}
                      </span>
                      {isSelected && (
                        <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
                          Armed
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-slate-500">
            🔒 Assignment uses <b>db_slot_id</b>. Diagram string IDs like “B1”
            are labels only.
          </div>
        </div>
      </div>
    </div>
  );
}
