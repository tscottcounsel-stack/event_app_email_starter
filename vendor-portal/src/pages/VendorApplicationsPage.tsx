// src/pages/VendorApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type UploadedDocMeta = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
  dataUrl?: string;
};

type VendorApplyProgress = {
  version: 1;
  eventId: string;
  applicationId?: number; // numeric server id (preferred)
  appId?: string; // string version of numeric id
  boothId?: string;
  checked: Record<string, boolean>;
  docs: Record<string, UploadedDocMeta | null>;
  notes?: string;
  agreed?: boolean;
  updatedAt: string;
};

type VendorProgressCard = {
  eventId: string;
  appId: string; // numeric id as string
  applicationId: number; // numeric id
  boothId?: string;
  checked: Record<string, boolean>;
  notes?: string;
  updatedAt: string;
  status?: "draft" | "submitted" | "approved" | "rejected";
  submittedAt?: string;
};

type ServerApplication = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  app_ref?: string | null;

  notes?: string | null;
  checked?: Record<string, boolean> | null;

  // IMPORTANT: backend may store docs under either key; this page only counts local docs,
  // but keep these for future display/debug.
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;

  status?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;

  vendor_email?: string | null;
  vendor_id?: string | null;
};

type RequirementItem = { id: string; text: string; required?: boolean };
type DocumentItem = { id: string; name: string; required?: boolean; dueBy?: string };

type LoadedRequirements = {
  compliance: RequirementItem[];
  documents: DocumentItem[];
  source: "api" | "localStorage";
  sourceKey?: string;
};

/* ---------------- localStorage keys ---------------- */

// canonical progress storage for Apply page (event-only)
const LS_VENDOR_APPLY_PROGRESS_PREFIX = "vendor_apply_progress_v1";
function makeProgressKeyStable(eventId: string) {
  return `${LS_VENDOR_APPLY_PROGRESS_PREFIX}:event:${eventId}`;
}

// legacy composite key support (older versions)
function makeProgressKeyComposite(eventId: string, appId?: string, boothId?: string) {
  const a = appId ? `app:${appId}` : "app:-";
  const b = boothId ? `booth:${boothId}` : "booth:-";
  return `${LS_VENDOR_APPLY_PROGRESS_PREFIX}:event:${eventId}:${a}:${b}`;
}

/* ---------------- Utils ---------------- */

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function parseStatus(raw: any): "draft" | "submitted" | "approved" | "rejected" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "submitted" || s === "approved" || s === "rejected") return s as any;
  return "draft";
}

function normalizeRequirements(raw: any): { compliance: RequirementItem[]; documents: DocumentItem[] } {
  if (!raw || typeof raw !== "object") return { compliance: [], documents: [] };
  const parsed = (raw as any)?.requirements ?? raw;

  const complianceRaw =
    (parsed as any)?.compliance ??
    (parsed as any)?.complianceItems ??
    (parsed as any)?.compliance_items ??
    (parsed as any)?.compliance_items_list ??
    [];

  const documentsRaw =
    (parsed as any)?.documents ??
    (parsed as any)?.documentRequirements ??
    (parsed as any)?.document_requirements ??
    (parsed as any)?.document_requirements_list ??
    [];

  const compliance: RequirementItem[] = Array.isArray(complianceRaw)
    ? (complianceRaw as any[])
        .map((c: any) => {
          const id = normalizeId(c?.id || c?.text || c?.label);
          const text = String(c?.text || c?.label || "").trim();
          if (!text) return null;
          return { id, text, required: !!c?.required } as RequirementItem;
        })
        .filter(Boolean) as RequirementItem[]
    : [];

  const documents: DocumentItem[] = Array.isArray(documentsRaw)
    ? (documentsRaw as any[])
        .map((d: any) => {
          const id = normalizeId(d?.id || d?.name);
          const name = String(d?.name || "").trim();
          if (!name) return null;
          const dueBy = d?.dueBy ? String(d.dueBy) : d?.due_by ? String(d.due_by) : undefined;
          return { id, name, required: !!d?.required, dueBy } as DocumentItem;
        })
        .filter(Boolean) as DocumentItem[]
    : [];

  return { compliance, documents };
}

