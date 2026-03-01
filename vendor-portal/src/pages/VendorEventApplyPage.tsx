// src/pages/VendorEventApplyPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";
import * as ApplicationsAPI from "../components/api/applications";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Helpers ---------------- */

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

/**
 * Some older links pass app_ref like: app_71_1771975163
 * Backend endpoints expect numeric application id (e.g., 71).
 */
function coerceNumericAppId(raw: string) {
  const s = String(raw ?? "").trim();
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
  baseSize?: string;
  basePrice?: number; // dollars
  additionalPerFt?: number;
  cornerPremium?: number;
  fireMarshalFee?: number;
  electricalNote?: string;
  [k: string]: any;
};

function money(n?: number) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  return `$${v.toFixed(0)}`;
}

async function fetchRequirements(eventId: string): Promise<{ boothCategories: BoothCategory[] }> {
  const s = readSession();

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // If your backend requires identity on this endpoint, include it.
  if (s?.accessToken) headers["Authorization"] = `Bearer ${s.accessToken}`;
  if (s?.email) headers["x-user-email"] = s.email;

  const res = await fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { detail: text };
        }
      })()
    : {};

  if (!res.ok) {
    const msg = (data as any)?.detail || "Failed to load requirements.";
    throw new Error(String(msg));
  }

  // Accept multiple shapes:
  // 1) { requirements: { booth_categories: [...] } }
  // 2) { booth_categories: [...] }
  // 3) { boothCategories: [...] }
  const req = (data as any)?.requirements && typeof (data as any).requirements === "object" ? (data as any).requirements : data;
  const rawCats =
    (req as any)?.booth_categories ||
    (req as any)?.boothCategories ||
    (data as any)?.booth_categories ||
    (data as any)?.boothCategories ||
    [];

  const boothCategories = Array.isArray(rawCats) ? (rawCats as BoothCategory[]) : [];

  // Normalize ids if missing
  const normalized = boothCategories.map((c, i) => ({
    id: String((c as any).id ?? `cat_${i + 1}`),
    name: String((c as any).name ?? (c as any).label ?? `Category ${i + 1}`),
    baseSize: (c as any).baseSize ?? (c as any).base_size,
    basePrice:
      (c as any).basePrice ??
      (c as any).base_price ??
      // support cents if present
      ((c as any).base_price_cents != null ? Number((c as any).base_price_cents) / 100 : undefined),
    additionalPerFt:
      (c as any).additionalPerFt ??
      (c as any).additional_per_ft ??
      ((c as any).additional_per_ft_cents != null ? Number((c as any).additional_per_ft_cents) / 100 : undefined),
    cornerPremium:
      (c as any).cornerPremium ??
      (c as any).corner_premium ??
      ((c as any).corner_premium_cents != null ? Number((c as any).corner_premium_cents) / 100 : undefined),
    fireMarshalFee:
      (c as any).fireMarshalFee ??
      (c as any).fire_marshal_fee ??
      ((c as any).fire_marshal_fee_cents != null ? Number((c as any).fire_marshal_fee_cents) / 100 : undefined),
    electricalNote: (c as any).electricalNote ?? (c as any).electrical_note,
    ...c,
  }));

  return { boothCategories: normalized };
}

/* ---------------- Page ---------------- */

export default function VendorEventApplyPage() {
  const nav = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId((params as any).eventId), [params]);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // support both appId and appld (typo seen in screenshots)
  const rawAppId = useMemo(
    () => normalizeId(searchParams.get("appId") || searchParams.get("appld") || ""),
    [searchParams]
  );
  const appIdFromUrl = useMemo(() => coerceNumericAppId(rawAppId), [rawAppId]);

  const [appId, setAppId] = useState<string>(appIdFromUrl);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [boothCategories, setBoothCategories] = useState<BoothCategory[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!eventId) return;

      setLoading(true);
      setError(null);

      try {
        // Ensure we have a numeric application id
        let nextAppId = appIdFromUrl;

        if (!nextAppId) {
          const draftId = await ApplicationsAPI.vendorGetOrCreateDraftApplication(Number(eventId));
          nextAppId = String(draftId);
        }

        // Normalize URL (replace legacy app_ref with numeric id, and unify param name to appId)
        const q = new URLSearchParams(location.search);
        q.delete("appld");
        q.set("appId", nextAppId);
        if (!cancelled) {
          setAppId(nextAppId);
          nav({ pathname: location.pathname, search: `?${q.toString()}` }, { replace: true });
        }

        // Load booth categories from requirements
        const req = await fetchRequirements(eventId);
        if (!cancelled) setBoothCategories(req.boothCategories || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ? String(e.message) : "Failed to load apply screen.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [eventId, appIdFromUrl, location.pathname, location.search, nav]);

  async function chooseCategory(cat: BoothCategory) {
    if (!appId) return;
    setSaving(true);
    setError(null);

    try {
      // Our backend uses applications.booth_id to store the vendor's booth category choice.
      // We'll store the category id (string) there. (This matches your prior UX text.)
      await ApplicationsAPI.vendorUpdateApplication(Number(appId), {
        booth_id: String(cat.id),
        booth_category_id: String(cat.id),
      });

      nav(`/vendor/events/${encodeURIComponent(eventId)}/requirements?appId=${encodeURIComponent(appId)}`);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to save selection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => nav(`/vendor/events/${encodeURIComponent(eventId)}?appId=${encodeURIComponent(appId || "")}`)}
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
          Choose a booth category. Your selection is saved to the draft application (applications.booth_id).
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-sm font-semibold text-slate-600">Loading…</div>
        ) : boothCategories.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            No booth categories were found for this event. The organizer may need to add/publish requirements.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {boothCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => chooseCategory(c)}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:bg-slate-50 disabled:opacity-60"
              >
                <div className="text-lg font-black text-slate-900">{c.name}</div>
                <div className="mt-1 text-sm font-semibold text-slate-500">
                  {c.baseSize ? `Size: ${c.baseSize} • ` : ""}
                  {c.basePrice != null ? `Base: ${money(c.basePrice)}` : "Base: —"}
                </div>
                {c.electricalNote ? (
                  <div className="mt-2 text-xs font-semibold text-slate-500">{c.electricalNote}</div>
                ) : null}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={() => nav(-1)}
            className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
