// src/pages/VendorApplicationsPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

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
  applicationId?: number;
  appId?: string;
  boothId?: string;
  checked: Record<string, boolean>;
  docs: Record<string, UploadedDocMeta | null>;
  notes?: string;
  agreed?: boolean;
  updatedAt: string;
};

type VendorProgressCard = {
  eventId: string;
  appId: string;
  applicationId: number;
  boothId?: string;
  checked: Record<string, boolean>;
  notes?: string;
  updatedAt: string;
  status?: "draft" | "submitted" | "approved" | "rejected";
  submittedAt?: string;
  documents?: Record<string, any>;
  docs?: Record<string, any>;
  paymentStatus?: string;
};

type ServerApplication = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  requested_booth_id?: string | null;
  app_ref?: string | null;
  notes?: string | null;
  checked?: Record<string, boolean> | null;
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;
  status?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  vendor_email?: string | null;
  vendor_id?: string | null;
  payment_status?: string | null;
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

const LS_VENDOR_APPLY_PROGRESS_PREFIX = "vendor_apply_progress_v1";
function makeProgressKeyStable(eventId: string) {
  return `${LS_VENDOR_APPLY_PROGRESS_PREFIX}:event:${eventId}`;
}

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

function normalizePaymentStatus(raw: any): string {
  const s = String(raw ?? "").trim().toLowerCase();
  return s || "unpaid";
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

  const organizerKey = `organizer:event:${id}:requirements`;
  const organizerParsed = safeJsonParse(localStorage.getItem(organizerKey));
  const normOrg = normalizeRequirements(organizerParsed);
  if ((normOrg.compliance?.length || 0) > 0 || (normOrg.documents?.length || 0) > 0) {
    return {
      compliance: normOrg.compliance,
      documents: normOrg.documents,
      source: "localStorage",
      sourceKey: organizerKey,
    };
  }

  return null;
}

function readLocalProgress(eventId: string, appId?: string, boothId?: string): VendorApplyProgress | null {
  const eid = normalizeId(eventId);
  if (!eid) return null;

  const k1 = makeProgressKeyStable(eid);
  const p1 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k1));
  if (p1 && normalizeId(p1.eventId) === eid) return p1;

  const k2 = makeProgressKeyComposite(eid, appId, boothId);
  const p2 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k2));
  if (p2 && normalizeId(p2.eventId) === eid) return p2;

  const k3 = makeProgressKeyComposite(eid, appId, undefined);
  const p3 = safeJsonParse<VendorApplyProgress>(localStorage.getItem(k3));
  if (p3 && normalizeId(p3.eventId) === eid) return p3;

  return null;
}

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

  const assignedBoothId = a.booth_id ? String(a.booth_id).trim() : "";
  const requestedBoothId = a.requested_booth_id ? String(a.requested_booth_id).trim() : "";

  return {
    eventId: String(a.event_id),
    appId,
    applicationId,
    boothId: assignedBoothId || requestedBoothId || undefined,
    checked: a.checked && typeof a.checked === "object" ? a.checked : {},
    notes: String(a.notes ?? "").trim(),
    updatedAt: String(a.updated_at || a.submitted_at || new Date().toISOString()),
    status: parseStatus(a.status),
    submittedAt: a.submitted_at ? String(a.submitted_at) : undefined,
    documents: a.documents && typeof a.documents === "object" ? a.documents : {},
    docs: a.docs && typeof a.docs === "object" ? a.docs : {},
    paymentStatus: normalizePaymentStatus(a.payment_status),
  };
}

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

  primary.sort((a, b) => {
    const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
    const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
    return tb - ta;
  });

  return primary;
}

function resolveNumericApplicationId(value: any): string {
  const candidates = [value?.id, value?.application?.id, value?.applicationId, value?.appId, value];

  for (const candidate of candidates) {
    const s = String(candidate ?? "").trim();
    if (!s) continue;
    if (s === "[object Object]" || s === "undefined" || s === "null") continue;
    if (/^\d+$/.test(s)) return s;
  }

  return "";
}

