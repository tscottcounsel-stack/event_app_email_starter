// src/components/DiagramEditor.tsx

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import {
  getOrganizerDiagram,
  saveOrganizerDiagram,
  type SaveOrganizerDiagramPayload,
} from "../api/organizerDiagram";
import type { DiagramEnvelope, DiagramJson } from "../api/diagramTypes";
import { DiagramGrid } from "./DiagramGrid";
import { apiGet, apiPost } from "../api/api";

type LoadStatus = "idle" | "loading" | "loaded" | "saving" | "error";
type ApplicationsLoadStatus = "idle" | "loading" | "loaded" | "error";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const CELL_SIZE = 40; // must match DiagramGrid.tsx

export interface DiagramEditorProps {
  /** Optional: parent can pass eventId directly.
   *  If omitted, we fall back to useParams().
   */
  eventId?: number;
  /** Optional: initial booth label to select on load, e.g. B4 */
  initialSlot?: string;
}

interface OrganizerApplication {
  id: number;
  vendor_name?: string;
  business_name?: string;
  vendorName?: string;
  status: string;
  payment_status?: string;
  paymentStatus?: string;
  assigned_slot_label?: string | null;
  assigned_slot_code?: string | null; // tolerate either field name
  assigned_slot_id?: number | null;
  total_due_cents?: number;
  total_paid_cents?: number;
}

interface OrganizerEventApplicationsResponse {
  summary: {
    event_id: number;
    total_applications: number;
    pending: number;
    approved: number;
    rejected: number;
    total_due_cents: number;
    total_paid_cents: number;
  };
  items: OrganizerApplication[];
}

interface VendorProfile {
  id?: number | null;
  business_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  description?: string | null;
}

/**
 * Sync booth statuses in the diagram based on applications.
 * This is the heart of:
 *  - unified assignment logic + consistent colors
 *  - auto-sync diagram when assignments change
 */
function syncBoothStatusesFromApplications(
  diagram: DiagramJson,
  apps: OrganizerApplication[],
): DiagramJson {
  const originalMap = (diagram.boothMap || {}) as Record<string, any>;
  const newMap: Record<string, any> = {};

  // 1) Copy all booths and reset them to a sane baseline
  for (const [label, booth] of Object.entries(originalMap)) {
    const existingStatus =
      ((booth as any).status as string | undefined) ?? "available";

    // Streets stay streets; everything else defaults back to "available"
    const baseStatus = existingStatus === "street" ? "street" : "available";

    newMap[label] = {
      ...booth,
      status: baseStatus,
    };
  }

  // 2) Apply application-based statuses
  for (const app of apps) {
    const label = app.assigned_slot_label || app.assigned_slot_code;
    if (!label) continue;

    const booth = newMap[label];
    if (!booth) continue;

    const appStatus = (app.status || "").toLowerCase();
    const payment = (app.payment_status || app.paymentStatus || "")
      .toLowerCase()
      .trim();

    let statusFromApp = (booth as any).status ?? "available";

    if (appStatus === "rejected") {
      statusFromApp = "blocked"; // red
    } else if (appStatus === "pending") {
      statusFromApp = "pending"; // gold
    } else if (appStatus === "approved") {
      if (payment === "paid") {
        statusFromApp = "assigned"; // blue
      } else if (payment === "partial") {
        statusFromApp = "reserved"; // maybe orange
      } else {
        statusFromApp = "reserved"; // approved but unpaid
      }
    }

    newMap[label] = {
      ...booth,
      status: statusFromApp,
    };
  }

  return {
    ...diagram,
    boothMap: newMap,
  };
}

