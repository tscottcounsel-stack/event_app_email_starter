// src/pages/OrganizerApplicationsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

type ApplicationStatus = "draft" | "submitted" | "approved" | "rejected" | "unknown";

type UploadedDocMeta = {
  doc_id?: string;
  original_name?: string;
  filename?: string;
  size?: number;
  content_type?: string;
  url?: string; // /uploads/...
  uploaded_at?: string;
  uploadedAt?: string; // tolerate camelCase
  [k: string]: any;
};

type ApplicationRow = {
  id: number;
  event_id: number;

  status: string;
  vendor_email?: string | null;
  vendor_id?: string | null;

  booth_id?: string | null;
  app_ref?: string | null;

  notes?: string | null;

  checked?: Record<string, boolean> | null;
  documents?: Record<string, UploadedDocMeta> | null;

  submitted_at?: string | null;
  updated_at?: string | null;

  payment_status?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
};

type RequirementItem = { id: string; label: string; required?: boolean; description?: string };
type DocumentRequirement = { id: string; name: string; required?: boolean; dueBy?: string };

type RequirementsPayload = {
  version?: number;
  requirements?: {
    requirement_fields?: RequirementItem[];
    compliance_items?: { id: string; text: string; required?: boolean }[];
    document_requirements?: DocumentRequirement[];
  };
};

