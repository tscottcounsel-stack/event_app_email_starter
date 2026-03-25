// src/pages/OrganizerApplicationsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type ApplicationRow = {
  id: number;
  event_id?: number;
  vendor_company_name?: string;
  vendor_display_name?: string;
  vendor_name?: string;
  vendor_email?: string;
  status?: string;
  payment_status?: string;
  booth_id?: string | null;
  updated_at?: string;
  score?: number;
  score_tier?: string;
  score_reasons?: string[];
  compliance_complete?: boolean;
  documents_complete?: boolean;
  vendor_verification_status?: string;
  vendor_is_verified?: boolean;
  verified?: boolean;
  vendor_profile?: {
    verified?: boolean;
    is_verified?: boolean;
    verification_status?: string;
    verification?: { status?: string };
  };
};

function scorePill(score: number) {
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-sky-50 text-sky-700 border-sky-200";
  if (score >= 40) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function statusLabel(app: ApplicationRow) {
  const s = String(app.status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "submitted") return "Submitted";
  if (s === "rejected") return "Rejected";
  if (s === "draft") return "Draft";
  return s ? s.replace(/_/g, " ") : "Unknown";
}

function vendorLabel(app: ApplicationRow) {
  return (
    app.vendor_company_name ||
    app.vendor_display_name ||
    app.vendor_name ||
    app.vendor_email ||
    `Application #${app.id}`
  );
}

function isApprovedLikeStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  return s === "verified" || s === "approved" || s === "true" || s === "1";
}

function appIsVerified(app: ApplicationRow) {
  const status =
    app.vendor_verification_status ??
    app.vendor_profile?.verification_status ??
    app.vendor_profile?.verification?.status ??
    "";

  return !!(
    app.vendor_is_verified === true ||
    app.verified === true ||
    app.vendor_profile?.verified === true ||
    app.vendor_profile?.is_verified === true ||
    isApprovedLikeStatus(status)
  );
}

function verifiedBadgeClassName(compact = false) {
  return compact
    ? "inline-flex items-center gap-1.5 rounded-full border-2 border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-200 px-2.5 py-1 text-xs font-black text-amber-900 shadow-[0_2px_8px_rgba(245,158,11,0.16)]"
    : "inline-flex items-center gap-2 rounded-full border-2 border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-200 px-3 py-1 text-xs font-black text-amber-900 shadow-[0_3px_10px_rgba(245,158,11,0.18)]";
}

