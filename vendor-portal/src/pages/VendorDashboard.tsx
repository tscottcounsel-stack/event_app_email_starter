// src/pages/VendorDashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type VendorApplication = {
  id?: number;
  event_id?: number;
  booth_id?: string | null;
  app_ref?: string | null;
  notes?: string;
  checked?: Record<string, boolean>;
  status?: string; // submitted | approved | rejected | draft | etc
  submitted_at?: string;
  updated_at?: string;
};

type DiagramDoc = {
  booths?: Array<{ id: string; label?: string }>;
  levels?: Array<{
    id: string;
    name?: string;
    booths: Array<{ id: string; label?: string }>;
  }>;
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function normalizeStatus(s?: string) {
  const v = String(s || "").toLowerCase();
  if (v === "approved") return "approved";
  if (v === "rejected") return "rejected";
  if (v === "submitted") return "submitted";
  if (v === "draft") return "draft";
  return v || "submitted";
}

function calcCompletion(app: VendorApplication) {
  const checked = app.checked || {};
  const keys = Object.keys(checked);
  if (keys.length === 0) return { done: 0, total: 0, pct: 100 };
  const done = keys.filter((k) => !!checked[k]).length;
  const total = keys.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  return { done, total, pct };
}

function shortBoothId(id?: string | null) {
  const s = String(id || "").trim();
  if (!s) return "";
  // if you prefix ids like "booth-xxxx", keep last chunk
  const tail = s.split("-").slice(-2).join("-"); // last two chunks reads nicer
  return tail.length > 14 ? tail.slice(-14) : tail;
}

function extractBoothLabelIndex(doc: DiagramDoc | any): Record<string, string> {
  const out: Record<string, string> = {};
  const d: DiagramDoc =
    doc?.diagram && typeof doc.diagram === "object" ? doc.diagram : doc;

  const add = (booths: Array<{ id: string; label?: string }> | undefined) => {
    if (!Array.isArray(booths)) return;
    for (const b of booths) {
      const id = String(b?.id || "").trim();
      if (!id) continue;
      const label = String(b?.label || "").trim();
      if (label) out[id] = label;
    }
  };

  if (Array.isArray(d?.levels)) {
    for (const lvl of d.levels) add(lvl?.booths);
  } else {
    add(d?.booths);
  }

  return out;
}

export default function VendorDashboardPage() {
  const nav = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [apps, setApps] = useState<VendorApplication[]>([]);

  // eventId -> (boothId -> label)
  const [boothLabelsByEvent, setBoothLabelsByEvent] = useState<
    Record<string, Record<string, string>>
  >({});

  async function loadApps() {
    setLoading(true);
    setErr(null);

    try {
      const headers = buildAuthHeaders();
      const hasIdentity =
        !!headers.Authorization ||
        !!(headers as any)["x-user-email"] ||
        !!(headers as any)["x-user-id"];

      if (!hasIdentity) {
        setApps([]);
        setErr("Missing login identity. Please log in again.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/vendor/applications`, {
        headers: buildAuthHeaders(),
      });

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let msg = text || `Failed to load applications (${res.status})`;
        try {
          const j = JSON.parse(text);
          msg = j?.detail || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const data = JSON.parse(text || "{}");
      const list = Array.isArray(data?.applications) ? data.applications : [];
      setApps(list);
    } catch (e: any) {
      setApps([]);
      setErr(e?.message || "Failed to load applications.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBoothLabelsForEvents(eventIds: string[]) {
    const unique = Array.from(new Set(eventIds.filter(Boolean)));
    if (unique.length === 0) return;

    // only fetch ones we don't already have
    const missing = unique.filter((eid) => !boothLabelsByEvent[String(eid)]);
    if (missing.length === 0) return;

    const updates: Record<string, Record<string, string>> = {};
    await Promise.all(
      missing.map(async (eid) => {
        try {
          const url = `${API_BASE}/events/${encodeURIComponent(eid)}/diagram`;
          const res = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          if (!res.ok) {
            updates[eid] = {};
            return;
          }
          const j = await res.json().catch(() => null);
          updates[eid] = extractBoothLabelIndex(j || {});
        } catch {
          updates[eid] = {};
        }
      })
    );

    setBoothLabelsByEvent((prev) => ({ ...prev, ...updates }));
  }

  // Load on mount + when returning to this route
  useEffect(() => {
    loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Refresh on tab focus/visibility
  useEffect(() => {
    function onFocus() {
      loadApps();
    }
    function onVis() {
      if (document.visibilityState === "visible") loadApps();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever apps change, fetch diagram labels for those events (so booth display is human-friendly)
  useEffect(() => {
    const eids = apps
      .map((a) => String(a.event_id ?? "").trim())
      .filter(Boolean);
    loadBoothLabelsForEvents(eids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const stats = useMemo(() => {
    const total = apps.length;
    let submitted = 0;
    let drafts = 0;

    for (const a of apps) {
      const st = normalizeStatus(a.status);
      if (st === "draft") drafts += 1;
      else submitted += 1;
    }

    return { total, submitted, drafts };
  }, [apps]);

  const topApps = useMemo(() => {
    const list = apps.slice();
    list.sort((a, b) => {
      const ta = new Date(a.submitted_at || a.updated_at || 0).getTime();
      const tb = new Date(b.submitted_at || b.updated_at || 0).getTime();
      return tb - ta;
    });
    return list.slice(0, 3);
  }, [apps]);

  function boothDisplay(eventId?: string, boothId?: string | null) {
    const eid = String(eventId || "").trim();
    const bid = String(boothId || "").trim();
    const label = eid && bid ? boothLabelsByEvent[eid]?.[bid] : "";
    if (label) return label;
    if (!bid) return "";
    return `Booth ${shortBoothId(bid)}`;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">
              Vendor Dashboard
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              Server-synced overview of your applications.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => nav("/vendor/events")}
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-violet-700"
              type="button"
            >
              Browse Events
            </button>
          </div>
        </div>

        {/* Status banner */}
        <div className="mt-6">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">
              Loading dashboard…
            </div>
          ) : err ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
              {err}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Loaded server applications:{" "}
              <span className="font-black">{apps.length}</span>
            </div>
          )}
        </div>

        {/* Stat cards */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-bold text-slate-600">
              Total Applications
            </div>
            <div className="mt-2 text-3xl font-black text-slate-900">
              {stats.total}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-bold text-slate-600">Submitted</div>
            <div className="mt-2 text-3xl font-black text-slate-900">
              {stats.submitted}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-bold text-slate-600">Drafts</div>
            <div className="mt-2 text-3xl font-black text-slate-900">
              {stats.drafts}
            </div>
          </div>
        </div>

        {/* My Applications */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xl font-black text-slate-900">
                My Applications
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Drafts and submissions
              </div>
            </div>

            <Link
              to="/vendor/applications"
              className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-extrabold text-violet-700 hover:bg-violet-50"
            >
              View All →
            </Link>
          </div>

          {loading ? (
            <div className="mt-6 text-sm font-semibold text-slate-700">
              Loading…
            </div>
          ) : apps.length === 0 ? (
            <div className="mt-8 text-center">
              <div className="text-sm font-semibold text-slate-600">
                No applications yet
              </div>
              <button
                type="button"
                onClick={() => nav("/vendor/events")}
                className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-violet-700"
              >
                Browse Events
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {topApps.map((a, idx) => {
                const eventId = String(a.event_id ?? "");
                const boothId = a.booth_id ? String(a.booth_id) : "";
                const st = normalizeStatus(a.status);
                const { done, total, pct } = calcCompletion(a);

                const viewUrl = eventId
                  ? `/vendor/events/${eventId}/apply?` +
                    new URLSearchParams({
                      ...(a.app_ref ? { appId: String(a.app_ref) } : {}),
                      ...(boothId ? { boothId } : {}),
                    }).toString()
                  : "/vendor/applications";

                return (
                  <div
                    key={`${a.id ?? idx}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-black text-slate-900">
                          Event #{eventId || "—"}
                          {boothId ? (
                            <span className="ml-2 text-sm font-extrabold text-slate-500">
                              • {boothDisplay(eventId, boothId)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          Last updated: {formatDate(a.updated_at)}
                          {a.submitted_at ? (
                            <span className="ml-2">
                              • Submitted: {formatDate(a.submitted_at)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={
                            "rounded-full px-3 py-1 text-xs font-extrabold " +
                            (st === "approved"
                              ? "bg-emerald-50 text-emerald-700"
                              : st === "rejected"
                              ? "bg-rose-50 text-rose-700"
                              : st === "draft"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-violet-50 text-violet-700")
                          }
                        >
                          {st === "approved"
                            ? "Approved"
                            : st === "rejected"
                            ? "Rejected"
                            : st === "draft"
                            ? "Draft"
                            : "Submitted"}
                        </span>

                        <div className="text-sm font-extrabold text-slate-700">
                          {pct}%{" "}
                          <span className="font-semibold text-slate-500">
                            ({done}/{total})
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-2 rounded-full bg-violet-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        to={viewUrl}
                        className="rounded-full bg-violet-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-violet-700"
                      >
                        View
                      </Link>

                      {eventId ? (
                        <Link
                          to={`/vendor/events/${eventId}`}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                        >
                          View Event
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
