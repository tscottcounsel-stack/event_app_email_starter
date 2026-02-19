// src/pages/VendorEventApplyPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { readSession } from "../auth/authStorage";
import * as ApplicationsAPI from "../components/api/applications";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type BoothCategory = {
  id: string;
  name: string;
  baseSize?: string;
  basePrice?: number;
  additionalPerFt?: number;
  cornerPremium?: number;
};

type RequirementsResponse = {
  version?: number | string;
  requirements?: {
    booth_categories?: any[];
  };
};

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

async function loadBoothCategories(eventId: string): Promise<BoothCategory[]> {
  const url = `${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as RequirementsResponse | null;
  const root = data?.requirements ? data : ({ requirements: data } as any);
  const items = Array.isArray(root?.requirements?.booth_categories) ? root!.requirements!.booth_categories! : [];

  return items
    .map((b: any, i: number) => ({
      id: normalizeId(b?.id) || `booth-${i + 1}`,
      name: String(b?.name ?? b?.label ?? `Booth ${i + 1}`).trim(),
      baseSize: b?.base_size ?? b?.baseSize ?? b?.size,
      basePrice: typeof b?.base_price === "number" ? b.base_price : typeof b?.basePrice === "number" ? b.basePrice : undefined,
      additionalPerFt:
        typeof b?.additional_per_ft === "number"
          ? b.additional_per_ft
          : typeof b?.additionalPerFt === "number"
          ? b.additionalPerFt
          : undefined,
      cornerPremium:
        typeof b?.corner_premium === "number"
          ? b.corner_premium
          : typeof b?.cornerPremium === "number"
          ? b.cornerPremium
          : undefined,
    }))
    .filter((b: BoothCategory) => !!b.id && !!b.name);
}

/* ---------------- Page ---------------- */

export default function VendorEventApplyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId((params as any).eventId), [(params as any).eventId]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [appId, setAppId] = useState<string>(() => normalizeId(searchParams.get("appId") || ""));
  const [booths, setBooths] = useState<BoothCategory[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState<string>(() => normalizeId(searchParams.get("boothId") || ""));

  const session = useMemo(() => readSession(), []);
  const accessToken = session?.accessToken || "";

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError("");

      if (!eventId) {
        setError("Missing eventId.");
        setLoading(false);
        return;
      }

      try {
        // 1) Load booth categories for selection UX
        const list = await loadBoothCategories(eventId);
        if (!alive) return;
        setBooths(list);

        // 2) Ensure appId (draft) so Requirements page always has stable id
        const draft = await ApplicationsAPI.vendorGetOrCreateDraftApplication({
          apiBase: API_BASE,
          eventId,
          accessToken,
        });

        if (!alive) return;

        const draftId = normalizeId(draft?.id ?? draft?.appId);
        if (!draftId) throw new Error("Draft application missing id.");

        setAppId(draftId);

        // Keep URL synced
        const q = new URLSearchParams(location.search);
        if (normalizeId(q.get("appId") || "") !== draftId) q.set("appId", draftId);
        if (normalizeId(q.get("boothId") || "") !== selectedBoothId && selectedBoothId) q.set("boothId", selectedBoothId);
        navigate({ pathname: location.pathname, search: `?${q.toString()}` }, { replace: true });

        // If boothId exists in URL, persist it to the application immediately
        if (selectedBoothId) {
          await ApplicationsAPI.vendorUpdateApplication({
            apiBase: API_BASE,
            appId: draftId,
            accessToken,
            body: { booth_id: selectedBoothId },
          });
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ? String(e.message) : "Failed to start application.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function continueToRequirements() {
    if (!eventId || !appId) return;

    try {
      if (selectedBoothId) {
        await ApplicationsAPI.vendorUpdateApplication({
          apiBase: API_BASE,
          appId,
          accessToken,
          body: { booth_id: selectedBoothId },
        });
      }

      navigate(`/vendor/events/${encodeURIComponent(eventId)}/requirements?appId=${encodeURIComponent(appId)}`);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to continue.");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-5xl p-6">
          <div className="text-sm text-slate-600">Loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-5xl p-6">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
          <div className="mt-1 text-sm text-slate-600">
            Event: <span className="font-medium">{eventId}</span> • Application:{" "}
            <span className="font-medium">{appId || "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">Choose a booth category</h2>
            <p className="text-sm text-slate-600">
              Your selection is saved to the draft application (applications.booth_id).
            </p>
          </div>

          {booths.length === 0 ? (
            <div className="text-sm text-slate-500">No booth categories available.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {booths.map((b) => {
                const isSelected = normalizeId(selectedBoothId) === normalizeId(b.id);
                return (
                  <button
                    key={b.id}
                    className={[
                      "rounded-2xl border p-4 text-left transition",
                      isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                    onClick={() => setSelectedBoothId(b.id)}
                  >
                    <div className="text-sm font-semibold">{b.name}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {b.baseSize ? <>Size: {b.baseSize}</> : null}
                      {b.basePrice !== undefined ? <> • Base: ${b.basePrice}</> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              onClick={() => navigate(-1)}
            >
              Back
            </button>
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={!appId}
              onClick={continueToRequirements}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