const DiagramEditor: React.FC<DiagramEditorProps> = ({
  eventId,
  initialSlot,
}) => {
  // Fallback to router param if prop not provided
  const { eventId: eventIdParam } = useParams<{ eventId: string }>();
  const effectiveEventId =
    eventId ?? (eventIdParam ? Number(eventIdParam) : NaN);

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [paymentFilter, setPaymentFilter] = useState<
    "all" | "unpaid" | "partial" | "paid"
  >("all");

  const [envelope, setEnvelope] = useState<DiagramEnvelope | null>(null);
  const [diagram, setDiagram] = useState<DiagramJson | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(
    initialSlot ? [initialSlot] : [],
  );

  // last lane shape snapshot so we can revert
  const [lastStreetSnapshot, setLastStreetSnapshot] = useState<{
    label: string;
    booth: any;
  } | null>(null);

  // applications for this event
  const [applications, setApplications] = useState<OrganizerApplication[]>([]);
  const [appsStatus, setAppsStatus] =
    useState<ApplicationsLoadStatus>("idle");
  const [appsError, setAppsError] = useState<string | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);

  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  // Vendor modal state
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorProfile | null>(
    null,
  );

  function getFilteredApplications(
    apps: OrganizerApplication[],
  ): OrganizerApplication[] {
    return apps.filter((app) => {
      const s = (app.status || "").toLowerCase();
      const p = (app.payment_status || app.paymentStatus || "").toLowerCase();

      if (statusFilter !== "all" && s !== statusFilter) {
        return false;
      }

      if (paymentFilter !== "all" && p !== paymentFilter) {
        return false;
      }

      return true;
    });
  }

  const filteredApplications = getFilteredApplications(applications);

  // ---------------- load existing diagram + applications ----------------

  useEffect(() => {
    if (!effectiveEventId || Number.isNaN(effectiveEventId)) {
      setError("Invalid event id.");
      setStatus("error");
      return;
    }

    let cancelled = false;

    async function loadDiagram() {
      try {
        setStatus("loading");
        setError(null);

        console.log(
          "[DiagramEditor] loading diagram for event",
          effectiveEventId,
        );
        const resp = await getOrganizerDiagram(effectiveEventId);
        console.log("[DiagramEditor] got diagram", resp);

        if (cancelled) return;

        setEnvelope(resp);

        const incomingDiagram = resp.diagram ?? null;

        if (incomingDiagram) {
          setDiagram(incomingDiagram);
        } else {
          const blank: DiagramJson = {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            boothMap: {},
          };
          setDiagram(blank);
        }

        // only keep initialSlot selection if we still have that label
        setSelectedLabels((prev) => {
          if (prev.length === 1 && incomingDiagram?.boothMap?.[prev[0]]) {
            return prev;
          }
          return [];
        });

        setLastStreetSnapshot(null);
        setStatus("loaded");
      } catch (err) {
        console.error("[DiagramEditor] failed to load diagram", err);
        if (cancelled) return;

        // Still allow editing by starting from blank
        const blank: DiagramJson = {
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          boothMap: {},
        };
        setDiagram(blank);
        setEnvelope(null);
        setSelectedLabels([]);
        setLastStreetSnapshot(null);
        setStatus("loaded");
        setError(
          "Could not load existing event map. Starting with a blank map.",
        );
      }
    }

    async function loadApplications() {
      try {
        setAppsStatus("loading");
        setAppsError(null);

        const resp = await apiGet<OrganizerEventApplicationsResponse>(
          `/organizer/events/${effectiveEventId}/applications?page=1&page_size=200`,
        );

        if (cancelled) return;

        setApplications(resp.items ?? []);
        setAppsStatus("loaded");

        // auto-sync booth statuses from applications
        setDiagram((prev) =>
          prev
            ? syncBoothStatusesFromApplications(prev, resp.items ?? [])
            : prev,
        );
      } catch (err: any) {
        console.error(
          "[DiagramEditor] failed to load event applications – treating as no applications",
          err,
        );
        if (cancelled) return;

        // If the endpoint 404s / 401s / errors, just show "no applications"
        setApplications([]);
        setAppsStatus("loaded");
        setAppsError(
          err?.status === 401
            ? "You are not authorized to view applications for this event."
            : null,
        );
      }
    }

    loadDiagram();
    loadApplications();

    return () => {
      cancelled = true;
    };
  }, [effectiveEventId]);

  // ---------------- save handler ----------------

  async function handleSave() {
    if (!diagram || !effectiveEventId || Number.isNaN(effectiveEventId)) return;

    try {
      setStatus("saving");
      setError(null);

      const payload: SaveOrganizerDiagramPayload = {
        diagram,
        expectVersion: envelope?.version,
      };

      console.log("[DiagramEditor] saving diagram", payload);

      const resp = await saveOrganizerDiagram(effectiveEventId, payload);
      console.log("[DiagramEditor] save result", resp);

      setEnvelope(resp);
      setDiagram(resp.diagram ?? diagram);
      setStatus("loaded");
    } catch (err) {
      console.error("[DiagramEditor] failed to save diagram", err);
      setStatus("error");
      setError("Could not save event map. Please try again.");
    }
  }

  // ---------------- booth helpers (bulk tools + add booth + street tools) ----------------

  const boothMap: Record<string, any> = (diagram as any)?.boothMap || {};
  const selectionCount = selectedLabels.length;
  const primaryLabel = selectionCount > 0 ? selectedLabels[0] : null;
  const primaryBooth = primaryLabel ? boothMap[primaryLabel] : null;

  function handleAddBooth() {
    if (!diagram) return;

    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;

    // Generate a unique label like B1, B2, B3...
    let i = 1;
    let newLabel = `B${i}`;
    while (map[newLabel]) {
      i += 1;
      newLabel = `B${i}`;
    }

    const newBooth = {
      label: newLabel,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      status: "available",
    };

    map[newLabel] = newBooth;

    setDiagram({
      ...diagram,
      boothMap: map,
    });
    setSelectedLabels([newLabel]);
  }

  function handleDeleteSelected() {
    if (!diagram || selectionCount === 0) return;
    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;

    for (const lbl of selectedLabels) {
      delete map[lbl];
    }

    setDiagram({
      ...diagram,
      boothMap: map,
    });
    setSelectedLabels([]);
    setLastStreetSnapshot(null);
  }

  function handleDuplicateSelected() {
    if (!diagram || selectionCount === 0) return;

    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;
    const newLabels: string[] = [];

    for (const label of selectedLabels) {
      const original = map[label];
      if (!original) continue;

      const baseLabel = label;
      let i = 2;
      let newLabel = `${baseLabel}_${i}`;
      while (map[newLabel]) {
        i += 1;
        newLabel = `${baseLabel}_${i}`;
      }

      const copy = {
        ...original,
        label: newLabel,
        x: (original.x ?? 0) + 1,
        y: (original.y ?? 0) + 1,
      };

      map[newLabel] = copy;
      newLabels.push(newLabel);
    }

    setDiagram({
      ...diagram,
      boothMap: map,
    });
    if (newLabels.length > 0) {
      setSelectedLabels(newLabels);
    }
    setLastStreetSnapshot(null);
  }

  function handleSetStatusForSelection(nextStatus: string) {
    if (!diagram || selectionCount === 0) return;

    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;

    for (const label of selectedLabels) {
      const current = map[label];
      if (!current) continue;
      map[label] = {
        ...current,
        status: nextStatus,
      };
    }

    setDiagram({
      ...diagram,
      boothMap: map,
    });

    if (nextStatus !== "street") {
      setLastStreetSnapshot(null);
    }
  }

  // Street helpers
  function getGridDimensions() {
    const w = diagram?.width ?? DEFAULT_WIDTH;
    const h = diagram?.height ?? DEFAULT_HEIGHT;
    const cols = Math.max(1, Math.floor(w / CELL_SIZE));
    const rows = Math.max(1, Math.floor(h / CELL_SIZE));
    return { cols, rows };
  }

  function snapshotCurrentStreetShape() {
    if (!diagram || !primaryLabel || !primaryBooth) return;
    setLastStreetSnapshot({
      label: primaryLabel,
      booth: { ...primaryBooth },
    });
  }

  function handleStreetMakeHorizontal() {
    if (!diagram || !primaryLabel || !primaryBooth) return;

    const { cols } = getGridDimensions();
    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;
    const current = map[primaryLabel];
    if (!current) return;

    snapshotCurrentStreetShape();

    map[primaryLabel] = {
      ...current,
      x: 0,
      width: cols,
    };

    setDiagram({
      ...diagram,
      boothMap: map,
    });
  }

  function handleStreetMakeVertical() {
    if (!diagram || !primaryLabel || !primaryBooth) return;

    const { rows } = getGridDimensions();
    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;
    const current = map[primaryLabel];
    if (!current) return;

    snapshotCurrentStreetShape();

    map[primaryLabel] = {
      ...current,
      y: 0,
      height: rows,
    };

    setDiagram({
      ...diagram,
      boothMap: map,
    });
  }

  function handleStreetRevertShape() {
    if (!diagram || !lastStreetSnapshot) return;

    const { label, booth } = lastStreetSnapshot;
    const map = { ...(diagram.boothMap || {}) } as Record<string, any>;
    if (!map[label]) return;

    map[label] = { ...booth };

    setDiagram({
      ...diagram,
      boothMap: map,
    });
  }

  // ---------------- Vendor profile helpers ----------------

  async function handleViewVendor(appId: number) {
    try {
      setVendorModalOpen(true);
      setVendorLoading(true);
      setVendorError(null);
      setSelectedVendor(null);

      const profile = await apiGet<VendorProfile>(
        `/organizer/applications/${appId}/vendor-profile`,
      );

      setSelectedVendor(profile);
    } catch (err) {
      console.error("[DiagramEditor] failed to load vendor profile", err);
      setVendorError("Could not load vendor profile.");
      setSelectedVendor(null);
    } finally {
      setVendorLoading(false);
    }
  }

  function closeVendorModal() {
    setVendorModalOpen(false);
    setVendorLoading(false);
    setVendorError(null);
    setSelectedVendor(null);
  }

  // ---------------- Assign booth to application ----------------

  async function handleAssignToBooth() {
    if (
      !effectiveEventId ||
      Number.isNaN(effectiveEventId) ||
      !primaryLabel ||
      selectedAppId == null
    ) {
      return;
    }

    try {
      setAssigning(true);
      setAssignError(null);
      setAssignSuccess(null);

      console.log(
        "[DiagramEditor] assigning application",
        selectedAppId,
        "to booth",
        primaryLabel,
      );

      // backend expects slot_label in the payload
      await apiPost(
        `/organizer/events/${effectiveEventId}/applications/${selectedAppId}/assign-slot`,
        { slot_label: primaryLabel },
      );

      // Reload applications so we see updated assignment
      const refreshed =
        await apiGet<OrganizerEventApplicationsResponse>(
          `/organizer/events/${effectiveEventId}/applications?page=1&page_size=200`,
        );

      setApplications(refreshed.items ?? []);

      // sync booth statuses from fresh applications
      setDiagram((prev) =>
        prev
          ? syncBoothStatusesFromApplications(prev, refreshed.items ?? [])
          : prev,
      );

      setAssignSuccess(
        `Assigned application #${selectedAppId} to booth ${primaryLabel}.`,
      );
    } catch (err) {
      console.error("[DiagramEditor] failed to assign booth", err);
      setAssignError(
        "Could not assign this booth to the selected application.",
      );
    } finally {
      setAssigning(false);
    }
  }

  const isLoading = status === "loading" || status === "idle";
  const isSaving = status === "saving";

  const sizeText =
    primaryBooth &&
    `${(primaryBooth as any).width ?? (primaryBooth as any).w ?? 1}×${
      (primaryBooth as any).height ?? (primaryBooth as any).h ?? 1
    }`;
  const statusText = (primaryBooth as any)?.status ?? "available";

  const STATUS_OPTIONS = [
    "available",
    "assigned",
    "pending",
    "reserved",
    "blocked",
    "street",
  ];

  const canRevertStreetShape =
    statusText === "street" &&
    lastStreetSnapshot &&
    lastStreetSnapshot.label === primaryLabel;

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  // ---------------- render ----------------

  return (
    <div className="space-y-4">
      {/* Top bar inside the editor card – just Save button, page has header */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!diagram || isSaving}
          className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 disabled:hover:bg-emerald-600"
        >
          {isSaving ? "Saving…" : "Save layout"}
        </button>
      </div>

      {isLoading && (
        <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          Loading event map…
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          {error}
        </div>
      )}

      {/* Main layout: grid on the left, side panel on the right */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
        {/* Diagram grid */}
        <div className="rounded-md bg-slate-950/90 p-3">
          {diagram ? (
            <DiagramGrid
              diagram={diagram}
              onDiagramChange={setDiagram}
              selectedLabels={selectedLabels}
              onSelectionChange={(labels) => {
                setSelectedLabels(labels);
              }}
            />
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-300">
              No diagram data available for this event.
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="rounded-md bg-slate-900/95 p-3 text-xs text-slate-100">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Booth & applications</div>
            <button
              type="button"
              onClick={handleAddBooth}
              className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
            >
              + Add booth
            </button>
          </div>

          {/* No booth selected */}
          {selectionCount === 0 && (
            <div className="space-y-3 text-slate-300/80">
              <div>
                Select a booth on the map to see its details here, or use{" "}
                <span className="font-semibold">Add booth</span> to create a
                new one. Hold <span className="font-semibold">Shift</span> or{" "}
                <span className="font-semibold">Ctrl</span> to select multiple
                booths.
              </div>

              <div className="pt-2 border-t border-slate-800">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Applications for this event
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(e.target.value as typeof statusFilter)
                      }
                    >
                      <option value="all">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px]"
                      value={paymentFilter}
                      onChange={(e) =>
                        setPaymentFilter(
                          e.target.value as typeof paymentFilter,
                        )
                      }
                    >
                      <option value="all">All payments</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>
                </div>

                {appsStatus === "loading" && (
                  <div className="text-slate-400">Loading applications…</div>
                )}
                {appsStatus === "error" && (
                  <div className="text-rose-300 text-[11px]">
                    {appsError ?? "Could not load applications."}
                  </div>
                )}
                {appsStatus === "loaded" && applications.length === 0 && (
                  <div className="text-slate-400">
                    No applications have been submitted for this event yet.
                  </div>
                )}
                {appsStatus === "loaded" && applications.length > 0 && (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-slate-950/60 p-2">
                    {filteredApplications.map((app) => {
                      const label =
                        app.vendor_name ||
                        app.business_name ||
                        app.vendorName ||
                        `Application #${app.id}`;
                      const assignedLabel =
                        app.assigned_slot_label || app.assigned_slot_code;

                      return (
                        <div
                          key={app.id}
                          role="button"
                          onClick={() => {
                            setSelectedAppId(app.id);
                            // clicking an app highlights its booth
                            if (assignedLabel) {
                              setSelectedLabels([assignedLabel]);
                            }
                          }}
                          className="w-full cursor-pointer rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-left text-[11px] hover:bg-slate-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate font-medium">
                              {label}
                            </div>
                            <div className="text-[10px] uppercase text-slate-400">
                              {app.status}
                            </div>
                          </div>
                          {assignedLabel && (
                            <div className="mt-0.5 text-[10px] text-emerald-300">
                              Assigned: {assignedLabel}
                            </div>
                          )}
                          <div className="mt-1 flex justify-between gap-2">
                            <div className="text-[10px] text-slate-400">
                              {formatCents(app.total_paid_cents)} /{" "}
                              {formatCents(app.total_due_cents)}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewVendor(app.id);
                              }}
                              className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-50 hover:bg-slate-700"
                            >
                              View vendor
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Single booth selected */}
          {selectionCount === 1 && primaryBooth && primaryLabel && (
            <div className="space-y-3">
              {/* Booth details */}
              <div className="space-y-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Label
                  </div>
                  <div className="text-sm font-medium">{primaryLabel}</div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Size
                  </div>
                  <div className="text-sm">{sizeText}</div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    Status
                  </div>
                  <div className="text-sm capitalize">{statusText}</div>
                </div>

                {/* Status quick-set for single booth */}
                <div className="pt-1">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                    Set status
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STATUS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSetStatusForSelection(s)}
                        className={`rounded-md px-2 py-0.5 text-[11px] capitalize ${
                          statusText === s
                            ? "bg-slate-100 text-slate-900"
                            : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extra tools when this booth is a street */}
                {statusText === "street" && (
                  <div className="pt-2 space-y-2">
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                        Street tools
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleStreetMakeHorizontal}
                          className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium hover:bg-slate-700"
                        >
                          Make full-width lane
                        </button>
                        <button
                          type="button"
                          onClick={handleStreetMakeVertical}
                          className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium hover:bg-slate-700"
                        >
                          Make full-height lane
                        </button>
                      </div>
                    </div>

                    {canRevertStreetShape && (
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                          Undo
                        </div>
                        <button
                          type="button"
                          onClick={handleStreetRevertShape}
                          className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-600"
                        >
                          Revert lane shape
                        </button>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Restores this street booth to its previous position
                          and size before using the lane tools.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Assign booth to application */}
              <div className="pt-2 border-t border-slate-800">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                  Assign booth to application
                </div>

                {appsStatus === "loading" && (
                  <div className="text-slate-400 text-[11px]">
                    Loading applications…
                  </div>
                )}

                {appsStatus === "error" && (
                  <div className="text-rose-300 text-[11px]">
                    {appsError ?? "Could not load applications."}
                  </div>
                )}

                {appsStatus === "loaded" && applications.length === 0 && (
                  <div className="text-slate-400 text-[11px]">
                    No applications yet. When vendors apply to this event,
                    you&apos;ll be able to assign them to this booth.
                  </div>
                )}

                {appsStatus === "loaded" && applications.length > 0 && (
                  <>
                    <div className="mb-1 text-[11px] text-slate-400">
                      Select an application, then click{" "}
                      <span className="font-semibold">
                        Assign to this booth
                      </span>
                      .
                    </div>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-slate-950/60 p-2">
                      {filteredApplications.map((app) => {
                        const label =
                          app.vendor_name ||
                          app.business_name ||
                          app.vendorName ||
                          `Application #${app.id}`;
                        const isSelected = app.id === selectedAppId;
                        const assignedLabel =
                          app.assigned_slot_label || app.assigned_slot_code;
                        const isAssignedHere =
                          assignedLabel &&
                          assignedLabel === primaryLabel;

                        return (
                          <div
                            key={app.id}
                            onClick={() => {
                              setSelectedAppId(app.id);
                              if (assignedLabel) {
                                setSelectedLabels([assignedLabel]);
                              }
                            }}
                            className={`w-full cursor-pointer rounded-md border px-2 py-1 text-left text-[11px] ${
                              isSelected
                                ? "border-sky-500 bg-sky-900/40"
                                : "border-slate-800 bg-slate-900 hover:bg-slate-800"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate font-medium">
                                {label}
                              </div>
                              <div className="text-[10px] uppercase text-slate-400">
                                {app.status}
                              </div>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              {app.payment_status && (
                                <div className="text-[10px] text-slate-400">
                                  Payment:{" "}
                                  <span className="capitalize">
                                    {app.payment_status}
                                  </span>
                                </div>
                              )}
                              {assignedLabel && (
                                <div className="text-[10px] text-emerald-300">
                                  Assigned: {assignedLabel}
                                </div>
                              )}
                              {isAssignedHere && (
                                <div className="text-[10px] text-emerald-300">
                                  (This booth)
                                </div>
                              )}
                            </div>
                            <div className="mt-1 flex justify-between gap-2">
                              <div className="text-[10px] text-slate-400">
                                {formatCents(app.total_paid_cents)} /{" "}
                                {formatCents(app.total_due_cents)}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewVendor(app.id);
                                }}
                                className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-50 hover:bg-slate-700"
                              >
                                View vendor
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={handleAssignToBooth}
                        disabled={
                          !primaryLabel || !selectedAppId || assigning
                        }
                        className="inline-flex items-center justify-center rounded-md bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-60"
                      >
                        {assigning
                          ? "Assigning…"
                          : selectedAppId
                          ? `Assign application #${selectedAppId} to booth ${primaryLabel}`
                          : "Select an application to assign"}
                      </button>
                      {assignError && (
                        <div className="text-[10px] text-rose-300">
                          {assignError}
                        </div>
                      )}
                      {assignSuccess && (
                        <div className="text-[10px] text-emerald-300">
                          {assignSuccess}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Basic booth bulk actions */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleDuplicateSelected}
                  className="flex-1 rounded-md bg-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-600"
                >
                  Duplicate booth
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-medium hover:bg-rose-500"
                >
                  Delete booth
                </button>
              </div>
            </div>
          )}

          {/* Multiple booths selected */}
          {selectionCount > 1 && (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">
                  Selection
                </div>
                <div className="text-sm font-medium">
                  {selectionCount} booths selected
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                  Set status for group
                </div>
                <div className="flex flex-wrap gap-1">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSetStatusForSelection(s)}
                      className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] capitalize hover:bg-slate-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-1 flex gap-2">
                <button
                  type="button"
                  onClick={handleDuplicateSelected}
                  className="flex-1 rounded-md bg-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-600"
                >
                  Duplicate selection
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-medium hover:bg-rose-500"
                >
                  Delete selection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Tip: Click to select, hold Shift or Ctrl to select multiple, drag to
        move the whole group, and drag the corner handle to resize all selected
        booths together.
      </p>

      {/* Vendor profile modal */}
      {vendorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-4 text-sm text-slate-900 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold">Vendor profile</h2>
              <button
                onClick={closeVendorModal}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            {vendorLoading && (
              <div className="py-4 text-xs text-slate-500">Loading…</div>
            )}

            {vendorError && (
              <div className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                {vendorError}
              </div>
            )}

            {selectedVendor && !vendorLoading && (
              <div className="space-y-1 text-xs">
                <div>
                  <span className="font-semibold">Business:</span>{" "}
                  {selectedVendor.business_name || "—"}
                </div>
                <div>
                  <span className="font-semibold">Contact:</span>{" "}
                  {selectedVendor.contact_name || "—"}
                </div>
                <div>
                  <span className="font-semibold">Email:</span>{" "}
                  {selectedVendor.email || "—"}
                </div>
                <div>
                  <span className="font-semibold">Phone:</span>{" "}
                  {selectedVendor.phone || "—"}
                </div>
                <div>
                  <span className="font-semibold">Location:</span>{" "}
                  {selectedVendor.city || "—"},{" "}
                  {selectedVendor.state || ""}
                </div>
                <div>
                  <span className="font-semibold">Website:</span>{" "}
                  {selectedVendor.website || "—"}
                </div>
                <div className="mt-2">
                  <span className="font-semibold">About:</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {selectedVendor.description || "No description provided."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function formatCents(cents?: number) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default DiagramEditor;
