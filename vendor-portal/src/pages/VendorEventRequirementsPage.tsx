import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

type RequirementField = {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  description?: string;
};

type ComplianceItem = {
  id: string;
  text: string;
  required?: boolean;
};

type DocumentRequirement = {
  id: string;
  name: string;
  required?: boolean;
  dueBy?: string;
};

type BoothCategory = {
  id: string;
  name: string;
  baseSize?: string; // e.g. "10x10"
  basePrice?: number;
  additionalPerFt?: number;
  cornerPremium?: number;
  fireMarshalFee?: number;
  electricalNote?: string;
};

type PaymentSettings = Record<string, any>;

type LoadedRequirements = {
  templateKey?: string;

  // normalized keys
  boothCategories: BoothCategory[];
  restrictions: string[];
  compliance: ComplianceItem[];
  documents: DocumentRequirement[];
  fields: RequirementField[];
  paymentSettings?: PaymentSettings;

  raw: any;
  source: "api" | "localStorage";
  sourceKey?: string;
};

type UploadMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type VendorReqProgress = {
  eventId: string;
  appId?: string;
  checked: Record<string, boolean>;
  uploads: Record<string, UploadMeta[]>;
  updatedAt: string;
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

// legacy keys
const LS_LEGACY_REQUIREMENTS_KEY = "event_requirements_v1_2";
const LS_VENDOR_PROGRESS_KEY = "vendor_requirements_progress_v1";

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

function Badge({ kind }: { kind: "Required" | "Optional" }) {
  if (kind === "Required") {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
        Required
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      Optional
    </span>
  );
}

/**
 * Accept organizer requirements in either shape:
 * - Newer keys: restrictions/compliance/documents/fields/boothCategories/paymentSettings
 * - Template-system keys: customRestrictions/complianceItems/documentRequirements/boothCategories/paymentSettings
 */
function normalizeRequirementsShape(raw: any): Omit<LoadedRequirements, "source" | "sourceKey"> | null {
  if (!raw || typeof raw !== "object") return null;

  const parsed = raw?.requirements ?? raw;

  const templateKey = parsed?.templateKey || parsed?.id || undefined;

  const boothCategories: BoothCategory[] = Array.isArray(parsed?.boothCategories)
    ? parsed.boothCategories
    : [];

  const restrictions: string[] = Array.isArray(parsed?.restrictions)
    ? parsed.restrictions
    : Array.isArray(parsed?.customRestrictions)
      ? parsed.customRestrictions.map((r: any) => (typeof r === "string" ? r : r?.text || r?.label || "")).filter(Boolean)
      : [];

  const compliance: ComplianceItem[] = Array.isArray(parsed?.compliance)
    ? parsed.compliance
    : Array.isArray(parsed?.complianceItems)
      ? parsed.complianceItems.map((c: any) => ({
          id: normalizeId(c?.id || c?.text || c?.label),
          text: String(c?.text || c?.label || "").trim(),
          required: !!c?.required,
        })).filter((c: any) => c.text)
      : [];

  const documents: DocumentRequirement[] = Array.isArray(parsed?.documents)
    ? parsed.documents
    : Array.isArray(parsed?.documentRequirements)
      ? parsed.documentRequirements.map((d: any) => ({
          id: normalizeId(d?.id || d?.name),
          name: String(d?.name || "").trim(),
          required: !!d?.required,
          dueBy: d?.dueBy ? String(d.dueBy) : undefined,
        })).filter((d: any) => d.name)
      : [];

  const fields: RequirementField[] = Array.isArray(parsed?.fields)
    ? parsed.fields.map((f: any) => ({
        id: normalizeId(f?.id || f?.label),
        label: String(f?.label || "").trim(),
        type: f?.type ? String(f.type) : undefined,
        required: !!f?.required,
        description: f?.description ? String(f.description) : undefined,
      })).filter((f: any) => f.label)
    : [];

  const paymentSettings = parsed?.paymentSettings && typeof parsed.paymentSettings === "object"
    ? parsed.paymentSettings
    : undefined;

  const hasAny =
    boothCategories.length > 0 ||
    restrictions.length > 0 ||
    compliance.length > 0 ||
    documents.length > 0 ||
    fields.length > 0 ||
    !!paymentSettings;

  if (!hasAny) return null;

  return {
    templateKey,
    boothCategories,
    restrictions,
    compliance,
    documents,
    fields,
    paymentSettings,
    raw,
  };
}

async function loadRequirementsFromApi(eventId: string): Promise<LoadedRequirements | null> {
  const candidates = [
    // prefer real backend first
    `${API_BASE}/organizer/events/${encodeURIComponent(eventId)}/requirements`,
    `${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`,
    // legacy paths (keep if you used these before)
    `${API_BASE}/api/organizer/events/${encodeURIComponent(eventId)}/requirements`,
    `${API_BASE}/api/events/${encodeURIComponent(eventId)}/requirements`,
    `${API_BASE}/api/vendor/events/${encodeURIComponent(eventId)}/requirements`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      const normalized = normalizeRequirementsShape(data);
      if (!normalized) continue;

      return { ...normalized, source: "api" };
    } catch {
      // try next
    }
  }

  return null;
}