export default function OrganizerApplicationsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [items, setItems] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"score" | "updated">("score");
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(false);

  async function loadVendorVerificationStatuses(apps: ApplicationRow[]) {
    const uniqueEmails = Array.from(
      new Set(
        apps
          .map((app) => String(app.vendor_email || "").trim())
          .filter(Boolean)
      )
    );

    if (uniqueEmails.length === 0) return apps;

    const cache = new Map<string, { verified: boolean; status: string }>();

    await Promise.all(
      uniqueEmails.map(async (email) => {
        try {
          const res = await fetch(
            `${API_BASE}/vendors/by-email/${encodeURIComponent(email)}`,
            {
              headers: {
                ...buildAuthHeaders(),
                Accept: "application/json",
              },
            }
          );

          const data = await res.json().catch(() => null);
          if (!res.ok || !data) {
            cache.set(email, { verified: false, status: "" });
            return;
          }

          const src =
            data?.vendor_profile && typeof data.vendor_profile === "object"
              ? { ...data.vendor_profile, ...data }
              : data;

          const status = String(
            src?.verification_status ??
              src?.verification?.status ??
              src?.status ??
              ""
          );

          const verified = !!(
            src?.verified === true ||
            src?.is_verified === true ||
            isApprovedLikeStatus(status)
          );

          cache.set(email, { verified, status });
        } catch {
          cache.set(email, { verified: false, status: "" });
        }
      })
    );

    return apps.map((app) => {
      const email = String(app.vendor_email || "").trim();
      const match = email ? cache.get(email) : null;
      if (!match) return app;
      return {
        ...app,
        vendor_is_verified:
          app.vendor_is_verified ??
          app.verified ??
          app.vendor_profile?.verified ??
          match.verified,
        vendor_verification_status:
          app.vendor_verification_status ??
          app.vendor_profile?.verification_status ??
          match.status,
      };
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!eventId) {
        setError("Missing event id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `${API_BASE}/organizer/events/${encodeURIComponent(eventId)}/applications`,
          { headers: buildAuthHeaders() }
        );

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.detail || `Failed to load applications (${res.status})`);
        }

        const baseItems = Array.isArray(data?.applications) ? data.applications : [];
        const enrichedItems = await loadVendorVerificationStatuses(baseItems);

        if (!cancelled) setItems(enrichedItems);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load applications.");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = items.filter((app) => {
      const matchesQuery = !q
        ? true
        : [
            vendorLabel(app),
            app.vendor_email,
            app.booth_id,
            app.status,
            app.payment_status,
            ...(app.score_reasons || []),
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q));

      const matchesVerified = showVerifiedOnly ? appIsVerified(app) : true;

      return matchesQuery && matchesVerified;
    });

    const sorted = [...filtered];
    if (sortMode === "score") {
      sorted.sort((a, b) => {
        const verifiedDiff = Number(appIsVerified(b)) - Number(appIsVerified(a));
        if (verifiedDiff !== 0) return verifiedDiff;
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
    } else {
      sorted.sort((a, b) => {
        const verifiedDiff = Number(appIsVerified(b)) - Number(appIsVerified(a));
        if (verifiedDiff !== 0) return verifiedDiff;
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
    }
    return sorted;
  }, [items, query, sortMode, showVerifiedOnly]);

  const verifiedCount = useMemo(
    () => visible.filter((app) => appIsVerified(app)).length,
    [visible]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Applications</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Auto-sorted by fit score so the strongest vendors rise to the top.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(`/organizer/events/${eventId}/details`)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
          >
            Back to Event
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 text-sm font-bold text-emerald-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Verified vendors are highlighted throughout this list so you can spot trusted applicants faster.
          </span>
          <span className={verifiedBadgeClassName()}>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">
              ✓
            </span>
            {verifiedCount} verified
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendor, booth, status, or reason"
          className="min-w-[260px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
        />

        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as "score" | "updated")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
        >
          <option value="score">Sort by score</option>
          <option value="updated">Sort by latest update</option>
        </select>

        <label className="inline-flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-slate-800">
          <input
            type="checkbox"
            checked={showVerifiedOnly}
            onChange={(e) => setShowVerifiedOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Verified vendors only
        </label>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
          {visible.length} application{visible.length === 1 ? "" : "s"}
        </div>
      </div>

      {showVerifiedOnly ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          Showing verified vendors only.
        </div>
      ) : null}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600">
          Loading applications…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600">
          No applications found.
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((app) => (
            <div
              key={app.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-[240px]">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-lg font-black text-slate-900">
                      {vendorLabel(app)}
                    </div>
                    {appIsVerified(app) ? (
                      <span className={verifiedBadgeClassName()}>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">
                          ✓
                        </span>
                        Verified Vendor
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                        Unverified
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {app.vendor_email || "No vendor email"}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black ${scorePill(
                      Number(app.score || 0)
                    )}`}
                  >
                    Score {Number(app.score || 0)} · {app.score_tier || "Unrated"}
                  </span>

                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
                    {statusLabel(app)}
                  </span>

                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
                    Payment: {String(app.payment_status || "unpaid")}
                  </span>

                  {app.booth_id ? (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
                      Booth: {app.booth_id}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(app.score_reasons || []).map((reason) => (
                  <span
                    key={reason}
                    className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    {reason}
                  </span>
                ))}

                {app.documents_complete ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Documents complete
                  </span>
                ) : null}

                {app.compliance_complete ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Compliance complete
                  </span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/organizer/events/${eventId}/applications/${app.id}`)
                  }
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
                >
                  Review
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(`/organizer/events/${eventId}/layout?appId=${app.id}`)
                  }
                  className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
                >
                  Assign Booth
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}





