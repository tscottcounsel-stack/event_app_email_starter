import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Auth ---------------- */

function authHeaders() {
  const raw = sessionStorage.getItem("session");
  const base: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (!raw) return base;

  try {
    const s = JSON.parse(raw);
    if (s?.accessToken) base.Authorization = `Bearer ${s.accessToken}`;
    return base;
  } catch {
    return base;
  }
}

/* ---------------- Types ---------------- */

type ComplianceItem = {
  id?: number | string;
  text: string;
  required: boolean;
};

type RequirementsResponse = {
  version?: number;
  requirements?: {
    compliance_items?: Array<{ id?: any; text?: any; required?: any }>;
    payment_settings?: any;
    booth_categories?: any;
    custom_restrictions?: any;
    document_requirements?: any;
  };
};

function normalizeComplianceItems(apiResp: any): ComplianceItem[] {
  const root: RequirementsResponse = apiResp?.requirements ? apiResp : { requirements: apiResp };

  const items = root?.requirements?.compliance_items;
  if (Array.isArray(items)) {
    return items
      .map((c) => ({
        id: c?.id,
        text: String(c?.text ?? "").trim(),
        required: !!c?.required,
      }))
      .filter((x) => x.text.length > 0);
  }

  // fallback: older shapes your UI might have used
  if (Array.isArray((apiResp as any)?.complianceItems)) {
    return (apiResp as any).complianceItems
      .map((c: any) => ({
        id: c?.id,
        text: String(c?.text ?? c?.label ?? "").trim(),
        required: !!c?.required,
      }))
      .filter((x: any) => x.text.length > 0);
  }

  if (Array.isArray(apiResp)) {
    // array of strings fallback
    return apiResp
      .filter((x: any) => typeof x === "string")
      .map((t: string) => ({ text: t.trim(), required: true }));
  }

  return [];
}

function getQueryParam(search: string, key: string) {
  const q = new URLSearchParams(search);
  return q.get(key);
}

/* ---------------- Component ---------------- */