async function loadRequirementsForEvent(eventId: string): Promise<LoadedRequirements | null> {
  const id = normalizeId(eventId);
  if (!id) return null;

  // Prefer the public endpoint first (vendor flow)
  const candidates = [
    `${API_BASE}/events/${encodeURIComponent(id)}/requirements`,
    `${API_BASE}/organizer/events/${encodeURIComponent(id)}/requirements`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const norm = normalizeRequirements(data);
      if ((norm.compliance?.length || 0) > 0 || (norm.documents?.length || 0) > 0) {
        return { compliance: norm.compliance, documents: norm.documents, source: "api", sourceKey: url };
      }
    } catch {
      // try next
    }
  }

  // localStorage fallback (dev)
  const organizerKey = `organizer:event:${id}:requirements`;
  const organizerParsed = safeJsonParse(localStorage.getItem(organizerKey));
  const normOrg = normalizeRequirements(organizerParsed);
  if ((normOrg.compliance?.length || 0) > 0 || (normOrg.documents?.length || 0) > 0) {
    return { compliance: normOrg.compliance, documents: normOrg.documents, source: "localStorage", sourceKey: organizerKey };
  }

  return null;
}

function readLocalProgress(eventId: string, appId?: string, boothId?: string): VendorApplyProgress | null {
  const eid = normalizeId(eventId);
  if (!eid) return null;

  // Try stable first (new canonical)
  const k1 = makeProgressKeyStable(eid);
  const p1 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k1));
  if (p1 && normalizeId(p1.eventId) === eid) return p1;

  // Try legacy composite next
  const k2 = makeProgressKeyComposite(eid, appId, boothId);
  const p2 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k2));
  if (p2 && normalizeId(p2.eventId) === eid) return p2;

  // As last effort: composite without booth
  const k3 = makeProgressKeyComposite(eid, appId, undefined);
  const p3 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k3));
  if (p3 && normalizeId(p3.eventId) === eid) return p3;

  return null;
}

/**
 * Completion logic:
 * - Use requirements totals (compliance + documents).
 * - Count required items; if none are marked required, treat all as required.
 */