function loadRequirementsFromLocalStorage(eventId: string): LoadedRequirements | null {
  const id = normalizeId(eventId);
  if (!id) return null;

  // ✅ PRIMARY: organizer key you showed in UI debug
  const organizerKey = `organizer:event:${id}:requirements`;
  const organizerParsed = safeJsonParse(localStorage.getItem(organizerKey));
  const normalizedOrganizer = normalizeRequirementsShape(organizerParsed);
  if (normalizedOrganizer) {
    return { ...normalizedOrganizer, source: "localStorage", sourceKey: organizerKey };
  }

  // ✅ SECONDARY: legacy
  const legacyParsed = safeJsonParse(localStorage.getItem(LS_LEGACY_REQUIREMENTS_KEY));
  if (legacyParsed) {
    // legacy formats can vary; normalizeRequirementsShape will reject if empty
    const normalizedLegacy = normalizeRequirementsShape(legacyParsed?.[id] ?? legacyParsed);
    if (normalizedLegacy) {
      return { ...normalizedLegacy, source: "localStorage", sourceKey: LS_LEGACY_REQUIREMENTS_KEY };
    }
  }

  return null;
}

function loadVendorProgress(eventId: string, appId?: string): VendorReqProgress | null {
  const all = safeJsonParse<VendorReqProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS_KEY));
  if (!Array.isArray(all)) return null;

  const eId = normalizeId(eventId);
  const aId = normalizeId(appId || "");

  return all.find((p) => normalizeId(p.eventId) === eId && normalizeId(p.appId || "") === aId) ?? null;
}

function saveVendorProgress(progress: VendorReqProgress) {
  const all = safeJsonParse<VendorReqProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS_KEY));
  const list = Array.isArray(all) ? all : [];

  const eId = normalizeId(progress.eventId);
  const aId = normalizeId(progress.appId || "");

  const next = list.filter((p) => !(normalizeId(p.eventId) === eId && normalizeId(p.appId || "") === aId));
  next.unshift(progress);

  localStorage.setItem(LS_VENDOR_PROGRESS_KEY, JSON.stringify(next));
}