export default function VendorEventApplyPage() {
  const nav = useNavigate();
  const { eventId } = useParams();
  const location = useLocation();

  const boothId =
    getQueryParam(location.search, "boothId") ||
    getQueryParam(location.search, "boothid") ||
    getQueryParam(location.search, "booth") ||
    "";

  const appId =
    getQueryParam(location.search, "appId") ||
    getQueryParam(location.search, "appid") ||
    "";

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");

  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    setLoading(true);
    setLoadErr(null);

    fetch(`${API_BASE}/events/${eventId}/requirements`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json().catch(() => null) : r.text().catch(() => null).then(() => null)))
      .then((data) => {
        const list = normalizeComplianceItems(data);
        setItems(list);

        const initial: Record<string, boolean> = {};
        list.forEach((c) => (initial[c.text] = false));
        setChecked(initial);
      })
      .catch(() => setLoadErr("Failed to load requirements."))
      .finally(() => setLoading(false));
  }, [eventId]);

  const requiredItems = useMemo(() => items.filter((i) => i.required), [items]);

  const completedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );

  const requiredCompleted = useMemo(() => {
    if (requiredItems.length === 0) return true;
    return requiredItems.every((i) => !!checked[i.text]);
  }, [requiredItems, checked]);

  const canSubmit = !!eventId && !!boothId && agree && requiredCompleted && !submitting;

  async function submit() {
    if (!eventId) return;

    setSubmitting(true);
    setSubmitErr(null);

    // Build a "superset" payload to satisfy stricter backend schemas.
    // Backend can ignore extras if it uses `extra="ignore"`.
    const confirmations = items.map((i) => ({
      text: i.text,
      required: i.required,
      checked: !!checked[i.text],
    }));

    const payload: any = {
      // common required fields
      event_id: Number(eventId),
      booth_id: boothId || null,
      app_id: appId || null,

      // compatibility aliases (some backends use camelCase)
      eventId: Number(eventId),
      boothId: boothId || null,
      appId: appId || null,

      notes: notes || "",
      compliance: confirmations,
      compliance_confirmations: confirmations,
      acknowledgements: {
        agreed: agree,
        agreed_at: new Date().toISOString(),
      },
    };

    const res = await fetch(`${API_BASE}/applications/events/${eventId}/apply`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // show backend detail to quickly identify the missing field
      let detail = "";
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json();
          detail = j?.detail
            ? typeof j.detail === "string"
              ? j.detail
              : JSON.stringify(j.detail)
            : JSON.stringify(j);
        } else {
          detail = await res.text();
        }
      } catch {
        // ignore
      }

      setSubmitErr(detail || `Submit failed (${res.status}).`);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    nav("/vendor/applications");
  }

  if (loading) return <div className="p-8 text-sm font-semibold text-slate-700">Loading application…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-600">Vendor Portal</div>
            <h1 className="mt-1 text-4xl font-black tracking-tight text-slate-900">
              Application — Event {eventId}
            </h1>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Complete the required acknowledgements and submit your booth application.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              onClick={() => nav(`/vendor/events/${eventId}/map${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`)}
            >
              ← Back to Map
            </button>
          </div>
        </div>

        {loadErr ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
            {loadErr}
          </div>
        ) : null}

        {/* Content grid */}
        <div className="mt-7 grid gap-6 lg:grid-cols-3">
          {/* Left: Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Booth summary */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-black text-slate-900">Booth Selection</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Your application is tied to the booth you selected on the map.
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-600">Booth ID</div>
                  <div className="mt-1 break-all text-sm font-extrabold text-slate-900">
                    {boothId || "Missing boothId"}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-600">Application ID</div>
                  <div className="mt-1 break-all text-sm font-extrabold text-slate-900">
                    {appId || "—"}
                  </div>
                </div>
              </div>

              {!boothId ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                  No boothId found in the URL. Go back to the map and select a booth first.
                </div>
              ) : null}
            </div>

            {/* Compliance */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-slate-900">Compliance Checklist</div>
                  <div className="mt-1 text-sm font-semibold text-slate-600">
                    Checked: {completedCount}/{items.length || 0}
                    {requiredItems.length ? ` • Required: ${requiredItems.length}` : ""}
                  </div>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                  No compliance items were found for this event.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {items.map((it) => (
                    <label
                      key={it.text}
                      className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4 hover:bg-slate-50"
                    >
                      <input
                        className="mt-1 h-4 w-4"
                        type="checkbox"
                        checked={!!checked[it.text]}
                        onChange={(e) => setChecked((s) => ({ ...s, [it.text]: e.target.checked }))}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-extrabold text-slate-900">
                          {it.text}{" "}
                          {it.required ? (
                            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-800">
                              Required
                            </span>
                          ) : (
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700">
                              Optional
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-600">
                          By checking this, you confirm you will comply with the event requirement.
                        </div>
                      </div>
                    </label>
                  ))}

                  {!requiredCompleted ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                      Please complete all required compliance items before submitting.
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-black text-slate-900">Notes to Organizer</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Optional details (setup needs, questions, special requests, etc.).
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-4 min-h-[140px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-300"
                placeholder="Type your note…"
              />
            </div>
          </div>

          {/* Right: Review & submit */}
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-black text-slate-900">Review & Submit</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                You must acknowledge the terms and complete required items before submitting.
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-start gap-3">
                  <input
                    className="mt-1 h-4 w-4"
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  <div className="text-sm font-extrabold text-slate-900">
                    I confirm the information in this application is accurate and I agree to follow the event rules and
                    compliance requirements.
                  </div>
                </label>
              </div>

              {submitErr ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                  {submitErr}
                </div>
              ) : null}

              <button
                className="mt-5 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSubmit}
                onClick={submit}
                title={
                  !boothId
                    ? "Missing boothId"
                    : !agree
                    ? "You must agree before submitting"
                    : !requiredCompleted
                    ? "Complete required compliance items"
                    : undefined
                }
              >
                {submitting ? "Submitting…" : "Submit Application"}
              </button>

              <div className="mt-3 text-xs font-semibold text-slate-500">
                If you get a 422 again, the error box above will show the backend “detail” so we can match the request
                model exactly.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
