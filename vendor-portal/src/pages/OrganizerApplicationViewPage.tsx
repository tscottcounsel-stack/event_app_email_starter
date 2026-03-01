import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as ApplicationsAPI from "../components/api/applications";

type DocMeta = {
  name?: string;
  size?: number;
  type?: string;
  lastModified?: number;
};

function chipClass(kind: "neutral" | "good" | "bad" | "warn") {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";
  if (kind === "good") return `${base} border-green-200 bg-green-50 text-green-800`;
  if (kind === "bad") return `${base} border-red-200 bg-red-50 text-red-800`;
  if (kind === "warn") return `${base} border-amber-200 bg-amber-50 text-amber-900`;
  return `${base} border-gray-200 bg-gray-50 text-gray-800`;
}

function normalizeStatus(s?: string | null) {
  const v = String(s ?? "").toLowerCase().trim();
  return v || "draft";
}

function normalizePayment(s?: string | null) {
  const v = String(s ?? "").toLowerCase().trim();
  return v || "unpaid";
}

function countChecked(checked?: Record<string, boolean> | null) {
  if (!checked) return { done: 0, total: 0 };
  const keys = Object.keys(checked);
  const done = keys.reduce((acc, k) => acc + (checked[k] ? 1 : 0), 0);
  return { done, total: keys.length };
}

function docsToList(app: ApplicationsAPI.ServerApplication) {
  const d = ((app.documents ?? app.docs) || {}) as Record<string, DocMeta | DocMeta[] | null>;
  return Object.entries(d)
    .filter(([, v]) => !!v)
    .map(([key, v]) => {
      const meta = Array.isArray(v) ? v[0] : v;
      return {
        key,
        name: meta?.name || key,
        size: meta?.size,
        type: meta?.type,
        lastModified: meta?.lastModified,
      };
    });
}

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  const shown = idx === 0 ? String(Math.round(val)) : val.toFixed(1);
  return `${shown} ${units[idx]}`;
}

export default function OrganizerApplicationViewPage() {
  const nav = useNavigate();
  const { eventId, appId } = useParams();

  const eid = String(eventId ?? "").trim();
  const aid = String(appId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [app, setApp] = useState<ApplicationsAPI.ServerApplication | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        if (!eid || !aid) throw new Error("Missing eventId or appId in route.");
        const a = await ApplicationsAPI.organizerGetApplication({ eventId: eid, appId: aid });
        if (!cancelled) setApp(a);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ? String(e.message) : "Failed to load application");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [eid, aid]);

  const status = normalizeStatus(app?.status);
  const payment = normalizePayment(app?.payment_status);
  const checkedCounts = useMemo(() => countChecked(app?.checked), [app?.checked]);
  const docs = useMemo(() => (app ? docsToList(app) : []), [app]);

  const vendorId = String(app?.vendor_id ?? "").trim();
  const vendorEmail = String(app?.vendor_email ?? "").trim();

  const profileHref = vendorId
    ? `/organizer/vendors/${encodeURIComponent(vendorId)}`
    : vendorEmail
      ? `/organizer/vendors/${encodeURIComponent(vendorEmail)}`
      : "";

  function statusChip() {
    if (status === "approved") return <span className={chipClass("good")}>approved</span>;
    if (status === "rejected") return <span className={chipClass("bad")}>rejected</span>;
    if (status === "submitted") return <span className={chipClass("warn")}>submitted</span>;
    return <span className={chipClass("neutral")}>draft</span>;
  }

  function paymentChip() {
    if (payment === "paid") return <span className={chipClass("good")}>paid</span>;
    return <span className={chipClass("warn")}>unpaid</span>;
  }

  async function onApprove() {
    if (!app) return;

    try {
      setBusy("approve");
      setErr(null);

      const updated = await ApplicationsAPI.organizerApproveApplication({ appId: app.id });
      setApp(updated);

      const vendorCtx = String(updated.vendor_id || updated.vendor_email || "").trim();
      const qs = new URLSearchParams();
      qs.set("appId", String(updated.id));
      if (vendorCtx) qs.set("vendorId", vendorCtx);

      nav(`/organizer/events/${encodeURIComponent(eid)}/layout?${qs.toString()}`);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  async function onReject() {
    if (!app) return;

    try {
      setBusy("reject");
      setErr(null);

      const updated = await ApplicationsAPI.organizerRejectApplication({ appId: app.id });
      setApp(updated);

      nav(`/organizer/events/${encodeURIComponent(eid)}/applications`);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Reject failed");
    } finally {
      setBusy(null);
    }
  }

  function onAssignBooth() {
    if (!app) return;

    const vendorCtx = String(app.vendor_id || app.vendor_email || "").trim();
    const qs = new URLSearchParams();
    qs.set("appId", String(app.id));
    if (vendorCtx) qs.set("vendorId", vendorCtx);

    nav(`/organizer/events/${encodeURIComponent(eid)}/layout?${qs.toString()}`);
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">
              <Link className="hover:underline" to={`/organizer/events/${encodeURIComponent(eid)}/applications`}>
                Applications
              </Link>{" "}
              <span className="mx-2">/</span>
              <span>Application #{aid}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-900">Application Details</h1>
          </div>

          <div className="flex gap-2">
            {profileHref ? (
              <Link
                to={profileHref}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
              >
                View Vendor Profile
              </Link>
            ) : (
              <button
                disabled
                className="cursor-not-allowed rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-400"
              >
                View Vendor Profile
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">Loading…</div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</div>
        ) : !app ? (
          <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">No application found.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {statusChip()}
                  {paymentChip()}
                  <span className="text-xs text-gray-500">
                    app_id: <span className="font-mono">{app.id}</span> • event_id:{" "}
                    <span className="font-mono">{app.event_id}</span>
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Vendor Email</div>
                    <div className="mt-1 text-sm text-gray-900">{vendorEmail || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Vendor ID</div>
                    <div className="mt-1 text-sm text-gray-900">{vendorId || "—"}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Compliance</div>
                    <div className="mt-1 text-sm text-gray-900">
                      {checkedCounts.done}/{checkedCounts.total} checked
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Documents</div>
                    <div className="mt-1 text-sm text-gray-900">{docs.length} uploaded</div>
                  </div>
                </div>

                {app.notes ? (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-gray-500">Notes</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
                      {app.notes}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="mb-2 text-sm font-semibold text-gray-900">Uploaded Documents</div>
                {docs.length === 0 ? (
                  <div className="text-sm text-gray-600">No documents uploaded.</div>
                ) : (
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {docs.map((d) => (
                      <div key={d.key} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">{d.name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {d.type ? d.type : "—"}
                            {d.size ? ` • ${formatBytes(d.size)}` : ""}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{d.key}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 p-4">
                <div className="mb-3 text-sm font-semibold text-gray-900">Actions</div>

                <button
                  onClick={onApprove}
                  disabled={busy !== null || status === "approved"}
                  className="w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "approve" ? "Approving…" : status === "approved" ? "Approved" : "Approve"}
                </button>

                <button
                  onClick={onReject}
                  disabled={busy !== null || status === "rejected"}
                  className="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "reject" ? "Rejecting…" : status === "rejected" ? "Rejected" : "Reject"}
                </button>

                <button
                  onClick={onAssignBooth}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Assign Booth
                </button>

                <div className="mt-3 text-xs text-gray-500">
                  Approve redirects to the booth map editor with app context.
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-900">Debug</div>
                <div className="mt-2 text-xs text-gray-600">
                  status: <span className="font-mono">{status}</span>
                  <br />
                  payment_status: <span className="font-mono">{payment}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
