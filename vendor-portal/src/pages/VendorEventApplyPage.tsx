// src/pages/VendorEventApplyPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type ComplianceItem = {
  id?: string;
  text: string;
  required: boolean;
};

type RequirementsResponse = {
  version?: number;
  requirements?: {
    compliance_items?: any[];
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

  // fallback: older shapes
  if (Array.isArray(apiResp?.complianceItems)) {
    return apiResp.complianceItems
      .map((c: any) => ({
        id: c?.id,
        text: String(c?.text ?? c?.label ?? "").trim(),
        required: !!c?.required,
      }))
      .filter((x: any) => x.text.length > 0);
  }

  if (Array.isArray(apiResp)) {
    return apiResp
      .filter((x: any) => typeof x === "string")
      .map((t: string) => ({ id: undefined, text: t.trim(), required: true }))
      .filter((x: any) => x.text.length > 0);
  }

  return [];
}

function getQueryParam(search: string, key: string) {
  try {
    const sp = new URLSearchParams(search);
    const v = sp.get(key);
    return v ?? "";
  } catch {
    return "";
  }
}

export default function VendorEventApplyPage() {
  const nav = useNavigate();
  const params = useParams();
  const location = useLocation();

  const eventId = params.eventId ? String(params.eventId) : "";

  // Back-compat: accept appId OR appld
  const appId = useMemo(() => {
    return getQueryParam(location.search, "appId") || getQueryParam(location.search, "appld") || "";
  }, [location.search]);

  const boothId = useMemo(() => getQueryParam(location.search, "boothId"), [location.search]);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [agree, setAgree] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!eventId) return;

      setLoading(true);
      setLoadErr(null);

      try {
        const res = await fetch(`${API_BASE}/events/${eventId}/requirements`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${text || "Failed to load requirements"}`);
        }

        const data = await res.json().catch(() => null);
        const normalized = normalizeComplianceItems(data);

        if (cancelled) return;

        setItems(normalized);

        setChecked((prev) => {
          const next: Record<string, boolean> = { ...prev };
          for (const it of normalized) {
            const key = it.id || it.text;
            if (next[key] === undefined) next[key] = false;
          }
          return next;
        });
      } catch (e: any) {
        if (cancelled) return;
        setLoadErr(e?.message || "Unable to load requirements.");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function submit() {
    if (!eventId) return;

    setSubmitting(true);
    setSubmitErr(null);

    try {
      const headers = buildAuthHeaders({ "Content-Type": "application/json" });

      // If identity missing, backend will store apps without vendor match (or refuse to list).
      const hasIdentity = !!headers.Authorization || !!headers["x-user-email"] || !!headers["x-user-id"];
      if (!hasIdentity) {
        throw new Error("Missing login identity. Please log in again before submitting.");
      }

      const payload = {
        booth_id: boothId || undefined,
        boothId: boothId || undefined,
        app_id: appId || undefined,
        appId: appId || undefined,
        checked,
        notes,
      };

      const res = await fetch(`${API_BASE}/applications/events/${eventId}/apply`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const text = await res.text().catch(() => "");

      if (!res.ok) {
        try {
          const j = JSON.parse(text);
          throw new Error(j?.detail || text || `Submit failed (${res.status})`);
        } catch {
          throw new Error(text || `Submit failed (${res.status})`);
        }
      }

      nav("/vendor/applications");
    } catch (e: any) {
      setSubmitErr(e?.message || "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalRequired = useMemo(() => items.filter((x) => x.required).length, [items]);

  const doneRequired = useMemo(() => {
    const required = items.filter((x) => x.required);
    if (required.length === 0) return 0;

    let done = 0;
    for (const it of required) {
      const key = it.id || it.text;
      if (checked[key]) done += 1;
    }
    return done;
  }, [items, checked]);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (submitting) return false;
    if (!agree) return false;
    if (totalRequired === 0) return true;
    return doneRequired === totalRequired;
  }, [loading, submitting, agree, doneRequired, totalRequired]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6">
          <div className="text-4xl font-black tracking-tight">Review &amp; Submit</div>
          <div className="mt-2 text-sm font-semibold text-slate-600">
            You must acknowledge the terms and complete required items before submitting.
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Event: <span className="font-mono">{eventId}</span>
            {boothId ? (
              <>
                {" "}
                • Booth: <span className="font-mono">{boothId}</span>
              </>
            ) : null}
          </div>
        </div>

        {loadErr ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
            {loadErr}
          </div>
        ) : null}

        {submitErr ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
            {submitErr}
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          {loading ? (
            <div className="text-sm font-semibold text-slate-700">Loading requirements…</div>
          ) : items.length === 0 ? (
            <div className="text-sm font-semibold text-slate-700">
              No compliance requirements were provided for this event.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-extrabold text-slate-800">
                Compliance requirements ({doneRequired}/{totalRequired} required complete)
              </div>

              <div className="space-y-2">
                {items.map((it, idx) => {
                  const key = it.id || it.text || String(idx);
                  const isChecked = !!checked[key];

                  return (
                    <label
                      key={key}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={isChecked}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setChecked((prev) => ({ ...prev, [key]: v }));
                        }}
                      />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{it.text}</div>
                        <div className="mt-0.5 text-xs font-bold text-slate-500">
                          {it.required ? "Required" : "Optional"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="mt-4">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Notes</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800"
                  placeholder="Anything the organizer should know?"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <div className="text-sm font-semibold text-slate-800">
              I confirm the information in this application is accurate and I agree to follow the event rules and
              compliance requirements.
            </div>
          </label>

          <div className="mt-6">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={
                "w-full rounded-2xl px-6 py-4 text-lg font-black " +
                (canSubmit ? "bg-violet-500 text-white hover:bg-violet-600" : "bg-slate-200 text-slate-500")
              }
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>

            <div className="mt-3 text-center text-xs font-semibold text-slate-500">
              If you get a 422, the error box above will show the backend “detail” so we can match the request model
              exactly.
            </div>
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => nav(`/vendor/events/${encodeURIComponent(eventId)}`)}
              className="text-sm font-extrabold text-slate-700 hover:underline"
            >
              Back to event
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