export default function VendorEventRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId(params.eventId), [params.eventId]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const appId = useMemo(() => normalizeId(searchParams.get("appId") || ""), [searchParams]);

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<LoadedRequirements | null>(null);
  const [error, setError] = useState("");

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [uploads, setUploads] = useState<Record<string, UploadMeta[]>>({});

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError("");
      setRequirements(null);

      if (!eventId) {
        if (!alive) return;
        setError("Missing eventId in route.");
        setLoading(false);
        return;
      }

      const apiReq = await loadRequirementsFromApi(eventId);
      const lsReq = loadRequirementsFromLocalStorage(eventId);
      const finalReq = apiReq ?? lsReq;

      if (!alive) return;

      if (!finalReq) {
        setError(
          "No requirements found for this event. (API returned nothing and localStorage fallback is empty.)"
        );
        setLoading(false);
        return;
      }

      setRequirements(finalReq);
      setError("");

      const prog = loadVendorProgress(eventId, appId || undefined);
      if (prog) {
        setChecked(prog.checked || {});
        setUploads(prog.uploads || {});
      } else {
        setChecked({});
        setUploads({});
      }

      setLoading(false);
    }

    run();
    return () => {
      alive = false;
    };
  }, [eventId, appId]);

  useEffect(() => {
    if (!eventId) return;
    if (!requirements) return;

    const progress: VendorReqProgress = {
      eventId,
      appId: appId || undefined,
      checked,
      uploads,
      updatedAt: new Date().toISOString(),
    };

    saveVendorProgress(progress);
  }, [eventId, appId, checked, uploads, requirements]);

  const boothCategories = requirements?.boothCategories ?? [];
  const restrictions = requirements?.restrictions ?? [];
  const compliance = requirements?.compliance ?? [];
  const documents = requirements?.documents ?? [];
  const fields = requirements?.fields ?? [];

  function toggle(id: string) {
    const key = normalizeId(id);
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addUploads(docId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const key = normalizeId(docId);
    const nextFiles: UploadMeta[] = Array.from(files).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
      lastModified: f.lastModified,
    }));

    setUploads((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      return { ...prev, [key]: [...existing, ...nextFiles] };
    });
  }

  function removeUpload(docId: string, idx: number) {
    const key = normalizeId(docId);
    setUploads((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      const next = existing.filter((_, i) => i !== idx);
      return { ...prev, [key]: next };
    });
  }

  function goBackToDashboard() {
    navigate("/vendor/dashboard");
  }

  function goBackToEvent() {
    navigate(`/vendor/events/${encodeURIComponent(eventId)}${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`);
  }

  function goToLayout() {
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`);
  }

  function viewMyApplication() {
    if (!appId) return;
    navigate(`/vendor/applications?appId=${encodeURIComponent(appId)}&eventId=${encodeURIComponent(eventId)}`);
  }

  function continueFlow() {
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`);
  }

  const sourceLabel = useMemo(() => {
    if (!requirements) return "—";
    if (requirements.source === "api") return "API";
    return requirements.sourceKey ? `localStorage • ${requirements.sourceKey}` : "localStorage";
  }, [requirements]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-slate-500">Vendor Portal</div>
            <h1 className="text-2xl font-semibold text-slate-900">Event {eventId} Requirements</h1>

            {requirements?.templateKey ? (
              <div className="mt-1 text-sm text-slate-600">
                Template: <span className="font-medium">{requirements.templateKey}</span>
              </div>
            ) : null}

            <div className="mt-1 text-xs text-slate-500">Source: {sourceLabel}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={goBackToDashboard}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Back to Dashboard
            </button>

            <button
              type="button"
              onClick={goBackToEvent}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              Back to Event
            </button>

            <button
              type="button"
              onClick={goToLayout}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Layout
            </button>

            {appId ? (
              <button
                type="button"
                onClick={viewMyApplication}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
              >
                View My Application
              </button>
            ) : null}
          </div>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
              <div className="text-sm text-slate-700">Loading requirements…</div>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-sm font-semibold text-rose-700">Couldn't load requirements</div>
              <div className="mt-1 text-sm text-rose-700">{error}</div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Retry
                </button>

                <button
                  type="button"
                  onClick={goBackToEvent}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Return to Event
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Debug: eventId=<span className="font-mono">{eventId}</span>
                {appId ? (
                  <>
                    {" "}
                    • appId=<span className="font-mono">{appId}</span>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {/* Booth Categories (this is what makes the page feel “not blank”) */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Booth Categories</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Pricing and sizes set by the organizer.
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {boothCategories.length} categor{boothCategories.length === 1 ? "y" : "ies"}
                  </div>
                </div>

                {boothCategories.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No booth categories were provided for this event.
                  </div>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Category</th>
                          <th className="px-4 py-3 font-semibold">Base Size</th>
                          <th className="px-4 py-3 font-semibold">Base Price</th>
                          <th className="px-4 py-3 font-semibold">Add’l / ft</th>
                          <th className="px-4 py-3 font-semibold">Corner</th>
                          <th className="px-4 py-3 font-semibold">Fire Marshal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {boothCategories.map((c) => (
                          <tr key={normalizeId(c.id || c.name)} className="bg-white">
                            <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                            <td className="px-4 py-3 text-slate-700">{c.baseSize || "—"}</td>
                            <td className="px-4 py-3 text-slate-700">
                              {typeof c.basePrice === "number" ? `$${c.basePrice}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {typeof c.additionalPerFt === "number" ? `$${c.additionalPerFt}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {typeof c.cornerPremium === "number" ? `$${c.cornerPremium}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {typeof c.fireMarshalFee === "number" ? `$${c.fireMarshalFee}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Restrictions */}
              {restrictions.length > 0 ? (
                <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Restrictions</div>
                  <div className="mt-1 text-sm text-slate-600">Read-only (set by organizer)</div>

                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {restrictions.map((r, idx) => (
                      <li key={`${idx}-${r}`}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Compliance Confirmations */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Compliance Confirmations</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Check each item to confirm you meet the requirement.
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {compliance.length} item{compliance.length === 1 ? "" : "s"}
                  </div>
                </div>

                {compliance.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No compliance items were found for this event.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {compliance.map((c) => {
                      const cid = normalizeId(c.id || c.text);
                      const isChecked = Boolean(checked[`compliance:${cid}`]);

                      return (
                        <div key={cid} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={isChecked}
                            onChange={() => toggle(`compliance:${cid}`)}
                          />

                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{c.text}</div>
                              <Badge kind={c.required ? "Required" : "Optional"} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Document Uploads */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Document Uploads</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Upload each document under the matching requirement (per-item uploads).
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {documents.length} doc{documents.length === 1 ? "" : "s"}
                  </div>
                </div>

                {documents.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No document requirements were found for this event.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {documents.map((d) => {
                      const did = normalizeId(d.id || d.name);
                      const list = uploads[did] || [];

                      return (
                        <div key={did} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-slate-900">{d.name}</div>
                                <Badge kind={d.required ? "Required" : "Optional"} />
                                {d.dueBy ? <span className="text-xs text-slate-500">Due: {d.dueBy}</span> : null}
                              </div>
                            </div>

                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                              <input
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => {
                                  addUploads(did, e.target.files);
                                  e.currentTarget.value = "";
                                }}
                              />
                              Upload
                            </label>
                          </div>

                          {list.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {list.map((u, idx) => (
                                <div
                                  key={`${u.name}-${u.lastModified}-${idx}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-900">{u.name}</div>
                                    <div className="text-xs text-slate-500">
                                      {(u.size / 1024).toFixed(1)} KB • {u.type || "file"}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => removeUpload(did, idx)}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-slate-600">No files uploaded yet.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Field confirmations (optional) */}
              {fields.length > 0 ? (
                <div className="mb-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Application Field Checklist</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Optional confirmations for application fields (driven by organizer template).
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                      {fields.length} field{fields.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {fields.map((f) => {
                      const fid = normalizeId(f.id || f.label);
                      const isChecked = Boolean(checked[`field:${fid}`]);

                      return (
                        <div key={fid} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={isChecked}
                            onChange={() => toggle(`field:${fid}`)}
                          />

                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{f.label}</div>
                              <Badge kind={f.required ? "Required" : "Optional"} />
                            </div>

                            {f.description ? <div className="mt-1 text-sm text-slate-600">{f.description}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goBackToEvent}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Back to Event
                </button>

                <button
                  type="button"
                  onClick={continueFlow}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Continue
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Debug: normalized eventId=<span className="font-mono">{eventId}</span>
                {appId ? (
                  <>
                    {" "}
                    • appId=<span className="font-mono">{appId}</span>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
