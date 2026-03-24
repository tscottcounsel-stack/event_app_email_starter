// src/pages/VendorApplicationDetailPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://127.0.0.1:8002";

type ApplicationRecord = {
  id: number;
  event_id: number;
  booth_id?: string | null;
  requested_booth_id?: string | null;
  booth_label?: string | null;
  booth_name?: string | null;
  booth?: { label?: string | null; name?: string | null } | null;
  selected_booth?: { label?: string | null; name?: string | null } | null;
  notes?: string | null;
  status?: string | null;
  progress?: string | null;
  application_status?: string | null;
  payment_status?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  app_ref?: string | null;
  documents?: Record<string, any> | null;
  docs?: Record<string, any> | null;
  checked?: Record<string, boolean> | null;
  amount_due?: number | null;
  booth_price?: number | null;
  total_price?: number | null;
  total_cents?: number | null;
};

function normalizeId(v: any) {
  return String(v ?? "").trim();
}

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") return "TBD";
  const n = Number(value);
  if (Number.isNaN(n)) return "TBD";
  if (n > 9999) return `$${(n / 100).toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function prettifyStatus(raw: any, fallback = "draft") {
  const s = String(raw || fallback).trim().toLowerCase();
  return s || fallback;
}

function getReadableBoothName(app: ApplicationRecord | null) {
  if (!app) return "No booth selected";

  const explicit =
    app.booth_label ||
    app.booth_name ||
    app.booth?.label ||
    app.booth?.name ||
    app.selected_booth?.label ||
    app.selected_booth?.name;

  if (explicit && String(explicit).trim()) {
    return String(explicit).trim();
  }

  return shortenBoothId(app.booth_id || (app as any).requested_booth_id);
}

function shortenBoothId(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "No booth selected";
  if (!raw.startsWith("booth_")) return raw;

  const suffix = raw.split("_")[1] || raw;
  const short = suffix.slice(-4).toUpperCase();
  return `Booth ${short}`;
}

export default function VendorApplicationDetailPage() {
  const nav = useNavigate();
  const { eventId = "", appId = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationRecord | null>(null);

  const appStatus = useMemo(
    () =>
      prettifyStatus(
        application?.status ?? application?.progress ?? application?.application_status,
        "draft"
      ),
    [application]
  );
  const paymentStatus = useMemo(
    () => prettifyStatus(application?.payment_status, "unpaid"),
    [application]
  );

  const requestedBoothId = normalizeId(application?.requested_booth_id || "");
  const assignedBoothId = normalizeId(application?.booth_id || "");
  const selectedBooth = assignedBoothId || requestedBoothId;
  const selectedBoothLabel = useMemo(() => getReadableBoothName(application), [application]);
  const canSubmit = !!application && appStatus === "draft";
  const canPayNow = !!application && paymentStatus !== "paid" && !!selectedBooth;

  const amountText = useMemo(() => {
    return formatMoney(application?.amount_due) !== "TBD"
      ? formatMoney(application?.amount_due)
      : formatMoney(application?.total_price) !== "TBD"
      ? formatMoney(application?.total_price)
      : formatMoney(application?.booth_price) !== "TBD"
      ? formatMoney(application?.booth_price)
      : formatMoney(application?.total_cents);
  }, [application]);

  async function loadApplication() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/vendor/applications/${encodeURIComponent(String(appId))}`,
        {
          method: "GET",
          headers: {
            ...buildAuthHeaders(),
            Accept: "application/json",
          },
        }
      );

      const text = await res.text();
      const data = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return { detail: text };
            }
          })()
        : null;

      if (!res.ok) {
        throw new Error(String((data as any)?.detail || `Failed to load application (${res.status})`));
      }

      const record =
        (data as any)?.application && typeof (data as any).application === "object"
          ? (data as any).application
          : data;

      setApplication(record as ApplicationRecord);
    } catch (e: any) {
      setError(e?.message || "Failed to load application.");
      setApplication(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (eventId && appId) {
      loadApplication();
    }
  }, [eventId, appId]);

  async function submitApplication() {
    if (!application) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/vendor/applications/${encodeURIComponent(String(appId))}/submit`,
        {
          method: "POST",
          headers: {
            ...buildAuthHeaders(),
            Accept: "application/json",
          },
        }
      );

      const text = await res.text();
      const data = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return { detail: text };
            }
          })()
        : null;

      if (!res.ok) {
        throw new Error(
          String((data as any)?.detail || `Failed to submit application (${res.status})`)
        );
      }

      await loadApplication();
    } catch (e: any) {
      setError(e?.message || "Failed to submit application.");
    } finally {
      setSaving(false);
    }
  }

  async function payNow() {
    if (!application) return;

    setPaying(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/vendor/applications/${encodeURIComponent(String(appId))}/pay-now`,
        {
          method: "POST",
          headers: {
            ...buildAuthHeaders(),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          String(
            (data as any)?.detail ||
              (data as any)?.message ||
              `Unable to start payment (${res.status}).`
          )
        );
      }

      if ((data as any)?.ok === false) {
        throw new Error(
          String(
            (data as any)?.detail ||
              (data as any)?.message ||
              "Unable to start payment."
          )
        );
      }

      const paymentUrl =
        (data as any)?.url ||
        (data as any)?.checkout_url ||
        (data as any)?.checkoutUrl ||
        (data as any)?.payment_url ||
        (data as any)?.session_url ||
        (data as any)?.sessionUrl;

      if (typeof paymentUrl === "string" && paymentUrl.trim()) {
        window.location.href = paymentUrl;
        return;
      }

      throw new Error("Payment URL was not returned by the server.");
    } catch (e: any) {
      setError(e?.message || "Unable to start payment.");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="text-2xl font-black text-slate-900">Loading application…</div>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">
          {error || "Application not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() =>
            nav(
              `/vendor/events/${encodeURIComponent(String(eventId))}/requirements?appId=${encodeURIComponent(
                String(appId)
              )}`
            )
          }
          className="rounded-full border border-slate-200 bg-white px-6 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          ← Back to Requirements
        </button>

        <div className="text-sm font-semibold text-slate-500">
          Event: <span className="font-mono">{eventId}</span> • App:{" "}
          <span className="font-mono">{appId}</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr,0.7fr]">
        <div className="space-y-5">
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-4xl font-black text-slate-900">Application Summary</div>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-5">
                <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Selected Booth
                </div>
                <div className="mt-2 text-2xl font-black text-slate-900">
                  {selectedBooth ? `${assignedBoothId ? "Assigned" : "Requested"}: ${selectedBoothLabel}` : selectedBoothLabel}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    nav(
                      `/vendor/events/${encodeURIComponent(String(eventId))}/map?appId=${encodeURIComponent(
                        String(appId)
                      )}`
                    )
                  }
                  className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Change Booth
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 p-5">
                <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Amount Due
                </div>
                <div className="mt-2 text-2xl font-black text-slate-900">{amountText}</div>
                <div className="mt-3 text-sm font-semibold text-slate-500">
                  Payment is available immediately after booth selection.
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 p-5">
              <div className="text-sm font-bold uppercase tracking-wide text-slate-500">Notes</div>
              <div className="mt-2 text-sm font-semibold text-slate-700">
                {String(application.notes || "").trim() || "No notes added yet."}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-2xl font-black text-slate-900">Status</div>

            <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
              <div>
                Application: <span className="font-black text-slate-900">{appStatus}</span>
              </div>
              <div>
                Payment: <span className="font-black text-slate-900">{paymentStatus}</span>
              </div>
              <div>
                Updated: <span className="font-black text-slate-900">{application.updated_at || "—"}</span>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={payNow}
                disabled={!canPayNow || paying}
                className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {paying ? "Starting Payment…" : "Pay Now"}
              </button>

              <button
                type="button"
                onClick={submitApplication}
                disabled={!canSubmit || saving}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {saving ? "Submitting…" : "Submit Application"}
              </button>

              <button
                type="button"
                onClick={() => nav("/vendor/applications")}
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
              >
                View All Applications
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
