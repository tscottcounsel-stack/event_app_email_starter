// vendor-portal/src/pages/OrganizerApplicationsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

type OrganizerApp = {
  id: number;
  event_id?: number;

  vendor_id?: number | string | null;
  vendor_email?: string | null;
  vendor_company_name?: string | null;
  vendor_display_name?: string | null;

  status?: string; // "draft" | "submitted" | "approved" | "rejected"
  payment_status?: string | null; // "unpaid" | "paid" | "pending" | ...
  booth_id?: string | null;
  booth_reserved_until?: string | null;

  created_at?: string;
  updated_at?: string;

  // Anything else is fine
  [k: string]: any;
};

type CanonStatus = "draft" | "submitted" | "approved" | "rejected" | "unknown";

function normalizeStatus(s: any): CanonStatus {
  const v = String(s || "").trim().toLowerCase();
  if (v === "draft") return "draft";
  if (v === "submitted") return "submitted";
  if (v === "approved") return "approved";
  if (v === "rejected") return "rejected";
  return "unknown";
}

function normalizePaymentStatus(s: any): "paid" | "unpaid" | "pending" | "unknown" {
  const v = String(s || "").trim().toLowerCase();
  if (v === "paid") return "paid";
  if (v === "unpaid") return "unpaid";
  if (v === "pending") return "pending";
  if (!v) return "unknown";
  return "unknown";
}

