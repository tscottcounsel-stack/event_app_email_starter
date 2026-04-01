import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

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
  status?: "draft" | "submitted" | "approved" | "rejected" | "expired";
  submittedAt?: string;
  documents?: Record<string, any>;
  docs?: Record<string, any>;
  paymentStatus?: string;
  boothPrice?: number;
  amountCents?: number;
};

type ServerApplication = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  requested_booth_id?: string | null;
  notes?: string | null;
  checked?: Record<string, boolean> | null;
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;
  status?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  payment_status?: string | null;
  booth_price?: number | null;
  amount_cents?: number | null;
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

function getStoredToken() {
  return (
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("accessToken") ||
    ""
  );
}

function getStoredEmail() {
  return localStorage.getItem("userEmail") || sessionStorage.getItem("userEmail") || "";
}

function getStoredRole() {
  return localStorage.getItem("userRole") || sessionStorage.getItem("userRole") || "";
}

function buildLocalAuthHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(extra || {}),
  };

  const token = getStoredToken();
  const email = getStoredEmail();
  const role = getStoredRole();

  if (token) headers.Authorization = `Bearer ${token}`;
  if (email) headers["x-user-email"] = email;
  if (role) headers["x-user-role"] = role;

  return headers;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function formatMoney(cents?: number, boothPrice?: number) {
  if (Number.isFinite(Number(cents)) && Number(cents) > 0) {
    return `$${(Number(cents) / 100).toFixed(2)}`;
  }
  if (Number.isFinite(Number(boothPrice)) && Number(boothPrice) > 0) {
    return `$${Number(boothPrice).toFixed(2)}`;
  }
  return "TBD";
}

function parseStatus(raw: any): "draft" | "submitted" | "approved" | "rejected" | "expired" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "submitted" || s === "approved" || s === "rejected" || s === "expired") {
    return s as any;
  }
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
    [];

  const documentsRaw =
    (parsed as any)?.documents ??
    (parsed as any)?.documentRequirements ??
    (parsed as any)?.document_requirements ??
    [];

  const compliance: RequirementItem[] = Array.isArray(complianceRaw)
    ? complianceRaw
        .map((c: any) => {
          const id = normalizeId(c?.id || c?.text || c?.label);
          const text = String(c?.text || c?.label || "").trim();
          if (!text) return null;
          return { id, text, required: !!c?.required } as RequirementItem;
        })
        .filter(Boolean) as RequirementItem[]
    : [];

  const documents: DocumentItem[] = Array.isArray(documentsRaw)
    ? documentsRaw
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
      if (norm.compliance.length > 0 || norm.documents.length > 0) {
        return { ...norm, source: "api", sourceKey: url };
      }
    } catch {
      // ignore
    }
  }

  const organizerKey = `organizer:event:${id}:requirements`;
  const organizerParsed = safeJsonParse(localStorage.getItem(organizerKey));
  const normOrg = normalizeRequirements(organizerParsed);
  if (normOrg.compliance.length > 0 || normOrg.documents.length > 0) {
    return { ...normOrg, source: "localStorage", sourceKey: organizerKey };
  }

  return null;
}

function readLocalProgress(eventId: string, appId?: string, boothId?: string): VendorApplyProgress | null {
  const eid = normalizeId(eventId);
  if (!eid) return null;

  const stable = safeJsonParse<VendorApplyProgress>(localStorage.getItem(makeProgressKeyStable(eid)));
  if (stable && normalizeId(stable.eventId) === eid) return stable;

  const composite = safeJsonParse<VendorApplyProgress>(
    localStorage.getItem(makeProgressKeyComposite(eid, appId, boothId))
  );
  if (composite && normalizeId(composite.eventId) === eid) return composite;

  const appOnly = safeJsonParse<VendorApplyProgress>(
    localStorage.getItem(makeProgressKeyComposite(eid, appId, undefined))
  );
  if (appOnly && normalizeId(appOnly.eventId) === eid) return appOnly;

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
    boothPrice: Number(a.booth_price || 0) || undefined,
    amountCents: Number(a.amount_cents || 0) || undefined,
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
      const paidScore = (x: VendorProgressCard) => (x.paymentStatus === "paid" ? 1 : 0);
      if (paidScore(b) !== paidScore(a)) {
        return paidScore(b) - paidScore(a);
      }

      const statusScore = (s: string) =>
        s === "approved" ? 4 : s === "submitted" ? 3 : s === "draft" ? 2 : s === "expired" ? 1 : 0;

      if (statusScore(b.status || "draft") !== statusScore(a.status || "draft")) {
        return statusScore(b.status || "draft") - statusScore(a.status || "draft");
      }

      const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });
    primary.push(list[0]);
  }

  primary.sort((a, b) => {
    const paidScore = (x: VendorProgressCard) => (x.paymentStatus === "paid" ? 1 : 0);
    if (paidScore(b) !== paidScore(a)) {
      return paidScore(b) - paidScore(a);
    }

    const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
    const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
    return tb - ta;
  });

  return primary;
}

function resolveNumericApplicationId(id: any): number | null {
  if (!id) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
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
      headers: buildLocalAuthHeaders({ "Content-Type": "application/json" }),
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

    const checkoutUrl = data?.checkout_url || data?.url || data?.checkoutUrl;
    if (typeof checkoutUrl === "string" && checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }

    alert((typeof data?.detail === "string" && data.detail) || "No checkout URL returned.");
  } catch (err: any) {
    console.error("pay-now error", err);
    alert(err?.message || "Unable to start payment.");
  }
}

/* ---------------- Page ---------------- */

