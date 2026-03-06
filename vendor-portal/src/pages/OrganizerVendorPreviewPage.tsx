import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as ApplicationsAPI from "../components/api/applications";
import { buildAuthHeaders } from "../auth/authHeaders";

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

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

function chipClass(kind: "neutral" | "good" | "bad" | "warn") {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";
  if (kind === "good") return `${base} border-green-200 bg-green-50 text-green-800`;
  if (kind === "bad") return `${base} border-red-200 bg-red-50 text-red-800`;
  if (kind === "warn") return `${base} border-amber-200 bg-amber-50 text-amber-900`;
  return `${base} border-gray-200 bg-gray-50 text-gray-800`;
}

function normalizeStatus(s?: string | null) {
  const v = String(s ?? "").toLowerCase().trim();
  return v || "draft";
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

function findBoothLabel(diagram: any, boothId: string): string | null {
  if (!diagram || !boothId) return null;

  const levels = Array.isArray(diagram.levels) ? diagram.levels : [];
  if (levels.length) {
    for (const lvl of levels) {
      const booths = Array.isArray(lvl?.booths) ? lvl.booths : [];
      const hit = booths.find((b: any) => String(b?.id) === String(boothId));
      const label = hit?.label ? String(hit.label).trim() : "";
      if (label) return label;
    }
  }

  const legacy = Array.isArray(diagram.booths) ? diagram.booths : [];
  const hit = legacy.find((b: any) => String(b?.id) === String(boothId));
  const label = hit?.label ? String(hit.label).trim() : "";
  return label || null;
}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text || null;
  }
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

