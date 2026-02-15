import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = "http://localhost:8002";

type RequirementItem = {
  id: string;
  label: string;
  required?: boolean; // default true if omitted
};

type RequirementsResponse = {
  items: RequirementItem[];
  notes?: string;
};

type EventResponse = {
  id: number;
  title?: string;
  name?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  start_date?: string;
  date?: string;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      (isJson && data && (data.detail || data.message || data.error)) ||
      (typeof data === "string" ? data : null) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data as T;
}

function firstStr(...vals: Array<string | undefined | null>) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v;
  return "";
}

export default function OrganizerVendorPreviewPage() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();

  const safeEventId = useMemo(() => {
    const n = Number(eventId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [eventId]);

  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null
  );

  const [event, setEvent] = useState<EventResponse | null>(null);
  const [requirements, setRequirements] = useState<RequirementsResponse | null>(null);

  // Preview: checkboxes always start empty
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!safeEventId) return;

    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setBanner(null);

        const [ev, req] = await Promise.all([
          getJson<EventResponse>(`/events/${safeEventId}`),
          getJson<RequirementsResponse>(`/events/${safeEventId}/requirements`),
        ]);

        if (!mounted) return;

        setEvent(ev);
        setRequirements(req);

        const init: Record<string, boolean> = {};
        (req.items || []).forEach((it) => {
          init[it.id] = false;
        });
        setChecked(init);
      } catch (e: any) {
        if (!mounted) return;
        setBanner({ kind: "error", text: e?.message || "Failed to load vendor preview." });
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [safeEventId]);

  const requiredIds = (requirements?.items || [])
    .filter((i) => i.required !== false)
    .map((i) => i.id);

  const allRequiredChecked =
    requiredIds.length === 0 ? true : requiredIds.every((id) => checked[id] === true);

  const title = firstStr(event?.title, event?.name) || (safeEventId ? `Event #${safeEventId}` : "Event");
  const when = firstStr(event?.start_date, event?.date);
  const where = [firstStr(event?.venue_name), firstStr(event?.city), firstStr(event?.state)]
    .filter(Boolean)
    .join(" • ");

  if (!safeEventId) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Invalid event id.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900">Vendor Preview</h1>
            <p className="mt-1 text-base text-slate-600">
              This is exactly what vendors will see before they submit an application.
            </p>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-lg font-bold text-slate-900">{title}</div>
              {when || where ? (
                <div className="mt-1 text-sm text-slate-600">
                  {when ? <span>{when}</span> : null}
                  {when && where ? <span className="mx-2">•</span> : null}
                  {where ? <span>{where}</span> : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-base font-semibold text-slate-900 hover:bg-slate-50"
              onClick={() => navigate("/organizer/dashboard")}
            >
              ⟵ Dashboard
            </button>

            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-base font-semibold text-slate-900 hover:bg-slate-50"
              onClick={() => navigate(`/organizer/events/${safeEventId}/requirements`)}
            >
              ⟵ Requirements
            </button>

            <button
              className="rounded-xl bg-indigo-600 px-4 py-2 text-base font-extrabold text-white hover:bg-indigo-700"
              onClick={() => navigate(`/map-editor/${safeEventId}`)}
            >
              Continue to Map Editor →
            </button>
          </div>
        </div>

        {banner ? (
          <div
            className={[
              "mt-4 rounded-xl border p-3 text-base",
              banner.kind === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : banner.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-700",
            ].join(" ")}
          >
            {banner.text}
          </div>
        ) : null}
      </div>

      {loading ? <div className="text-slate-600">Loading preview…</div> : null}

      {!loading && !banner?.kind?.includes("error") ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Vendor Application Checklist</h2>
            <p className="mt-1 text-base text-slate-600">
              Vendors must confirm the items below before they can submit their application.
            </p>
          </div>

          {requirements?.notes ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
              {requirements.notes}
            </div>
          ) : null}

          <div className="space-y-3">
            {(requirements?.items || []).length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                No requirements found yet. Add requirements on the previous step.
              </div>
            ) : (
              (requirements?.items || []).map((item) => (
                <label key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={!!checked[item.id]}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                  />
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-900">
                      {item.label}{" "}
                      {item.required !== false ? (
                        <span className="text-red-600 font-extrabold">(required)</span>
                      ) : (
                        <span className="text-slate-500 font-semibold">(optional)</span>
                      )}
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2">
            <div className="text-sm text-slate-600">
              {allRequiredChecked
                ? "All required items confirmed."
                : "Check all required items to enable submission."}
            </div>

            <button
              className="rounded-xl bg-emerald-600 px-5 py-3 text-base font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              disabled={!allRequiredChecked || (requirements?.items || []).length === 0}
              onClick={() =>
                setBanner({
                  kind: "info",
                  text: "Preview mode: submission is disabled. Vendors will submit this checklist on the vendor side.",
                })
              }
            >
              Submit Application (Preview)
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