function safeDateLabel(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function isFutureIso(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function statusPill(s: any) {
  const v = normalizeStatus(s);
  const base = "inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold";
  if (v === "draft") return `${base} border-slate-200 text-slate-700 bg-slate-50`;
  if (v === "submitted") return `${base} border-blue-200 text-blue-800 bg-blue-50`;
  if (v === "approved") return `${base} border-emerald-200 text-emerald-800 bg-emerald-50`;
  if (v === "rejected") return `${base} border-rose-200 text-rose-800 bg-rose-50`;
  return `${base} border-slate-200 text-slate-600 bg-white`;
}

function paymentPill(paymentStatus: any) {
  const v = normalizePaymentStatus(paymentStatus);
  const base = "inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold";
  if (v === "paid") return { klass: `${base} border-emerald-200 bg-emerald-50 text-emerald-800`, label: "Paid" };
  if (v === "pending") return { klass: `${base} border-amber-200 bg-amber-50 text-amber-800`, label: "Payment pending" };
  if (v === "unpaid") return { klass: `${base} border-slate-200 bg-white text-slate-700`, label: "Unpaid" };
  return { klass: `${base} border-slate-200 bg-white text-slate-600`, label: "Payment —" };
}

function pipelinePill(app: OrganizerApp) {
  // Pipeline: Applied (submitted) -> Approved -> Booth Assigned (booth_id) -> Paid
  const st = normalizeStatus(app.status);
  const pay = normalizePaymentStatus(app.payment_status);
  const hasBooth = !!String(app.booth_id || "").trim();

  const base = "inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold";

  if (st === "rejected") return { label: "Rejected", klass: `${base} border-rose-200 bg-rose-50 text-rose-800` };
  if (st === "draft") return { label: "Draft", klass: `${base} border-slate-200 bg-slate-50 text-slate-700` };

  if (st === "approved" && pay === "paid") {
    return { label: "Paid", klass: `${base} border-emerald-200 bg-emerald-50 text-emerald-800` };
  }
  if (st === "approved" && hasBooth) {
    return { label: "Booth Assigned", klass: `${base} border-indigo-200 bg-indigo-50 text-indigo-800` };
  }
  if (st === "approved") {
    return { label: "Approved", klass: `${base} border-emerald-200 bg-emerald-50 text-emerald-800` };
  }
  if (st === "submitted") {
    return { label: "Applied", klass: `${base} border-blue-200 bg-blue-50 text-blue-800` };
  }

  return { label: "—", klass: `${base} border-slate-200 bg-white text-slate-600` };
}

export default function OrganizerApplicationsPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { eventId } = useParams<{ eventId: string }>();

  const eid = String(eventId || "").trim();

  const [apps, setApps] = useState<OrganizerApp[]>([]);
  const [boothLabelMap, setBoothLabelMap] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "submitted" | "approved" | "rejected" | "draft"
  >("all");

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = useMemo(() => {
    const s = readSession();
    const token = s?.access_token;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }, []);

  async function fetchApps() {
    if (!eid) {
      setApps([]);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(
        `${API_BASE}/organizer/events/${encodeURIComponent(eid)}/applications`,
        {
          headers: authHeaders,
        }
      );

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed to load applications (${res.status})`);
      }

      const data = await res.json();
      const list =
        Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.applications)
          ? (data as any).applications
          : Array.isArray((data as any)?.items)
          ? (data as any).items
          : Array.isArray((data as any)?.results)
          ? (data as any).results
          : [];

      setApps(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Failed to load applications");
      setApps([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDiagram() {
    if (!eid) {
      setBoothLabelMap({});
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/events/${encodeURIComponent(String(eid))}/diagram`,
        {
          headers: authHeaders,
        }
      );

      if (!res.ok) {
        // Diagram is optional for this page; don't fail the entire view.
        setBoothLabelMap({});
        return;
      }

      const data = await res.json();

      const map: Record<string, string> = {};

      const scan = (obj: any) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(scan);
          return;
        }
        if (typeof obj === "object") {
          // Booth nodes usually have id + label
          if (typeof obj.id === "string" && typeof obj.label === "string") {
            map[obj.id] = obj.label;
          }
          Object.values(obj).forEach(scan);
        }
      };

      scan(data);
      setBoothLabelMap(map);
    } catch (e) {
      console.error("diagram parse error", e);
      setBoothLabelMap({});
    }
  }

  useEffect(() => {
    fetchApps();
    fetchDiagram();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  // Refresh if navigated back here (common after assignment).
  useEffect(() => {
    const qs = new URLSearchParams(loc.search);
    if (qs.get("refresh") === "1") fetchApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  async function approveApp(appId: number) {
    const res = await fetch(
      `${API_BASE}/organizer/applications/${encodeURIComponent(String(appId))}/approve`,
      {
        method: "POST",
        headers: authHeaders,
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `Approve failed (${res.status})`);
    }
    return res.json();
  }

  async function rejectApp(appId: number) {
    const res = await fetch(
      `${API_BASE}/organizer/applications/${encodeURIComponent(String(appId))}/reject`,
      {
        method: "POST",
        headers: authHeaders,
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `Reject failed (${res.status})`);
    }
    return res.json();
  }

  async function deleteApp(appId: number) {
    const res = await fetch(
      `${API_BASE}/organizer/applications/${encodeURIComponent(String(appId))}`,
      {
        method: "DELETE",
        headers: authHeaders,
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `Delete failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  }

  async function refresh() {
    await fetchApps();
    await fetchDiagram();
  }

  async function onApprove(appId: number) {
    if (!window.confirm("Approve this vendor application?")) return;
    try {
      await approveApp(appId);
      await refresh();
    } catch (e: any) {
      window.alert(e?.message ? String(e.message) : "Approve failed");
    }
  }

  async function onReject(appId: number) {
    if (!window.confirm("Reject this vendor application?")) return;
    try {
      await rejectApp(appId);
      await refresh();
    } catch (e: any) {
      window.alert(e?.message ? String(e.message) : "Reject failed");
    }
  }

  async function onDelete(appId: number) {
    if (!window.confirm("Delete this application?")) return;
    try {
      await deleteApp(appId);
      await refresh();
    } catch (e: any) {
      window.alert(e?.message ? String(e.message) : "Delete failed");
    }
  }

  // Policy 2: backend cleans expired holds on load; we treat expiration client-side too.
  function isReservationExpired(app: OrganizerApp) {
    // If a booth is already assigned, do NOT treat it as expired just because a timestamp is missing.
    if (app.booth_id) return false;

    const until = app.booth_reserved_until || null;

    // No timestamp + no booth assignment => no active hold (so Reserve is available)
    if (!until) return true;

    return !isFutureIso(until);
  }

  function boothDisplayLabel(boothId?: string | null) {
    if (!boothId) return "—";
    const label = boothLabelMap[boothId];
    return label || "Booth selected";
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (apps || [])
      .filter((a) => {
        const st = normalizeStatus(a.status);
        if (statusFilter !== "all" && st !== statusFilter) return false;
        if (!q) return true;

        const hay = [
          a.vendor_company_name,
          a.vendor_display_name,
          a.vendor_email,
          String(a.id),
          String(a.vendor_id ?? ""),
          // avoid leaking raw booth_id as the primary search surface, but allow it if pasted
          String(a.booth_id ?? ""),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(q);
      })
      .sort((a, b) => {
        const at = new Date(a.updated_at || a.created_at || 0).getTime();
        const bt = new Date(b.updated_at || b.created_at || 0).getTime();
        return bt - at;
      });
  }, [apps, search, statusFilter]);

  // Protected organizer route for reviewing a single application.
  function goPreview(appId: number | string) {
    nav(
      `/organizer/events/${encodeURIComponent(eid)}/application/${encodeURIComponent(
        String(appId)
      )}`
    );
  }

  function goAssign(app: OrganizerApp, action: "reserve" | "change") {
    const qs = new URLSearchParams();
    qs.set("assignAppId", String(app.id));
    qs.set("assignAction", action);
    nav(`/organizer/events/${encodeURIComponent(eid)}/layout?${qs.toString()}`);
  }

  const summary = useMemo(() => {
    const total = (apps || []).length;
    const submitted = (apps || []).filter((a) => normalizeStatus(a.status) === "submitted").length;
    const approved = (apps || []).filter((a) => normalizeStatus(a.status) === "approved").length;
    const rejected = (apps || []).filter((a) => normalizeStatus(a.status) === "rejected").length;
    const paid = (apps || []).filter((a) => normalizePaymentStatus(a.payment_status) === "paid").length;
    const withBooth = (apps || []).filter((a) => !!String(a.booth_id || "").trim()).length;
    return { total, submitted, approved, rejected, paid, withBooth };
  }, [apps]);

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Applications</h1>
            <p className="text-sm text-slate-600">
              Review vendors, approve/reject, and assign booths. Event ID:{" "}
              <span className="font-mono">{eid || "—"}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-slate-200 bg-white text-slate-700")}>
                Total: {summary.total}
              </span>
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-blue-200 bg-blue-50 text-blue-800")}>
                Applied: {summary.submitted}
              </span>
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-emerald-200 bg-emerald-50 text-emerald-800")}>
                Approved: {summary.approved}
              </span>
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-indigo-200 bg-indigo-50 text-indigo-800")}>
                Booth assigned: {summary.withBooth}
              </span>
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-emerald-200 bg-emerald-50 text-emerald-800")}>
                Paid: {summary.paid}
              </span>
              <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-xs font-extrabold", "border-rose-200 bg-rose-50 text-rose-800")}>
                Rejected: {summary.rejected}
              </span>
            </div>
          </div>

          <button
            onClick={() => refresh()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="draft">Draft</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600">Search</label>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Vendor name, email, booth..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm md:w-80"
              />
            </div>
          </div>
        </div>

        {err ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {err}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          {/* Header row */}
          <div className="grid grid-cols-12 gap-2 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600">
            <div className="col-span-2">Vendor</div>
            <div className="col-span-2">Pipeline</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Booth</div>
            <div className="col-span-1">Updated</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-600">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-slate-600">No applications found.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filtered.map((app) => {
                const vendorLabel =
                  app.vendor_company_name ||
                  app.vendor_display_name ||
                  app.vendor_email ||
                  `Vendor ${String(app.vendor_id || "").trim() || "—"}`;

                const st = normalizeStatus(app.status);
                const hasBooth = Boolean(app.booth_id);
                const expired = isReservationExpired(app);

                const pipe = pipelinePill(app);
                const pay = paymentPill(app.payment_status);

                return (
                  <div key={app.id} className="grid grid-cols-12 gap-2 px-4 py-4 text-sm">
                    {/* Vendor */}
                    <div className="col-span-2">
                      <div className="font-extrabold">{vendorLabel}</div>
                      <div className="text-xs text-slate-600">{app.vendor_email || "—"}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        App #{app.id}
                      </div>
                    </div>

                    {/* Pipeline */}
                    <div className="col-span-2">
                      <span className={pipe.klass}>{pipe.label}</span>
                      <div className="mt-2">
                        <span className={pay.klass}>{pay.label}</span>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <span className={statusPill(st)}>{st}</span>
                      {app.booth_id ? (
                        <div className="mt-2 text-xs text-slate-600">
                          Booth: <span className="font-semibold">{boothDisplayLabel(app.booth_id)}</span>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-slate-500">No booth assigned</div>
                      )}
                    </div>

                    {/* Booth */}
                    <div className="col-span-2">
                      <div className="font-semibold">{boothDisplayLabel(app.booth_id)}</div>
                      <div className="text-xs text-slate-600">
                        Hold until:{" "}
                        {app.booth_reserved_until ? safeDateLabel(app.booth_reserved_until) : "—"}
                      </div>
                      {!hasBooth && expired ? (
                        <div className="mt-1 text-xs font-bold text-amber-700">Hold expired</div>
                      ) : null}
                    </div>

                    {/* Updated */}
                    <div className="col-span-1 text-xs text-slate-700">
                      {safeDateLabel(app.updated_at || app.created_at)}
                    </div>

                    {/* Actions */}
                    <div className="col-span-3 flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => goPreview(app.id)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold hover:bg-slate-50"
                      >
                        View App
                      </button>

                      {st === "submitted" ? (
                        <>
                          <button
                            onClick={() => onApprove(app.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => onReject(app.id)}
                            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-700"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}

                      {st === "approved" ? (
                        <>
                          {!hasBooth || expired ? (
                            <button
                              onClick={() => goAssign(app, "reserve")}
                              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-blue-700"
                            >
                              Reserve Booth
                            </button>
                          ) : (
                            <button
                              onClick={() => goAssign(app, "change")}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-800 hover:bg-blue-100"
                              title="Change booth assignment"
                            >
                              Change Booth
                            </button>
                          )}
                        </>
                      ) : null}

                      <button
                        onClick={() => onDelete(app.id)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 text-xs text-slate-500">
          Tip: After assigning a booth, return here and hit{" "}
          <span className="font-bold">Refresh</span> to confirm pipeline + payment.
        </div>
      </div>
    </div>
  );
}
