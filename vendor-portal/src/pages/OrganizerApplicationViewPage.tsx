import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as ApplicationsAPI from "../components/api/applications";

type DocMeta = {
  name?: string;
  size?: number;
  type?: string;
  lastModified?: number;
};

type DiagramDoc = {
  levels?: Array<{
    id: string;
    name: string;
    booths: Array<{ id: string; label?: string }>;
    elements?: any[];
  }>;
  booths?: Array<{ id: string; label?: string }>; // legacy
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

function parseDateMaybe(s?: string | null) {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDateTimeLocal(d: Date | null) {
  if (!d) return "—";
  try {
    return d.toLocaleString();
  } catch {
    return d.toISOString();
  }
}

function minsUntil(d: Date | null) {
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  return Math.floor(ms / 60000);
}

function shortenId(id: string, head = 14, tail = 4) {
  const v = String(id || "").trim();
  if (!v) return "—";
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

function safeJsonParse<T = any>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function lsDiagramKey(eventId: string) {
  return `event:${String(eventId)}:diagram`;
}

function getBoothLabelFromCachedDiagram(eventId: string, boothId: string): string | null {
  const cached = safeJsonParse<any>(localStorage.getItem(lsDiagramKey(eventId)));
  const doc = (cached?.diagram ?? null) as DiagramDoc | null;
  if (!doc) return null;

  const target = String(boothId || "").trim();
  if (!target) return null;

  if (Array.isArray(doc.levels) && doc.levels.length) {
    for (const lvl of doc.levels) {
      const booths = Array.isArray(lvl?.booths) ? lvl.booths : [];
      const hit = booths.find((b) => String((b as any)?.id) === target);
      const label = hit?.label ? String(hit.label).trim() : "";
      if (label) return label;
    }
  }

  if (Array.isArray(doc.booths) && doc.booths.length) {
    const hit = doc.booths.find((b) => String((b as any)?.id) === target);
    const label = hit?.label ? String(hit.label).trim() : "";
    if (label) return label;
  }

  return null;
}

export default function OrganizerApplicationViewPage() {
  const nav = useNavigate();
  const { eventId, appId, applicationId } = useParams();

  const eid = String(eventId ?? "").trim();
  const aid = String(appId ?? applicationId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [app, setApp] = useState<ApplicationsAPI.ServerApplication | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);


  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        if (!eid || !aid) throw new Error("Missing eventId or application id in route.");
        const a = await ApplicationsAPI.organizerGetApplication({ eventId: eid, appId: aid } as any);
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
  const payment = normalizePayment((app as any)?.payment_status);
  const docs = useMemo(() => (app ? docsToList(app) : []), [app]);

  const vendorId = String((app as any)?.vendor_id ?? "").trim();
  const vendorEmail = String((app as any)?.vendor_email ?? "").trim();

  const requestedBoothId = String((app as any)?.requested_booth_id ?? "").trim();
  const boothId = String((app as any)?.booth_id ?? "").trim();

  const boothReservedUntilRaw = String((app as any)?.booth_reserved_until ?? "").trim();
  const boothReservedUntil = useMemo(() => parseDateMaybe(boothReservedUntilRaw), [boothReservedUntilRaw]);

  const requestedBoothDisplay = requestedBoothId || boothId || "None requested";
  const assignedBoothDisplay = boothId || "Not assigned yet";
  const holdMins = useMemo(() => minsUntil(boothReservedUntil), [boothReservedUntil]);
  const holdActive = typeof holdMins === "number" ? holdMins > 0 : false;

  const boothLabel = useMemo(() => {
    if (!eid || !boothId) return null;
    return getBoothLabelFromCachedDiagram(eid, boothId);
  }, [eid, boothId]);

  // Vendor profile route fallback order:
  // 1) vendor_id
  // 2) vendor_email
  // 3) app.id (last-resort legacy fallback)
  //
  // Current App.tsx route:
  // /organizer/events/:eventId/vendor/:vendorId
  const vendorProfileKey = vendorId || "";

  const profileHref =
    eid && vendorProfileKey
    ? `/organizer/events/${encodeURIComponent(eid)}/vendor/${encodeURIComponent(vendorProfileKey)}`
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

  function boothChip() {
    if (!boothId) return <span className={chipClass("neutral")}>no booth</span>;
    if (holdActive) return <span className={chipClass("warn")}>held</span>;
    return <span className={chipClass("neutral")}>assigned</span>;
  }

  function gotoAssignBooth(appIdForAssign: string | number) {
    const qs = new URLSearchParams();
    qs.set("assignAppId", String(appIdForAssign));
    qs.set("assignAction", "assign");
    nav(`/organizer/events/${encodeURIComponent(eid)}/layout?${qs.toString()}`);
  }

  async function onApprove() {
    if (!app) return;

    try {
      setBusy("approve");
      setErr(null);

      // If already approved, skip API call and go straight to assign
      if (normalizeStatus((app as any)?.status) === "approved") {
        gotoAssignBooth((app as any).id);
        return;
      }

      const updated = await ApplicationsAPI.organizerApproveApplication({ appId: (app as any).id });
      setApp(updated);

      gotoAssignBooth((updated as any).id);
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

      const updated = await ApplicationsAPI.organizerRejectApplication({ appId: (app as any).id });
      setApp(updated);

      nav(`/organizer/events/${encodeURIComponent(eid)}/applications`);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Reject failed");
    } finally {
      setBusy(null);
    }
  }


  async function submitReview() {
    if (!vendorId) return;
    try {
      setReviewBusy(true);
      const res = await fetch(`/reviews?vendor_id=${encodeURIComponent(vendorId)}&rating=${reviewRating}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: reviewComment, event_id: eid }),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      setReviewDone(true);
      setShowReview(false);
    } catch (e) {
      alert("Review failed");
    } finally {
      setReviewBusy(false);
    }
  }

  function onAssignBooth() {
    if (!app) return;
    gotoAssignBooth((app as any).id);
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
                title="Vendor profile is unavailable because this application has no vendor id or vendor email yet."
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
                  {boothChip()}
                  <span className="text-xs text-gray-500">
                    app_id: <span className="font-mono">{(app as any).id}</span> • event_id:{" "}
                    <span className="font-mono">{(app as any).event_id}</span>
                  </span>
                </div>

                                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Requirements</div>
                    <div className="mt-1 text-sm text-gray-900">
                      {status === "submitted" || status === "approved"
                        ? "Completed before submission"
                        : status === "rejected"
                        ? "Submitted previously"
                        : "Not submitted yet"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-500">Submission Readiness</div>
                    <div className="mt-1 text-sm text-gray-900">
                      {status === "submitted" || status === "approved"
                        ? "Ready package received"
                        : status === "rejected"
                        ? "Previously submitted"
                        : "In progress"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Compliance</div>
                    <div className="mt-1 text-sm text-gray-900">
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Documents</div>
                    <div className="mt-1 text-sm text-gray-900">{docs.length} uploaded</div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900">Booth Details</div>
                    <div className="text-xs text-gray-600">
                      {boothLabel ? (
                        <span className="font-semibold text-gray-900">{boothLabel}</span>
                      ) : boothId ? (
                        <span title={boothId} className="font-mono">
                          {shortenId(boothId)}
                        </span>
                      ) : (
                        <span className="text-gray-500">Not assigned</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold text-amber-600">Requested Booth</div>
                      <div className="mt-0.5 text-sm text-gray-900">
                        {requestedBoothId || boothId || "None requested"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-blue-600">Assigned Booth</div>
                      <div className="mt-0.5 text-sm text-gray-900">{boothId || "Not assigned yet"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Hold Expires</div>
                      <div className="mt-0.5 text-sm text-gray-900">{formatDateTimeLocal(boothReservedUntil)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500">Hold Status</div>
                      <div className="mt-0.5 text-sm text-gray-900">
                        {!boothId ? (
                          <span className={chipClass("neutral")}>none</span>
                        ) : holdActive ? (
                          <span className="inline-flex items-center gap-2">
                            <span className={chipClass("warn")}>active</span>
                            <span className="text-xs text-gray-600">
                              {typeof holdMins === "number" ? `${Math.max(holdMins, 0)} min left` : ""}
                            </span>
                          </span>
                        ) : (
                          <span className={chipClass("neutral")}>inactive</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {boothLabel && boothId ? (
                    <div className="mt-2 text-xs text-gray-500">
                      booth_id:{" "}
                      <span className="font-mono" title={boothId}>
                        {shortenId(boothId, 18, 6)}
                      </span>
                    </div>
                  ) : null}
                </div>

                {(app as any).notes ? (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-gray-500">Notes</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
                      {(app as any).notes}
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
                  {busy === "approve" ? "Approving…" : status === "approved" ? "Approved" : "Approve Requested Booth"}
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

                <button
                  onClick={() => setShowReview(true)}
                  className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Leave Review
                </button>

                <div className="mt-3 text-xs text-gray-500">
                  Approve opens the booth picker for this application. Vendor profile opens organizer-safe preview.
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-900">Debug</div>
                <div className="mt-2 text-xs text-gray-600">
                  status: <span className="font-mono">{status}</span>
                  <br />
                  payment_status: <span className="font-mono">{payment}</span>
                  <br />
                  booth_id:{" "}
                  <span className="font-mono" title={boothId || ""}>
                    {boothId || "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-3">Leave Review</h2>

            <div className="mb-3">
              <label className="text-sm font-semibold">Rating</label>
              <select
                value={reviewRating}
                onChange={(e) => setReviewRating(Number(e.target.value))}
                className="mt-1 w-full border rounded px-2 py-1"
              >
                {[5,4,3,2,1].map(v => <option key={v} value={v}>{v} Stars</option>)}
              </select>
            </div>

            <div className="mb-3">
              <label className="text-sm font-semibold">Comment</label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                className="mt-1 w-full border rounded px-2 py-1"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowReview(false)} className="px-3 py-1 border rounded">
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={reviewBusy}
                className="px-3 py-1 bg-indigo-600 text-white rounded"
              >
                {reviewBusy ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

</div>
    </div>
  );
}





