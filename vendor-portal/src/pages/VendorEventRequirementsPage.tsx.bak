// src/pages/VendorEventRequirementsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";
import * as ApplicationsAPI from "../components/api/applications";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function coerceNumericAppId(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s || s === "[object Object]" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") {
    return "";
  }
  if (/^\d+$/.test(s)) return s;

  const m =
    s.match(/^app_(\d+)_/i) ||
    s.match(/^app(\d+)_/i) ||
    s.match(/^app(\d+)$/i);

  return m?.[1] ? String(m[1]) : s;
}

function pickArray(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function itemKey(item: any, fallback: string) {
  return String(
    item?.id ?? item?.key ?? item?.name ?? item?.title ?? item?.label ?? fallback
  ).trim();
}

function displayLabel(item: any, fallback: string) {
  return String(item?.name || item?.title || item?.label || fallback);
}

function normalizeDocsMap(raw: any): Record<string, any[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, any[]> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!value) return;
    out[key] = Array.isArray(value) ? value : [value];
  });
  return out;
}

export default function VendorEventRequirementsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId((params as any).eventId), [params]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const rawAppId = searchParams.get("appId") || "";
  const appId = useMemo(() => coerceNumericAppId(rawAppId), [rawAppId]);
  const boothIdFromUrl = searchParams.get("boothId") || "";

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<any>(null);
  const [application, setApplication] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [docsMap, setDocsMap] = useState<Record<string, any[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const session = readSession();
        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        if (session?.accessToken) {
          headers["Authorization"] = `Bearer ${session.accessToken}`;
        }
        if (session?.email) {
          headers["x-user-email"] = session.email;
        }

        const [reqRes, appData] = await Promise.all([
          fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`, {
            method: "GET",
            headers,
          }),
          appId
            ? ApplicationsAPI.vendorGetApplication(Number(appId)).catch(() => null)
            : Promise.resolve(null),
        ]);

        const reqText = await reqRes.text();
        const reqData = reqText
          ? (() => {
              try {
                return JSON.parse(reqText);
              } catch {
                return { detail: reqText };
              }
            })()
          : {};

        if (!reqRes.ok) {
          throw new Error(String((reqData as any)?.detail || "Failed to load requirements."));
        }

        if (!cancelled) {
          setRequirements(reqData);
          setApplication(appData);
          setCheckedMap((appData as any)?.checked && typeof (appData as any).checked === "object" ? { ...(appData as any).checked } : {});
          setDocsMap(normalizeDocsMap((appData as any)?.documents ?? (appData as any)?.docs));
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ? String(e.message) : "Failed to load requirements.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (eventId) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [eventId, appId]);
  useEffect(() => {
    if (!appId || !boothIdFromUrl) return;

    async function saveBoothFromUrl() {
      try {
        await ApplicationsAPI.vendorSaveProgress({
          applicationId: Number(appId),
          body: { booth_id: boothIdFromUrl },
        });
      } catch (e) {
        console.error("Failed to save booth from URL", e);
      }
    }

    saveBoothFromUrl();
  }, [appId, boothIdFromUrl]);


  const reqRoot = useMemo(() => {
    if (!requirements) return {};
    if (requirements?.requirements && typeof requirements.requirements === "object") {
      return requirements.requirements;
    }
    return requirements;
  }, [requirements]);

  const boothCategories = useMemo(
    () => pickArray(reqRoot, ["booth_categories", "boothCategories", "categories"]),
    [reqRoot]
  );
  const complianceItems = useMemo(
    () => pickArray(reqRoot, ["compliance", "compliance_items", "complianceItems"]),
    [reqRoot]
  );
  const documents = useMemo(
    () =>
      pickArray(reqRoot, [
        "documents",
        "document_requirements",
        "required_documents",
        "requiredDocuments",
      ]),
    [reqRoot]
  );
  const extraFields = useMemo(
    () => pickArray(reqRoot, ["extra_fields", "extraFields", "fields"]),
    [reqRoot]
  );

  const hasAnyRequirements =
    boothCategories.length > 0 ||
    complianceItems.length > 0 ||
    documents.length > 0 ||
    extraFields.length > 0;

  const appStatus = String(application?.status || "").toLowerCase().trim();
  const paymentStatus = String(application?.payment_status || "").toLowerCase().trim();

  const canPayNow =
    appStatus === "approved" &&
    paymentStatus !== "paid" &&
    paymentStatus !== "pending";

  const selectedBoothId = useMemo(() => {
    const requested = normalizeId(application?.requested_booth_id || "");
    const assigned = normalizeId(application?.booth_id || "");
    return assigned || requested;
  }, [application]);

  const completedComplianceCount = useMemo(
    () =>
      complianceItems.reduce((count: number, item: any, idx: number) => {
        const key = itemKey(item, `compliance_${idx + 1}`);
        return count + (checkedMap[key] ? 1 : 0);
      }, 0),
    [complianceItems, checkedMap]
  );

  const uploadedDocumentCount = useMemo(
    () =>
      documents.reduce((count: number, item: any, idx: number) => {
        const key = itemKey(item, `document_${idx + 1}`);
        return count + ((docsMap[key] || []).length > 0 ? 1 : 0);
      }, 0),
    [documents, docsMap]
  );

  const totalChecklistItems =
    (complianceItems.length > 0 ? complianceItems.length : 0) +
    (documents.length > 0 ? documents.length : 0) +
    1;

  const completedChecklistItems =
    completedComplianceCount + uploadedDocumentCount + (selectedBoothId ? 1 : 0);

  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round((completedChecklistItems / Math.max(totalChecklistItems, 1)) * 100))
  );

  const saveProgress = async (nextChecked = checkedMap, nextDocs = docsMap, message = "Requirements saved.") => {
    if (!appId) return;
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const updated = await ApplicationsAPI.vendorSaveProgress({
        applicationId: Number(appId),
        body: {
          checked: nextChecked,
          documents: nextDocs,
        },
      });
      setApplication(updated);
      setCheckedMap((updated as any)?.checked && typeof (updated as any).checked === "object" ? { ...(updated as any).checked } : nextChecked);
      setDocsMap(normalizeDocsMap((updated as any)?.documents ?? (updated as any)?.docs ?? nextDocs));
      setSaveMessage(message);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to save application progress.");
    } finally {
      setSaving(false);
    }
  };

  const onToggleCompliance = async (item: any, idx: number) => {
    const key = itemKey(item, `compliance_${idx + 1}`);
    const nextChecked = { ...checkedMap, [key]: !Boolean(checkedMap[key]) };
    setCheckedMap(nextChecked);
    await saveProgress(nextChecked, docsMap, "Compliance updated.");
  };

  const onSelectDocument = async (item: any, idx: number, file: File | null) => {
    const key = itemKey(item, `document_${idx + 1}`);
    const nextDocs = {
      ...docsMap,
      [key]: file
        ? [
            {
              name: file.name,
              size: file.size,
              type: file.type || "",
              lastModified: file.lastModified || 0,
            },
          ]
        : [],
    };
    setDocsMap(nextDocs);
    await saveProgress(checkedMap, nextDocs, file ? "Document attached." : "Document removed.");
  };

  const continueToApplication = async () => {
    if (!appId) return;
    await saveProgress(checkedMap, docsMap, "Requirements saved.");
    const qs = new URLSearchParams();
    qs.set("appId", String(appId));
    if (selectedBoothId) {
      qs.set("boothId", String(selectedBoothId));
    }
    nav(`/vendor/events/${encodeURIComponent(eventId)}/application/${encodeURIComponent(appId)}`);
  };

  const viewApplication = () => {
    if (!appId) return;
    nav(`/vendor/events/${encodeURIComponent(eventId)}/application/${encodeURIComponent(appId)}`);
  };

  const changeBooth = () => {
    if (!appId) return;
    nav(`/vendor/events/${encodeURIComponent(eventId)}/map?appId=${encodeURIComponent(appId)}`);
  };

  const reviewEvent = () => {
    nav(`/vendor/events/${encodeURIComponent(eventId)}`);
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="text-2xl font-black text-slate-900">Loading requirements…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={reviewEvent}
          className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-lg font-extrabold text-slate-900 hover:bg-slate-50"
        >
          Review Event Details
        </button>

        <button
          type="button"
          onClick={viewApplication}
          disabled={!appId}
          className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-lg font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
        >
          View My Application
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
          <div className="text-base font-black text-slate-900">Application Status</div>
          <div className="mt-2">Status: {application?.status || "draft"}</div>
          <div className="mt-1">Payment: {application?.payment_status || "unpaid"}</div>
          {saveMessage ? <div className="mt-3 text-emerald-600">{saveMessage}</div> : null}
          {saving ? <div className="mt-2 text-violet-600">Saving…</div> : null}
        </div>
      </div>

      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xl font-black text-slate-900">Application progress</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Complete your booth selection, compliance items, and required document uploads.
            </div>
          </div>
          <div className="rounded-full bg-white px-4 py-2 text-sm font-extrabold text-violet-700 ring-1 ring-violet-200">
            {completedChecklistItems} / {totalChecklistItems} complete
          </div>
        </div>

        <div className="mt-4 h-3 overflow-hidden rounded-full bg-white ring-1 ring-violet-200">
          <div
            className="h-full rounded-full bg-violet-600 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Booth</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">
              {selectedBoothId ? `Selected: ${selectedBoothId}` : "Not selected yet"}
            </div>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Compliance</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">
              {completedComplianceCount} / {complianceItems.length} completed
            </div>
          </div>
          <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Documents</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">
              {uploadedDocumentCount} / {documents.length} uploaded
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr,0.8fr]">
        <div className="space-y-5">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          {!hasAnyRequirements ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">
              <div className="text-base font-black">No requirements published yet.</div>
              <div className="mt-2">
                This event does not currently require booth categories, compliance items, or
                documents. You can continue your application now.
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={continueToApplication}
                  disabled={!appId || saving}
                  className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  Continue Application
                </button>

                <button
                  type="button"
                  onClick={changeBooth}
                  disabled={!appId || saving}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Change Booth
                </button>

                <button
                  type="button"
                  onClick={reviewEvent}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Back to Event
                </button>
              </div>
            </div>
          ) : null}

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-4xl font-black text-slate-900">Booth Categories</div>
                <div className="mt-2 text-xl text-slate-600">Pricing and sizes set by the organizer.</div>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600">
                {boothCategories.length} categories
              </div>
            </div>

            {boothCategories.length === 0 ? (
              <div className="mt-6 text-xl text-slate-600">No booth categories available.</div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {boothCategories.map((item: any, idx: number) => (
                  <div key={String(item?.id ?? idx)} className="rounded-2xl border border-slate-200 p-5">
                    <div className="text-xl font-black text-slate-900">
                      {item?.name || item?.label || `Category ${idx + 1}`}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-500">
                      {item?.description || "No description provided."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-4xl font-black text-slate-900">Compliance</div>
            {complianceItems.length === 0 ? (
              <div className="mt-6 text-xl text-slate-600">No compliance items.</div>
            ) : (
              <div className="mt-6 space-y-3">
                {complianceItems.map((item: any, idx: number) => {
                  const key = itemKey(item, `compliance_${idx + 1}`);
                  const checked = Boolean(checkedMap[key]);
                  return (
                    <label
                      key={String(item?.id ?? idx)}
                      className="flex cursor-pointer items-start gap-4 rounded-2xl border border-slate-200 p-5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleCompliance(item, idx)}
                        className="mt-1 h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <div className="min-w-0">
                        <div className="text-lg font-black text-slate-900">
                          {displayLabel(item, `Compliance Item ${idx + 1}`)}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-500">
                          {item?.description || "No description provided."}
                        </div>
                        <div className="mt-3 text-sm font-bold text-violet-700">
                          {checked ? "Marked complete" : "Check to confirm you meet this requirement"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-4xl font-black text-slate-900">Documents</div>
            {documents.length === 0 ? (
              <div className="mt-6 text-xl text-slate-600">No documents required.</div>
            ) : (
              <div className="mt-6 space-y-3">
                {documents.map((item: any, idx: number) => {
                  const key = itemKey(item, `document_${idx + 1}`);
                  const files = docsMap[key] || [];
                  const first = files[0];
                  return (
                    <div key={String(item?.id ?? idx)} className="rounded-2xl border border-slate-200 p-5">
                      <div className="text-lg font-black text-slate-900">
                        {displayLabel(item, `Document ${idx + 1}`)}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-500">
                        {item?.description || "No description provided."}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-violet-700">
                          Upload file
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => onSelectDocument(item, idx, e.target.files?.[0] || null)}
                          />
                        </label>
                        {first ? (
                          <button
                            type="button"
                            onClick={() => onSelectDocument(item, idx, null)}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                          >
                            Remove file
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm font-semibold text-slate-600">
                        {first ? `Attached: ${first.name}` : "No file uploaded yet."}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-2xl font-black text-slate-900">Additional Fields</div>
            {extraFields.length === 0 ? (
              <div className="mt-4 text-lg text-slate-600">
                These will be collected in a future update.
                <div className="mt-4">No extra fields.</div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {extraFields.map((item: any, idx: number) => (
                  <div key={String(item?.id ?? idx)} className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-base font-black text-slate-900">
                      {item?.label || item?.name || `Field ${idx + 1}`}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {item?.help_text || item?.description || "No description provided."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-2xl font-black text-slate-900">Next Step</div>
            <div className="mt-3 text-sm font-semibold text-slate-600">
              Continue with your application once you have reviewed the event details.
            </div>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={continueToApplication}
                disabled={!appId || saving}
                className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                Continue Application
              </button>

              <button
                type="button"
                onClick={changeBooth}
                disabled={!appId || saving}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Change Booth
              </button>

              <button
                type="button"
                onClick={viewApplication}
                disabled={!appId}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                View My Application
              </button>

              {canPayNow ? (
                <button
                  type="button"
                  onClick={() =>
                    nav(`/vendor/events/${encodeURIComponent(eventId)}/application/${encodeURIComponent(appId)}?pay=1`)
                  }
                  className="w-full rounded-xl border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-extrabold text-violet-700 hover:bg-violet-100"
                >
                  Proceed to Payment
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}





