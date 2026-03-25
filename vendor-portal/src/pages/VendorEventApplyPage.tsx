// src/pages/VendorEventApplyPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as ApplicationsAPI from "../components/api/applications";

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function cleanAppId(v: string | null) {
  if (!v) return "";
  const s = String(v).trim();
  const lower = s.toLowerCase();
  if (!s || lower === "null" || lower === "undefined" || s === "[object Object]") {
    return "";
  }
  return s;
}

function coerceNumericAppId(raw: string) {
  const s = cleanAppId(raw);
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;

  const m =
    s.match(/^app_(\d+)_/i) ||
    s.match(/^app(\d+)_/i) ||
    s.match(/^app(\d+)$/i);

  return m?.[1] ? String(m[1]) : s;
}

type BoothCategory = {
  id: string;
  name: string;
  [k: string]: any;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "https://event-app-api-production-ccce.up.railway.app";

async function fetchRequirements(eventId: string) {
  const res = await fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`);
  const text = await res.text();

  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      })()
    : {};

  if (!res.ok) {
    throw new Error(String((data as any)?.detail || "Failed to load requirements."));
  }

  const req =
    (data as any)?.requirements && typeof (data as any).requirements === "object"
      ? (data as any).requirements
      : data;

  const raw =
    (req as any)?.booth_categories ||
    (req as any)?.boothCategories ||
    (data as any)?.booth_categories ||
    (data as any)?.boothCategories ||
    [];

  return {
    boothCategories: Array.isArray(raw) ? (raw as BoothCategory[]) : [],
  };
}

export default function VendorEventApplyPage() {
  const nav = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId((params as any).eventId), [params]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const rawAppId =
    cleanAppId(searchParams.get("appId")) || cleanAppId(searchParams.get("appld")) || "";

  const appIdFromUrl = useMemo(() => coerceNumericAppId(rawAppId), [rawAppId]);
  const boothIdFromUrl = useMemo(
    () => normalizeId(searchParams.get("boothId") || ""),
    [searchParams]
  );

  const [appId, setAppId] = useState<string>(appIdFromUrl);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boothCategories, setBoothCategories] = useState<BoothCategory[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState<string>(boothIdFromUrl);
  const [application, setApplication] = useState<any>(null);

  useEffect(() => {
    setSelectedBoothId(String(boothIdFromUrl || ""));
  }, [boothIdFromUrl]);

  useEffect(() => {
    if (loading) return;
    if (!eventId || !appId) return;
    if (!application) return;

    const appBoothId = String((application as any)?.booth_id || selectedBoothId || boothIdFromUrl || "").trim();
    if (!appBoothId) {
      nav(`/vendor/events/${encodeURIComponent(eventId)}/map?appId=${encodeURIComponent(appId)}`, {
        replace: true,
      });
    }
  }, [application, appId, boothIdFromUrl, eventId, loading, nav, selectedBoothId]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setError(null);

      try {
        if (!eventId) {
          throw new Error("Missing event id.");
        }

        let nextAppId = appIdFromUrl;

        if (!nextAppId) {
          const draft = await ApplicationsAPI.vendorGetOrCreateDraftApplication(Number(eventId));

          const resolvedDraftId =
            (draft as any)?.id ??
            (draft as any)?.application?.id ??
            (draft as any)?.applicationId ??
            (draft as any)?.application_id ??
            (draft as any)?.data?.id ??
            (draft as any)?.data?.application?.id ??
            (draft as any)?.data?.applicationId ??
            (draft as any)?.data?.application_id;

          if (!resolvedDraftId) {
            throw new Error("Draft application id was not returned.");
          }

          const numericId = Number(resolvedDraftId);
          if (!numericId || Number.isNaN(numericId)) {
            throw new Error(`Invalid draft application id: ${resolvedDraftId}`);
          }

          nextAppId = String(numericId);
        }

        if (!nextAppId || Number.isNaN(Number(nextAppId))) {
          throw new Error(`applicationId must be a number. Got: ${nextAppId}`);
        }

        const q = new URLSearchParams(location.search);
        q.delete("appld");
        q.delete("appId");
        q.set("appId", String(nextAppId));
        if (boothIdFromUrl) {
          q.set("boothId", boothIdFromUrl);
        } else {
          q.delete("boothId");
        }

        if (!cancelled) {
          setAppId(String(nextAppId));
        }

        const nextSearch = `?${q.toString()}`;
        if (`?${searchParams.toString()}` !== nextSearch) {
          nav(
            {
              pathname: location.pathname,
              search: nextSearch,
            },
            { replace: true }
          );
        }

        const [req, app] = await Promise.all([
          fetchRequirements(eventId).catch(() => ({ boothCategories: [] })),
          ApplicationsAPI.vendorGetApplication(Number(nextAppId)).catch(() => null),
        ]);
        if (!cancelled) {
          setBoothCategories(req.boothCategories || []);
          setApplication(app);
          const savedBoothId = String((app as any)?.booth_id || "").trim();
          if (savedBoothId) {
            setSelectedBoothId(savedBoothId);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ? String(e.message) : "Failed to load apply screen.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [appIdFromUrl, boothIdFromUrl, eventId, location.pathname, location.search, nav, searchParams]);

  async function continueApplication() {
    setSaving(true);
    setError(null);

    try {
      if (!eventId) {
        throw new Error("Missing event id.");
      }

      let nextAppId = String(appId || "").trim();
      if (!nextAppId) {
        const draft = await ApplicationsAPI.vendorGetOrCreateDraftApplication(Number(eventId));

        const resolvedDraftId =
          (draft as any)?.id ??
          (draft as any)?.application?.id ??
          (draft as any)?.applicationId ??
          (draft as any)?.application_id ??
          (draft as any)?.data?.id ??
          (draft as any)?.data?.application?.id ??
          (draft as any)?.data?.applicationId ??
          (draft as any)?.data?.application_id;

        const numericId = Number(resolvedDraftId);
        if (!numericId || Number.isNaN(numericId)) {
          throw new Error(`Invalid draft application id: ${resolvedDraftId}`);
        }

        nextAppId = String(numericId);
        setAppId(nextAppId);
      }

      if (!nextAppId || Number.isNaN(Number(nextAppId))) {
        throw new Error(`applicationId must be a number. Got: ${nextAppId}`);
      }

      const effectiveBoothId = String(selectedBoothId || boothIdFromUrl || "").trim();
      const reqParams = new URLSearchParams();
      reqParams.set("appId", nextAppId);
      if (effectiveBoothId) {
        reqParams.set("boothId", effectiveBoothId);
      }

      nav(`/vendor/events/${encodeURIComponent(eventId)}/requirements?${reqParams.toString()}`);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to continue application.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => nav(`/vendor/events/${encodeURIComponent(eventId)}`)}
          className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          ← Back to Event
        </button>

        <div className="text-sm font-semibold text-slate-500">
          Event: <span className="font-mono">{eventId || "?"}</span> • App:{" "}
          <span className="font-mono">{appId || "…"}</span>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="text-4xl font-black text-slate-900">Apply</div>
        <div className="mt-2 text-sm font-semibold text-slate-500">
          {selectedBoothId
            ? "Your booth selection has been linked to this draft application."
            : "Select a booth to continue."}
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-sm font-semibold text-slate-600">Loading…</div>
        ) : (
          <div className="mt-6 space-y-5">
            {selectedBoothId ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                <div className="text-sm font-semibold uppercase tracking-wide text-violet-700">
                  Selected Booth
                </div>
                <div className="mt-2 text-lg font-black text-slate-900">{selectedBoothId}</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  Continue to the application requirements for this selected booth.
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">
                No booth selected yet. Go back to the booth map and choose a booth first.
              </div>
            )}

            {boothCategories.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                Optional booth categories are available for this event, but they are not required to continue.
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={continueApplication}
                disabled={!appId || !selectedBoothId || saving}
                className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-extrabold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Continue Application"}
              </button>

              <button
                type="button"
                onClick={() =>
                  nav(
                    `/vendor/events/${encodeURIComponent(eventId)}/map${
                      appId ? `?appId=${encodeURIComponent(appId)}` : ""
                    }`
                  )
                }
                className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