function docsToList(app: ApplicationsAPI.ServerApplication) {
  const d = (((app as any).documents ?? (app as any).docs) || {}) as Record<string, DocMeta | DocMeta[] | null>;
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

export default function OrganizerVendorPreviewPage() {
  const nav = useNavigate();
  const { eventId: routeEventId, vendorId: routeVendorId, applicationId } = useParams();
  const location = useLocation();

  const appId = String(applicationId ?? "").trim();
  const eventId = useMemo(() => {
    const fromRoute = String(routeEventId ?? "").trim();
    if (fromRoute) return fromRoute;
    const sp = new URLSearchParams(location.search);
    return String(sp.get("eventId") || "").trim();
  }, [location.search, routeEventId]);

  const routeVendorKey = String(routeVendorId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [app, setApp] = useState<ApplicationsAPI.ServerApplication | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const [boothLabel, setBoothLabel] = useState<string | null>(null);

  const boothId = String((app as any)?.booth_id ?? "").trim();
  const vendorId = String((app as any)?.vendor_id ?? "").trim();
  const vendorEmail = String((app as any)?.vendor_email ?? "").trim();

  useEffect(() => {
    let cancelled = false;

    async function loadBoothLabel(a: ApplicationsAPI.ServerApplication | null) {
      const booth = String((a as any)?.booth_id ?? "").trim();
      if (!booth) {
        if (!cancelled) setBoothLabel(null);
        return;
      }

      const cachedLabel = getBoothLabelFromCachedDiagram(eventId, booth);
      if (!cancelled) setBoothLabel(cachedLabel || null);

      if (!cachedLabel) {
        const res = await fetch(
          `${API_BASE}/events/${encodeURIComponent(String(eventId))}/diagram`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        const data = await readJson(res);
        const diagram = (data as any)?.diagram ?? data;
        const label = findBoothLabel(diagram, booth);
        if (!cancelled) setBoothLabel(label);
      }
    }

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        if (!eventId) throw new Error("Missing eventId.");

        let found: ApplicationsAPI.ServerApplication | null = null;

        if (appId) {
          found = await ApplicationsAPI.organizerGetApplication({ eventId, appId } as any);
        } else if (routeVendorKey) {
          const res = await fetch(
            `${API_BASE}/organizer/events/${encodeURIComponent(String(eventId))}/applications`,
            {
              method: "GET",
              headers: {
                ...buildAuthHeaders(),
                Accept: "application/json",
              },
            }
          );

          const data = await readJson(res);
          const rawApps = Array.isArray((data as any)?.applications)
            ? (data as any).applications
            : Array.isArray(data)
            ? data
            : [];

          const target = String(routeVendorKey).trim().toLowerCase();

          found =
            rawApps.find((row: any) => String(row?.vendor_id ?? "").trim().toLowerCase() === target) ||
            rawApps.find((row: any) => String(row?.vendor_email ?? "").trim().toLowerCase() === target) ||
            rawApps.find((row: any) => String(row?.id ?? "").trim().toLowerCase() === target) ||
            null;
        }

        if (!found) throw new Error("Vendor application not found.");

        if (cancelled) return;
        setApp(found);
        await loadBoothLabel(found);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ? String(e.message) : "Failed to load vendor preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, appId, routeVendorKey]);

  const status = normalizeStatus((app as any)?.status);
  const docs = useMemo(() => (app ? docsToList(app) : []), [app]);

  const boothReservedUntil = useMemo(
    () => parseDateMaybe(String((app as any)?.booth_reserved_until ?? "").trim()),
    [app]
  );

  function gotoAssignBooth(appIdForAssign: string | number) {
    const qs = new URLSearchParams();
    qs.set("assignAppId", String(appIdForAssign));
    qs.set("assignAction", "reserve");
    nav(`/organizer/events/${encodeURIComponent(eventId)}/layout?${qs.toString()}`);
  }

  async function onApprove() {
    if (!app) return;
    try {
      setBusy("approve");
      setErr(null);

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

      nav(`/organizer/events/${encodeURIComponent(eventId)}/applications`);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Reject failed");
    } finally {
      setBusy(null);
    }
  }

  const backToApplicationsHref = eventId
    ? `/organizer/events/${encodeURIComponent(eventId)}/applications`
    : "/organizer/events";

  return (
  <div className="min-h-screen bg-white">
    <div className="mx-auto max-w-6xl p-6">

      {/* (removed mb-6 header block here) */}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-semibold text-gray-900">Vendor Profile Preview</div>
            <div className="text-sm text-gray-500">
              App #{appId} • Event #{eventId || "—"}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => nav(-1)}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
            >
              Back
            </button>

            <Link
              to={backToApplicationsHref}
              className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Back to Applications
            </Link>

            <button
              type="button"
              disabled
              title="You are already viewing the organizer-safe vendor profile preview."
              className="cursor-default rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-500"
            >
              Vendor Profile
            </button>

            <button
              onClick={onApprove}
              disabled={busy !== null || loading || !app}
              className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve → Assign Booth"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-gray-200 p-6 text-sm text-gray-600">Loading…</div>
        ) : err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{err}</div>
        ) : !app ? (
          <div className="rounded-2xl border border-gray-200 p-6 text-sm text-gray-600">No application found.</div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={chipClass(status === "approved" ? "good" : status === "rejected" ? "bad" : status === "submitted" ? "warn" : "neutral")}>
                  {status}
                </span>
              </div>

              <div className="text-lg font-semibold text-gray-900">Overview</div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-semibold text-gray-600">Status:</span>{" "}
                    <span className="text-gray-900">{status}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Vendor ID:</span>{" "}
                    <span className="text-gray-900">{vendorId || "—"}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Submitted:</span>{" "}
                    <span className="text-gray-900">{String((app as any)?.submitted_at || "—")}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Ref:</span>{" "}
                    <span className="text-gray-900">—</span>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-semibold text-gray-600">Vendor Email:</span>{" "}
                    <span className="text-gray-900">{vendorEmail || "—"}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Booth:</span>{" "}
                    {boothLabel ? (
                      <span className="font-semibold text-gray-900">{boothLabel}</span>
                    ) : boothId ? (
                      <span className="font-mono text-gray-900" title={boothId}>
                        {boothId}
                      </span>
                    ) : (
                      <span className="text-gray-500">Not assigned</span>
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-600">Updated:</span>{" "}
                    <span className="text-gray-900">{String((app as any)?.updated_at || "—")}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={onReject}
                  disabled={busy !== null}
                  className="rounded-full border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>

                <button
                  onClick={() => app && gotoAssignBooth((app as any).id)}
                  className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Assign Booth
                </button>

                <button
                  onClick={() => window.location.reload()}
                  className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 p-6">
              <div className="text-lg font-semibold text-gray-900">Compliance</div>
              <div className="mt-3 text-sm text-gray-600">
                (Preserved card — hook up your compliance fields here.)
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 p-6">
              <div className="text-lg font-semibold text-gray-900">Uploaded Documents</div>
              {docs.length === 0 ? (
                <div className="mt-3 text-sm text-gray-600">No documents uploaded.</div>
              ) : (
                <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
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

            <div className="rounded-2xl border border-gray-200 p-6">
              <div className="text-lg font-semibold text-gray-900">Booth Hold</div>
              <div className="mt-3 text-sm text-gray-700">
                Hold Expires: <span className="font-semibold">{formatDateTimeLocal(boothReservedUntil)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