type LoadedRequirements = {
  eventId: number;
  raw: any;
  compliance: { id: string; text: string; required: boolean }[];
  docs: DocumentRequirement[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function parseStatus(raw: any): ApplicationStatus {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "draft") return "draft";
  if (s === "submitted") return "submitted";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "unknown";
}

function niceStatus(s: ApplicationStatus) {
  if (s === "draft") return "Draft";
  if (s === "submitted") return "Submitted";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return "Unknown";
}

function normalizeRequirements(eventId: number, payload: RequirementsPayload | any): LoadedRequirements {
  const root: RequirementsPayload = payload?.requirements ? payload : { requirements: payload };
  const complianceRaw = root?.requirements?.compliance_items ?? [];
  const docsRaw = root?.requirements?.document_requirements ?? [];

  const compliance = Array.isArray(complianceRaw)
    ? complianceRaw
        .map((c: any, i: number) => ({
          id: String(c?.id || `c-${i + 1}`),
          text: String(c?.text ?? c?.label ?? "").trim(),
          required: Boolean(c?.required ?? true),
        }))
        .filter((x: any) => x.text.length > 0)
    : [];

  const docs = Array.isArray(docsRaw)
    ? docsRaw
        .map((d: any, i: number) => ({
          id: String(d?.id || `d-${i + 1}`),
          name: String(d?.name ?? "").trim(),
          required: Boolean(d?.required ?? true),
          dueBy: d?.dueBy ? String(d.dueBy) : undefined,
        }))
        .filter((x: any) => x.name.length > 0)
    : [];

  return { eventId, raw: payload, compliance, docs };
}

export default function OrganizerApplicationsPage() {
  const nav = useNavigate();
  const params = useParams();
  const eventId = Number(params.eventId || params.id || 0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [busyGlobal, setBusyGlobal] = useState(false);

  const [apps, setApps] = useState<ApplicationRow[]>([]);

  const [reqsLoading, setReqsLoading] = useState(false);
  const [reqs, setReqs] = useState<LoadedRequirements | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "approved" | "rejected" | "draft">("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "status">("newest");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const authHeaders = useCallback(() => {
    // Dev store is header-based; keep minimal. If you add organizer auth later, wire it here.
    return {
      "Content-Type": "application/json",
    };
  }, []);

  const loadApps = useCallback(async () => {
    if (!eventId) return;

    setLoading(true);
    setError(null);

    try {
      const url = `${API_BASE}/organizer/events/${eventId}/applications`;
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = (data?.detail && typeof data.detail === "string") ? data.detail : `Failed to load applications (${res.status})`;
        throw new Error(msg);
      }

      const list = Array.isArray(data?.applications) ? (data.applications as ApplicationRow[]) : [];
      setApps(list);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [eventId, authHeaders]);

  const loadReqs = useCallback(async () => {
    if (!eventId) return;

    setReqsLoading(true);
    try {
      const url = `${API_BASE}/events/${eventId}/requirements`;
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setReqs(normalizeRequirements(eventId, data));
      }
    } catch {
      // ignore
    } finally {
      setReqsLoading(false);
    }
  }, [eventId, authHeaders]);

  useEffect(() => {
    loadApps();
    loadReqs();
  }, [loadApps, loadReqs]);

  const counts = useMemo(() => {
    const c = { all: 0, draft: 0, submitted: 0, approved: 0, rejected: 0, unknown: 0 };
    c.all = apps.length;
    for (const a of apps) {
      const s = parseStatus(a.status);
      if (s === "draft") c.draft += 1;
      else if (s === "submitted") c.submitted += 1;
      else if (s === "approved") c.approved += 1;
      else if (s === "rejected") c.rejected += 1;
      else c.unknown += 1;
    }
    return c;
  }, [apps]);

  const filtered = useMemo(() => {
    let out = apps.slice();

    if (statusFilter !== "all") {
      out = out.filter((a) => parseStatus(a.status) === statusFilter);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((a) => {
        const hay = [
          a.id,
          a.vendor_email,
          a.vendor_id,
          a.booth_id,
          a.app_ref,
          a.status,
        ]
          .map((x) => String(x ?? "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
    }

    if (sortBy === "newest") {
      out.sort((a, b) => String(b.submitted_at || b.updated_at || "").localeCompare(String(a.submitted_at || a.updated_at || "")));
    } else if (sortBy === "oldest") {
      out.sort((a, b) => String(a.submitted_at || a.updated_at || "").localeCompare(String(b.submitted_at || b.updated_at || "")));
    } else {
      out.sort((a, b) => parseStatus(a.status).localeCompare(parseStatus(b.status)));
    }

    return out;
  }, [apps, statusFilter, query, sortBy]);

  const updateStatus = useCallback(
    async (applicationId: number, status: "approved" | "rejected") => {
      setError(null);
      setUpdatingId(applicationId);

      const url = `${API_BASE}/organizer/applications/${applicationId}/status`;
      const body = JSON.stringify({ status });

      async function send(method: "POST" | "PUT") {
        return fetch(url, { method, headers: authHeaders(), body });
      }

      try {
        let res = await send("POST");
        if (res.status === 405) res = await send("PUT"); // tolerate older servers

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof data?.detail === "string"
              ? data.detail
              : `Failed to update status (${res.status})`;
          throw new Error(msg);
        }

        const updated = (data?.application ?? data) as ApplicationRow;
        setApps((prev) => prev.map((x) => (x.id === applicationId ? { ...x, ...updated } : x)));
      } catch (e: any) {
        setError(String(e?.message || e || "Update failed"));
      } finally {
        setUpdatingId(null);
      }
    },
    [authHeaders]
  );

  const tabs = [
    { key: "all" as const, label: `All (${counts.all})` },
    { key: "submitted" as const, label: `Submitted (${counts.submitted})` },
    { key: "approved" as const, label: `Approved (${counts.approved})` },
    { key: "rejected" as const, label: `Rejected (${counts.rejected})` },
    { key: "draft" as const, label: `Draft (${counts.draft})` },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-extrabold">Applications</div>
            <div className="mt-1 text-sm text-slate-600">
              Event <span className="font-mono">#{eventId || "?"}</span>
            </div>
          </div>

          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
            onClick={() => nav(-1)}
          >
            Back
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {tabs.map(({ key, label }) => (
                <button
                  key={key}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-semibold",
                    statusFilter === key ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                  ].join(" ")}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 sm:w-72"
                placeholder="Search by vendor / booth / app ref / id"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              <select
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="status">Status</option>
              </select>

              <button
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
                onClick={loadApps}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              Loading applications…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700 shadow-sm">
              No applications match your filters.
            </div>
          ) : (
            filtered.map((a) => {
              const s = parseStatus(a.status);
              const isExpanded = !!expanded[a.id];

              const paymentStatus = String((a as any)?.payment_status || "unpaid").toLowerCase();
              const isPaid = paymentStatus === "paid";

              const checkedCount =
                a.checked && typeof a.checked === "object"
                  ? Object.values(a.checked).filter(Boolean).length
                  : 0;

              const docsArr =
                a.documents && typeof a.documents === "object"
                  ? Object.entries(a.documents)
                  : [];

              const hasVendorKey = !!((a.vendor_email || a.vendor_id || "").toString().trim());

              return (
                <div key={a.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {/* Row header */}
                  <div className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-extrabold">
                          App <span className="font-mono">#{a.id}</span>
                        </div>
                        <span
                          className={[
                            "rounded-full px-3 py-1 text-xs font-bold",
                            s === "submitted"
                              ? "bg-amber-100 text-amber-900"
                              : s === "approved"
                              ? "bg-emerald-100 text-emerald-900"
                              : s === "rejected"
                              ? "bg-red-100 text-red-900"
                              : "bg-slate-100 text-slate-800",
                          ].join(" ")}
                        >
                          {niceStatus(s)}
                        </span>

                        <span
                          className={[
                            "rounded-full px-3 py-1 text-xs font-bold",
                            isPaid
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-50 text-slate-700 border border-slate-200",
                          ].join(" ")}
                          title={isPaid ? "Payment received" : "Payment not received"}
                        >
                          {isPaid ? "Paid" : "Unpaid"}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                        <div>
                          Vendor:{" "}
                          <span className="font-mono">
                            {a.vendor_email || a.vendor_id || "—"}
                          </span>
                        </div>
                        <div>
                          Booth:{" "}
                          <span className="font-mono">{a.booth_id || "—"}</span>
                        </div>
                        {a.app_ref ? (
                          <div>
                            Ref: <span className="font-mono">{a.app_ref}</span>
                          </div>
                        ) : null}
                        <div>
                          Submitted:{" "}
                          <span className="font-mono">
                            {formatDate(a.submitted_at || a.updated_at || "") || "—"}
                          </span>
                        </div>
                        <div>
                          Checks:{" "}
                          <span className="font-mono">{checkedCount}</span>
                        </div>
                        <div>
                          Docs:{" "}
                          <span className="font-mono">{docsArr.length}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                        onClick={() => setExpanded((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                      >
                        {isExpanded ? "Hide" : "View"}
                      </button>

                      <button
                        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        disabled={busyGlobal || updatingId === a.id || !isPaid}
                        onClick={() => updateStatus(a.id, "approved")}
                        title={isPaid ? "Approve this application" : "Cannot approve until payment is received"}
                      >
                        Approve
                      </button>

                      <button
                        className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        disabled={busyGlobal || updatingId === a.id}
                        onClick={() => updateStatus(a.id, "rejected")}
                        title="Reject this application"
                      >
                        Reject
                      </button>

                      <button
                        className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        disabled={busyGlobal}
                        onClick={async () => {
                          if (!window.confirm("Delete this application?")) return;

                          const res = await fetch(`${API_BASE}/organizer/applications/${a.id}`, {
                            method: "DELETE",
                            headers: authHeaders(),
                          });

                          if (res.ok) {
                            setApps((prev) => prev.filter((x) => x.id !== a.id));
                          } else {
                            alert("Failed to delete application.");
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expanded details (unchanged from your file) */}
                  {isExpanded ? (
                    <div className="border-t border-slate-200 p-5">
                      {!hasVendorKey ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          This application is missing vendor identity (vendor_email/vendor_id). It may be a legacy record.
                        </div>
                      ) : null}

                      {a.notes ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{a.notes}</div>
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Compliance</div>
                          <div className="mt-2 text-sm text-slate-700">
                            {reqsLoading ? (
                              <div>Loading requirements…</div>
                            ) : reqs?.compliance?.length ? (
                              <ul className="space-y-1">
                                {reqs.compliance.map((c) => (
                                  <li key={c.id} className="flex items-start gap-2">
                                    <span className="mt-1 inline-block h-2 w-2 rounded-full bg-slate-300" />
                                    <span>
                                      {c.text}{" "}
                                      {c.required ? <span className="text-xs font-bold text-red-600">(required)</span> : null}
                                      {a.checked?.[c.id] ? <span className="ml-2 text-xs font-bold text-emerald-700">✓</span> : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div>No compliance requirements found.</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 p-4">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Documents</div>
                          <div className="mt-2 text-sm text-slate-700">
                            {docsArr.length ? (
                              <ul className="space-y-2">
                                {docsArr.map(([docId, meta]) => {
                                  const url = meta?.url;
                                  const name = meta?.original_name || meta?.filename || docId;
                                  return (
                                    <li key={docId} className="flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate font-mono text-xs">{docId}</div>
                                        <div className="truncate">{name}</div>
                                        <div className="text-xs text-slate-500">
                                          {meta?.size ? `${meta.size} bytes` : ""}{" "}
                                          {meta?.uploaded_at || meta?.uploadedAt ? `• ${formatDate(meta.uploaded_at || meta.uploadedAt)}` : ""}
                                        </div>
                                      </div>
                                      {url ? (
                                        <a
                                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold hover:bg-slate-50"
                                          href={`${API_BASE}${url}`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          View
                                        </a>
                                      ) : (
                                        <span className="text-xs text-slate-400">No URL</span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <div>No documents uploaded.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
