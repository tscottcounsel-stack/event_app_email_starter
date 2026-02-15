// src/pages/VendorApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorProgress = {
  eventId: string;
  appId: string;
  boothId?: string;
  checked: Record<string, boolean>;
  notes?: string;
  updatedAt: string;
  status?: "draft" | "submitted";
  submittedAt?: string;
};

type ServerApplication = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  app_ref?: string | null;
  notes?: string;
  checked?: Record<string, boolean>;
  status?: string;
  submitted_at?: string;
  updated_at?: string;
};

const LS_VENDOR_PROGRESS = "vendor_requirements_progress_v1";

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function calcCompletion(item: VendorProgress) {
  const keys = Object.keys(item.checked || {});
  if (keys.length === 0) return { done: 0, total: 0, pct: 100 };
  const done = keys.filter((k) => item.checked[k]).length;
  const total = keys.length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return { done, total, pct };
}

function authHeaders() {
  // Your vendor apply page uses sessionStorage("session") with accessToken
  const raw = sessionStorage.getItem("session");
  if (!raw) return { Accept: "application/json" };

  try {
    const s = JSON.parse(raw);
    return {
      Accept: "application/json",
      Authorization: s?.accessToken ? `Bearer ${s.accessToken}` : undefined,
    } as Record<string, string>;
  } catch {
    return { Accept: "application/json" };
  }
}

function loadLocalDrafts(): VendorProgress[] {
  const raw = safeJsonParse<VendorProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS));
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((x) => x && x.eventId && x.appId);
}

function saveLocalDrafts(list: VendorProgress[]) {
  localStorage.setItem(LS_VENDOR_PROGRESS, JSON.stringify(list));
}

function normalizeServerToUi(a: ServerApplication): VendorProgress {
  const appId =
    (a.app_ref && String(a.app_ref)) ||
    (a.id != null ? `srv_${String(a.id)}` : `srv_${Date.now()}`);

  return {
    eventId: String(a.event_id ?? ""),
    appId,
    boothId: a.booth_id ? String(a.booth_id) : undefined,
    checked: a.checked || {},
    notes: a.notes || "",
    updatedAt: a.updated_at || a.submitted_at || new Date().toISOString(),
    status: (String(a.status || "submitted").toLowerCase() === "submitted" ? "submitted" : "submitted") as
      | "draft"
      | "submitted",
    submittedAt: a.submitted_at || a.updated_at,
  };
}

export default function VendorApplicationsPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  const [localDrafts, setLocalDrafts] = useState<VendorProgress[]>(() => loadLocalDrafts());
  const [serverApps, setServerApps] = useState<VendorProgress[]>([]);

  // Pull from API
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setServerError(null);

      try {
        const res = await fetch(`${API_BASE}/vendor/applications`, {
          method: "GET",
          headers: authHeaders(),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`API ${res.status}: ${text || "Failed to load server applications"}`);
        }

        const data = (await res.json().catch(() => null)) as { applications?: ServerApplication[] } | null;
        const apps = Array.isArray(data?.applications) ? data!.applications : [];

        const normalized = apps.map(normalizeServerToUi);

        if (!cancelled) setServerApps(normalized);
      } catch (e: any) {
        if (!cancelled) setServerError(e?.message || "Failed to load applications from server.");
        if (!cancelled) setServerApps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge: server submissions override local drafts (same appId) and also “mark” matching event/booth drafts as submitted when possible
  const merged = useMemo(() => {
    const drafts = localDrafts.slice();

    // Map server by appId
    const serverByAppId = new Map<string, VendorProgress>();
    serverApps.forEach((a) => serverByAppId.set(a.appId, a));

    // Remove local draft if server has same appId (server wins)
    const remainingDrafts = drafts.filter((d) => !serverByAppId.has(d.appId));

    // Soft-match: if a local draft has same (eventId + boothId) as a submitted server app, treat local as submitted view (but keep server card)
    // (This prevents “Continue resets everything” feel when appId didn’t roundtrip)
    const serverKeys = new Set(
      serverApps.map((a) => `${a.eventId}::${a.boothId || ""}`)
    );

    const cleanedDrafts = remainingDrafts.map((d) => {
      const key = `${d.eventId}::${d.boothId || ""}`;
      if (serverKeys.has(key)) {
        return { ...d, status: "submitted", submittedAt: d.submittedAt || d.updatedAt };
      }
      return d;
    });

    // Combine and sort newest-first by updatedAt/submittedAt
    const all = [...serverApps, ...cleanedDrafts];
    all.sort((a, b) => {
      const ta = new Date(a.submittedAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.submittedAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });

    return all;
  }, [localDrafts, serverApps]);

  function removeLocal(appId: string) {
    const next = localDrafts.filter((x) => x.appId !== appId);
    setLocalDrafts(next);
    saveLocalDrafts(next);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Applications</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              Drafts saved locally + submissions saved on the server.
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
                You can still see local drafts below.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Loaded server submissions: <span className="font-black">{serverApps.length}</span>
            </div>
          )}
        </div>

        {merged.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-xl font-black text-slate-900">No applications yet</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              When you save a draft or submit an application, it will show up here.
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
            {merged.map((it) => {
              const { done, total, pct } = calcCompletion(it);
              const status: "draft" | "submitted" = it.status || "draft";
              const isLocalDraft = localDrafts.some((d) => d.appId === it.appId);

              const continueUrl =
                status === "submitted"
                  ? `/vendor/events/${it.eventId}/apply?appId=${encodeURIComponent(it.appId)}`
                  : `/vendor/events/${it.eventId}/apply?` +
                    new URLSearchParams({
                      appId: it.appId,
                      ...(it.boothId ? { boothId: it.boothId } : {}),
                    }).toString();

              return (
                <div
                  key={`${it.eventId}:${it.appId}`}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="text-lg font-black text-slate-900">
                        Event #{it.eventId}
                        {it.boothId ? (
                          <span className="ml-2 text-sm font-extrabold text-slate-500">
                            • Booth {it.boothId}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        Last updated: {formatDate(it.updatedAt)}
                        {status === "submitted" && it.submittedAt ? (
                          <span className="ml-2">• Submitted: {formatDate(it.submittedAt)}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={
                          "rounded-full px-3 py-1 text-xs font-extrabold " +
                          (status === "submitted"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-700")
                        }
                      >
                        {status === "submitted" ? "Submitted" : "Draft"}
                      </span>

                      <div className="text-sm font-extrabold text-slate-700">
                        {pct}% <span className="font-semibold text-slate-500">({done}/{total})</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      to={continueUrl}
                      className="rounded-full bg-violet-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-violet-700"
                    >
                      {status === "submitted" ? "View Application" : "Continue"}
                    </Link>

                    <Link
                      to={`/vendor/events/${it.eventId}`}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                    >
                      View Event
                    </Link>

                    {isLocalDraft ? (
                      <button
                        onClick={() => removeLocal(it.appId)}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-50"
                        type="button"
                        title="Remove this local draft (server submissions won’t be deleted here)"
                      >
                        Remove Draft
                      </button>
                    ) : null}
                  </div>

                  {it.notes ? (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Notes</div>
                      <div className="mt-1 whitespace-pre-wrap">{it.notes}</div>
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