function calcCompletion(
  checked: Record<string, boolean>,
  docs: Record<string, UploadedDocMeta | null>,
  req?: LoadedRequirements | null
) {
  const compliance = req?.compliance || [];
  const documents = req?.documents || [];

  const reqComplianceOnly = compliance.filter((c) => !!c.required);
  const reqCompliance = reqComplianceOnly.length > 0 ? reqComplianceOnly : compliance;

  const reqDocsOnly = documents.filter((d) => !!d.required);
  const reqDocs = reqDocsOnly.length > 0 ? reqDocsOnly : documents;

  const compTotal = reqCompliance.length;
  const docsTotal = reqDocs.length;

  const compDone = reqCompliance.reduce(
    (acc, c) => acc + (checked[normalizeId((c as any).id || c.text)] ? 1 : 0),
    0
  );
  const docsDone = reqDocs.reduce(
    (acc, d) => acc + (docs[normalizeId((d as any).id || d.name)] ? 1 : 0),
    0
  );

  const done = compDone + docsDone;
  const total = compTotal + docsTotal;

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

function normalizeServerToCard(a: ServerApplication): VendorProgressCard {
  const applicationId = Number(a.id);
  const appId = String(a.id);

  return {
    eventId: String(a.event_id),
    appId,
    applicationId,
    boothId: a.booth_id ? String(a.booth_id) : undefined,
    checked: a.checked && typeof a.checked === "object" ? a.checked : {},
    notes: String(a.notes ?? "").trim(),
    updatedAt: String(a.updated_at || a.submitted_at || new Date().toISOString()),
    status: parseStatus(a.status),
    submittedAt: a.submitted_at ? String(a.submitted_at) : undefined,
  };
}

/**
 * Dedup logic:
 * - Show ONE card per event (prevents “Event #4” from repeating forever).
 * - Pick the "best" app for that event:
 *   1) latest by submitted_at/updated_at
 *   2) if tie, prefer non-draft (submitted/approved/rejected) over draft
 */
function pickPrimaryPerEvent(apps: VendorProgressCard[]) {
  const byEvent: Record<string, VendorProgressCard[]> = {};
  for (const a of apps) {
    const eid = normalizeId(a.eventId);
    if (!eid) continue;
    byEvent[eid] = byEvent[eid] || [];
    byEvent[eid].push(a);
  }

  const primary: VendorProgressCard[] = [];
  for (const eid of Object.keys(byEvent)) {
    const list = byEvent[eid].slice();
    list.sort((a, b) => {
      const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      if (tb !== ta) return tb - ta;

      const sa = a.status || "draft";
      const sb = b.status || "draft";
      const score = (s: string) => (s === "draft" ? 0 : 1);
      return score(sb) - score(sa);
    });
    primary.push(list[0]);
  }

  // order events by most recent primary activity
  primary.sort((a, b) => {
    const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
    const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
    return tb - ta;
  });

  return primary;
}

/* ---------------- Page ---------------- */

export default function VendorApplicationsPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverAppsRaw, setServerAppsRaw] = useState<VendorProgressCard[]>([]);

  const [reqByEventId, setReqByEventId] = useState<Record<string, LoadedRequirements | null>>({});
  const [localByKey, setLocalByKey] = useState<Record<string, VendorApplyProgress | null>>({});

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setServerError(null);

      try {
        const headers = buildAuthHeaders();

        const hasIdentity =
          !!(headers as any).Authorization ||
          !!(headers as any)["x-user-email"] ||
          !!(headers as any)["x-user-id"];

        if (!hasIdentity) {
          throw new Error(
            "Missing login identity headers (Authorization / x-user-email / x-user-id). Log in again so applications can load."
          );
        }

        const res = await fetch(`${API_BASE}/vendor/applications`, {
          method: "GET",
          headers,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${text || "Failed to load server applications"}`);
        }

        const data = (await res.json().catch(() => null)) as { applications?: ServerApplication[] } | null;
        const apps = Array.isArray(data?.applications) ? data!.applications : [];
        const normalized = apps.map(normalizeServerToCard);

        if (cancelled) return;

        setServerAppsRaw(normalized);

        // Requirements per event (unique event ids)
        const uniqueEventIds = Array.from(new Set(normalized.map((a) => normalizeId(a.eventId)).filter(Boolean)));
        const nextReq: Record<string, LoadedRequirements | null> = {};

        await Promise.all(
          uniqueEventIds.map(async (eid) => {
            try {
              nextReq[eid] = await loadRequirementsForEvent(eid);
            } catch {
              nextReq[eid] = null;
            }
          })
        );

        // Local progress per card (supports stable+legacy keys)
        const nextLocal: Record<string, VendorApplyProgress | null> = {};
        for (const a of normalized) {
          const key = `${normalizeId(a.eventId)}:${normalizeId(a.appId)}:${normalizeId(a.boothId || "")}`;
          nextLocal[key] = readLocalProgress(a.eventId, a.appId, a.boothId);
        }

        if (!cancelled) {
          setReqByEventId(nextReq);
          setLocalByKey(nextLocal);
        }
      } catch (e: any) {
        if (!cancelled) {
          setServerError(e?.message || "Failed to load applications from server.");
          setServerAppsRaw([]);
          setReqByEventId({});
          setLocalByKey({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ DEDUP: one card per event (prevents endless Event #4 repeats)
  const cards = useMemo(() => pickPrimaryPerEvent(serverAppsRaw), [serverAppsRaw]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Applications</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              One card per event (most recent application). Draft progress shown from your browser.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => nav("/vendor/events")}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
              type="button"
            >
              Browse Events
            </button>
          </div>
        </div>

        {/* Server status */}
        <div className="mt-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">
              Loading applications…
            </div>
          ) : serverError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              <div className="font-black">Server applications unavailable</div>
              <div className="mt-1 opacity-90">{serverError}</div>
              <div className="mt-2 text-xs font-bold text-amber-800">
                If this is unexpected, confirm you are logged in and that the request includes identity headers.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Loaded server applications: <span className="font-black">{serverAppsRaw.length}</span>{" "}
              <span className="ml-2 text-emerald-800/80">(showing {cards.length} event cards)</span>
            </div>
          )}
        </div>

        {cards.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-xl font-black text-slate-900">No applications yet</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              When you submit an application, it will show up here.
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => nav("/vendor/events")}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
                type="button"
              >
                Find Events
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid gap-4">
            {cards.map((it) => {
              const eid = normalizeId(it.eventId);
              const req = reqByEventId[eid] ?? null;

              const localKey = `${normalizeId(it.eventId)}:${normalizeId(it.appId)}:${normalizeId(it.boothId || "")}`;
              const local = localByKey[localKey] ?? null;

              const effectiveChecked = local?.checked ?? it.checked ?? {};
              const effectiveDocs = local?.docs ?? {};
              const effectiveNotes = (local?.notes ?? it.notes ?? "").trim();

              const { done, total, pct } = calcCompletion(effectiveChecked, effectiveDocs, req);

              const status = it.status || "draft";

              /**
               * ✅ IMPORTANT:
               * View should NOT go through an "apply" route that might create a new draft.
               * Route directly to the Vendor Requirements page with the existing applicationId.
               *
               * Your app supports the legacy typo key "appld"; we will still write the correct one.
               */
              const viewUrl =
                `/vendor/events/${encodeURIComponent(it.eventId)}?` +
                new URLSearchParams({
                  appId: String(it.applicationId),
                  ...(it.boothId ? { boothId: it.boothId } : {}),
                }).toString();

              const reqSource =
                req?.source === "api" ? "reqs: api" : req?.source === "localStorage" ? "reqs: localStorage" : "reqs: —";

              const progressSource = local ? "progress: local" : "progress: server";

              return (
                <div key={`${it.eventId}:${it.appId}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="text-lg font-black text-slate-900">
                        Event #{it.eventId}
                        {it.boothId ? (
                          <span className="ml-2 text-sm font-extrabold text-slate-500">• Booth {it.boothId}</span>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        Last updated: {formatDate(local?.updatedAt || it.updatedAt)}
                        {it.submittedAt ? <span className="ml-2">• Submitted: {formatDate(it.submittedAt)}</span> : null}
                        <span className="ml-2">• {reqSource}</span>
                        <span className="ml-2">• {progressSource}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={
                          "rounded-full px-3 py-1 text-xs font-extrabold " +
                          (status === "approved"
                            ? "bg-emerald-50 text-emerald-700"
                            : status === "rejected"
                            ? "bg-rose-50 text-rose-700"
                            : status === "submitted"
                            ? "bg-indigo-50 text-indigo-700"
                            : "bg-slate-100 text-slate-700")
                        }
                      >
                        {status === "approved"
                          ? "Approved"
                          : status === "rejected"
                          ? "Rejected"
                          : status === "submitted"
                          ? "Submitted"
                          : "Draft"}
                      </span>

                      <div className="text-sm font-extrabold text-slate-700">
                        {pct}% <span className="font-semibold text-slate-500">({done}/{total})</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-slate-900" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      to={viewUrl}
                      className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-indigo-700"
                    >
                      View
                    </Link>

                    <Link
                      to={`/vendor/events/${encodeURIComponent(it.eventId)}`}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                    >
                      View Event
                    </Link>
                  </div>

                  {effectiveNotes ? (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Notes</div>
                      <div className="mt-1 whitespace-pre-wrap">{effectiveNotes}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