export default function VendorApplicationsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const paymentHandledRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverAppsRaw, setServerAppsRaw] = useState<VendorProgressCard[]>([]);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

  const [reqByEventId, setReqByEventId] = useState<Record<string, LoadedRequirements | null>>({});
  const [localByKey, setLocalByKey] = useState<Record<string, VendorApplyProgress | null>>({});

  const loadApplications = useCallback(async () => {
    setServerError(null);

    const headers = buildLocalAuthHeaders();
    const hasIdentity = !!headers.Authorization || !!headers["x-user-email"];

    if (!hasIdentity) {
      setServerAppsRaw([]);
      setReqByEventId({});
      setLocalByKey({});
      setServerError("Missing login identity. Please log in again.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/vendor/applications`, {
        method: "GET",
        headers,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const detail =
          (typeof data?.detail === "string" && data.detail) ||
          `API ${res.status}: Failed to load server applications`;
        throw new Error(detail);
      }

      const rawApps = Array.isArray(data)
        ? data
        : Array.isArray(data?.applications)
        ? data.applications
        : [];

      const normalized = rawApps
        .map((a: any) => {
          try {
            return normalizeServerToCard(a as ServerApplication);
          } catch (e) {
            console.error("Bad app record:", a, e);
            return null;
          }
        })
        .filter(Boolean) as VendorProgressCard[];

      setServerAppsRaw(normalized);

      const uniqueEventIds = Array.from(
        new Set(normalized.map((a) => normalizeId(a.eventId)).filter(Boolean))
      );

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
    } catch (e: any) {
      console.error("loadApplications error", e);
      setServerError(e?.message || "Failed to load applications from server.");
      setServerAppsRaw([]);
      setReqByEventId({});
      setLocalByKey({});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        if (!cancelled) {
          await loadApplications();
        }
      } catch (e) {
        console.error("initial load effect error", e);
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

    const params = new URLSearchParams(location.search);
    const payment = String(params.get("payment") || "").trim().toLowerCase();

    if (payment !== "success") return;
    paymentHandledRef.current = true;

    (async () => {
      try {
        setPaymentMessage("Payment successful. Updating status...");
        window.setTimeout(async () => {
          await loadApplications();
          setPaymentMessage(null);
        }, 1200);

        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("payment");
        cleanUrl.searchParams.delete("appId");
        cleanUrl.searchParams.delete("app_id");
        cleanUrl.searchParams.delete("session_id");
        window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      } catch (e: any) {
        console.error("payment refresh error", e);
        setPaymentMessage(e?.message || "Payment completed. Refresh the page if status does not update.");
      }
    })();
  }, [loadApplications, location.search]);

  const cards = useMemo(() => {
    try {
      if (!Array.isArray(serverAppsRaw)) return [];
      return pickPrimaryPerEvent(serverAppsRaw);
    } catch (e) {
      console.error("Card processing crash:", e);
      return [];
    }
  }, [serverAppsRaw]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Applications</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              One card per event. Approved applications can pay after organizer approval.
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
                If payment already completed, refresh after logging back in. Paid status is updated by the Stripe webhook.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Loaded server applications: <span className="font-black">{serverAppsRaw.length}</span>{" "}
              <span className="ml-2 text-emerald-800/80">(showing {cards.length} event cards)</span>
            </div>
          )}
        </div>

        {!loading && !serverError && cards.length === 0 ? (
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
        ) : null}

        {cards.length > 0 ? (
          <div className="mt-10 grid gap-4">
            {cards.map((it) => {
              const eid = normalizeId(it.eventId);
              const req = reqByEventId[eid] ?? null;

              const localKey = `${normalizeId(it.eventId)}:${normalizeId(it.appId)}:${normalizeId(it.boothId || "")}`;
              const local = localByKey[localKey] ?? null;

              const effectiveChecked = local?.checked ?? it.checked ?? {};
              const serverDocs =
                it.documents && typeof it.documents === "object"
                  ? it.documents
                  : it.docs && typeof it.docs === "object"
                  ? it.docs
                  : {};

              const effectiveDocs =
                (local?.docs as Record<string, UploadedDocMeta | null> | undefined) ?? serverDocs;
              const effectiveNotes = (local?.notes ?? it.notes ?? "").trim();

              const { done, total, pct } = calcCompletion(
                effectiveChecked,
                effectiveDocs as Record<string, UploadedDocMeta | null>,
                req
              );

              const status = it.status || "draft";
              const resolvedApplicationId = String(it.applicationId || "").trim();
              const viewUrl = `/vendor/events/${encodeURIComponent(
                it.eventId
              )}/requirements?appId=${encodeURIComponent(resolvedApplicationId)}`;

              const showPayButton = status === "approved" && it.paymentStatus !== "paid";

              return (
                <div
                  key={`${it.eventId}:${it.appId}`}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-xl font-black text-slate-900">
                        Event #{it.eventId}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        Last updated: {formatDate(local?.updatedAt || it.updatedAt)}
                        {it.submittedAt ? (
                          <span className="ml-2">• Submitted: {formatDate(it.submittedAt)}</span>
                        ) : null}
                        <span className="ml-2">• Amount: {formatMoney(it.amountCents, it.boothPrice)}</span>
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
                            : status === "expired"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-700")
                        }
                      >
                        {status === "approved"
                          ? "Approved"
                          : status === "rejected"
                          ? "Rejected"
                          : status === "submitted"
                          ? "Submitted"
                          : status === "expired"
                          ? "Expired"
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
                        {it.paymentStatus === "paid" ? "Paid" : "Unpaid"}
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

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-600">
                    <span>
                      Booth: <span className="font-black text-slate-900">{it.boothId || "Not selected"}</span>
                    </span>
                    <span>
                      App ID: <span className="font-mono text-slate-900">{it.appId}</span>
                    </span>
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
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Notes
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">{effectiveNotes}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