async function handlePayNow(app: VendorProgressCard) {
  const appId = resolveNumericApplicationId(app.applicationId ?? app.appId);

  if (!appId) {
    alert("Missing application ID. Refresh the page and try again.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/vendor/applications/${appId}/pay-now`, {
      method: "POST",
      headers: {
        ...buildAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const detail =
        (typeof data?.detail === "string" && data.detail) ||
        (typeof data?.message === "string" && data.message) ||
        `Unable to start payment (${res.status}).`;
      alert(detail);
      return;
    }

    if (typeof data?.url === "string" && data.url) {
      window.location.href = data.url;
      return;
    }

    alert((typeof data?.detail === "string" && data.detail) || "Unable to start payment.");
  } catch (err: any) {
    alert(err?.message || "Unable to start payment.");
  }
}

/* ---------------- Page ---------------- */

export default function VendorApplicationsPage() {
  const nav = useNavigate();
  const paymentHandledRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverAppsRaw, setServerAppsRaw] = useState<VendorProgressCard[]>([]);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

  const [reqByEventId, setReqByEventId] = useState<Record<string, LoadedRequirements | null>>({});
  const [localByKey, setLocalByKey] = useState<Record<string, VendorApplyProgress | null>>({});

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setServerError(null);

    const headers = buildAuthHeaders();

    const hasIdentity =
      !!(headers as any).Authorization ||
      !!(headers as any)["x-user-email"] ||
      !!(headers as any)["x-user-id"];

    if (!hasIdentity) {
      console.warn("Auth not ready, retrying applications load...");
      setTimeout(() => {
        loadApplications().catch(() => {});
      }, 500);
      setLoading(false);
      return;
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

    setServerAppsRaw(normalized);

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

    const nextLocal: Record<string, VendorApplyProgress | null> = {};
    for (const a of normalized) {
      const key = `${normalizeId(a.eventId)}:${normalizeId(a.appId)}:${normalizeId(a.boothId || "")}`;
      nextLocal[key] = readLocalProgress(a.eventId, a.appId, a.boothId);
    }

    setReqByEventId(nextReq);
    setLocalByKey(nextLocal);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadApplications();
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
    })();

    return () => {
      cancelled = true;
    };
  }, [loadApplications]);

  useEffect(() => {
    if (paymentHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const payment = String(params.get("payment") || "").trim().toLowerCase();

    if (payment !== "success") return;

    paymentHandledRef.current = true;

    (async () => {
      try {
        setPaymentMessage(null);

        const appId =
          resolveNumericApplicationId(params.get("appId")) ||
          resolveNumericApplicationId(params.get("application_id"));
        const sessionId = String(params.get("session_id") || "").trim();

        if (appId) {
          const res = await fetch(`${API_BASE}/vendor/applications/${appId}/confirm-payment`, {
            method: "POST",
            headers: {
              ...buildAuthHeaders(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ session_id: sessionId || undefined }),
          });

          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(
              (typeof data?.detail === "string" && data.detail) ||
                (typeof data?.message === "string" && data.message) ||
                `Unable to confirm payment (${res.status}).`
            );
          }
        }

        await loadApplications();
        setPaymentMessage("Payment confirmed.");

        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("payment");
        cleanUrl.searchParams.delete("appId");
        cleanUrl.searchParams.delete("application_id");
        cleanUrl.searchParams.delete("session_id");
        window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      } catch (e: any) {
        setPaymentMessage(e?.message || "Payment confirmation could not be verified.");
        try {
          await loadApplications();
        } catch {
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [loadApplications]);

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

        {paymentMessage ? (
          <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-900">
            {paymentMessage}
          </div>
        ) : null}

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

              const effectiveChecked = it.checked ?? local?.checked ?? {};

              const serverDocs =
                it.documents && typeof it.documents === "object"
                  ? it.documents
                  : it.docs && typeof it.docs === "object"
                  ? it.docs
                  : {};

              const effectiveDocs = serverDocs ?? local?.docs ?? {};
              const effectiveNotes = (local?.notes ?? it.notes ?? "").trim();

              const { done, total, pct } = calcCompletion(effectiveChecked, effectiveDocs, req);
              const status = it.status || "draft";

              const resolvedApplicationId = resolveNumericApplicationId(it.applicationId ?? it.appId);
              const params = new URLSearchParams();
              if (resolvedApplicationId) params.set("appId", resolvedApplicationId);
              if (it.boothId) params.set("boothId", it.boothId);

              const viewUrl = `/vendor/events/${encodeURIComponent(it.eventId)}/requirements?${params.toString()}`;

              const reqSource =
                req?.source === "api" ? "reqs: api" : req?.source === "localStorage" ? "reqs: localStorage" : "reqs: —";

              const progressSource = local ? "progress: local" : "progress: server";
              const isPaidNow =
                it.paymentStatus === "paid" ||
                (paymentMessage === "Payment confirmed." &&
                  resolvedApplicationId === resolveNumericApplicationId(it.applicationId ?? it.appId));

              const showPayButton = status === "approved" && !isPaidNow;

              return (
                <div key={`${it.eventId}:${it.appId}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="text-lg font-black text-slate-900">
                        Event #{it.eventId}
                        {it.boothId ? (
                          <span className="ml-2 text-sm font-extrabold text-slate-500">• Requested Booth {it.boothId}</span>
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

                      <span
                        className={
                          "rounded-full px-3 py-1 text-xs font-extrabold " +
                          (it.paymentStatus === "paid"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700")
                        }
                      >
                        {isPaidNow ? "Paid" : "Unpaid"}
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

                    {showPayButton ? (
                      <button
                        onClick={() => handlePayNow(it)}
                        className="rounded-full bg-green-600 px-5 py-2 text-sm font-extrabold text-white shadow-md hover:bg-green-700"
                        type="button"
                      >
                        Pay Booth Fee
                      </button>
                    ) : null}
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






