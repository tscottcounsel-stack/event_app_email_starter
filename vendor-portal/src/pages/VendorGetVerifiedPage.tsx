import React, { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

const VERIFICATION_FORM_STORAGE_KEY = "vendor_verification_form";

type VerificationDocument = {
  name: string;
  size?: number;
  type?: string;
  url?: string;
};

type VerificationRecord = {
  id?: number;
  status: string;
  fee_amount: number;
  fee_paid: boolean;
  payment_status?: string;
  paid_at?: number | null;
  submitted_at?: number | null;
  business_name?: string;
  tax_id_masked?: string;
  notes?: string;
  business_license_url?: string;
  government_id_url?: string;
  documents?: VerificationDocument[];
};

type StoredVerificationDraft = {
  businessName: string;
  taxId: string;
  notes: string;
};

export default function VendorGetVerifiedPage() {
  const [record, setRecord] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [notes, setNotes] = useState("");
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);

  const token =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    "";

  const search = useMemo(() => new URLSearchParams(window.location.search), []);

  function saveFormState(overrides?: Partial<StoredVerificationDraft>) {
    const payload: StoredVerificationDraft = {
      businessName: overrides?.businessName ?? businessName,
      taxId: overrides?.taxId ?? taxId,
      notes: overrides?.notes ?? notes,
    };
    localStorage.setItem(
      VERIFICATION_FORM_STORAGE_KEY,
      JSON.stringify(payload)
    );
  }

  function restoreSavedFormState() {
    const savedRaw = localStorage.getItem(VERIFICATION_FORM_STORAGE_KEY);
    if (!savedRaw) return;
    try {
      const saved = JSON.parse(savedRaw) as StoredVerificationDraft;
      setBusinessName(saved.businessName || "");
      setTaxId(saved.taxId || "");
      setNotes(saved.notes || "");
    } catch {
      localStorage.removeItem(VERIFICATION_FORM_STORAGE_KEY);
    }
  }

  function clearSavedFormState() {
    localStorage.removeItem(VERIFICATION_FORM_STORAGE_KEY);
  }

  function applyVerificationToForm(verification: VerificationRecord | null) {
    if (!verification) return;
    if (verification.business_name) {
      setBusinessName(verification.business_name);
    }
    if (verification.notes) {
      setNotes(verification.notes);
    }
  }

  async function loadStatus() {
    if (!token) {
      setError("You must be logged in to complete vendor verification.");
      setLoading(false);
      return;
    }

    try {
      setError(null);
      restoreSavedFormState();

      const res = await fetch(`${API_BASE}/verification/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || "Unable to load verification status.");
      }

      const verification = data?.verification || null;
      setRecord(verification);
      applyVerificationToForm(verification);
    } catch (err: any) {
      setError(err?.message || "Unable to load verification status.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    if (!token) return;
    const res = await fetch(`${API_BASE}/verification/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.detail || "Unable to refresh verification status.");
    }
    const verification = data?.verification || null;
    setRecord(verification);
    applyVerificationToForm(verification);
    return verification;
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const payment = (search.get("payment") || "").toLowerCase();
    const sessionId = search.get("session_id") || "";

    if (payment !== "success" || !sessionId || !token) return;

    (async () => {
      try {
        setError(null);
        setMessage("Confirming verification payment…");

        const res = await fetch(`${API_BASE}/verification/confirm-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_id: sessionId }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.detail || "Unable to confirm payment.");
        }

        setRecord(data?.verification || null);
        await refreshStatus();
        restoreSavedFormState();

        setMessage(
          "Verification payment confirmed. Now upload your documents and submit for review."
        );

        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("payment");
        cleanUrl.searchParams.delete("session_id");
        window.history.replaceState(
          {},
          "",
          `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`
        );
      } catch (err: any) {
        setError(err?.message || "Unable to confirm payment.");
      }
    })();
  }, [search, token]);

  useEffect(() => {
    saveFormState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, taxId, notes]);

  async function handlePay() {
    if (!token) {
      setError("You must be logged in to pay the verification fee.");
      return;
    }

    if (!businessName.trim()) {
      setError("Please enter your business name before payment.");
      return;
    }

    if (!taxId.trim() && !record?.tax_id_masked) {
      setError("Please enter your tax ID / EIN before payment.");
      return;
    }

    try {
      saveFormState();
      setPaying(true);
      setError(null);
      setMessage("Redirecting to secure payment…");

      const res = await fetch(`${API_BASE}/verification/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_name: businessName.trim(),
          tax_id: taxId.trim(),
          notes: notes.trim(),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.detail || "Unable to start payment.");
      }

      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.message || "Unable to start payment.");
      setMessage(null);
    } finally {
      setPaying(false);
    }
  }

  async function submitNow() {
    if (!token) {
      setError("You must be logged in to submit verification.");
      return;
    }

    if (!record?.fee_paid) {
      setError("Please pay the verification fee before submitting.");
      return;
    }

    if (!businessName.trim()) {
      setError("Please enter your business name.");
      return;
    }

    if (!taxId.trim() && !record?.tax_id_masked) {
      setError("Please enter your tax ID / EIN.");
      return;
    }

    if (!licenseFile) {
      setError("Please upload your business license.");
      return;
    }

    if (!idFile) {
      setError("Please upload your government ID.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage("Submitting verification for review…");

      const formData = new FormData();
      formData.append("business_name", businessName.trim());
      formData.append("tax_id", taxId.trim());
      formData.append("notes", notes.trim());
      formData.append("business_license", licenseFile);
      formData.append("government_id", idFile);

      const res = await fetch(`${API_BASE}/verification/submit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || "Unable to submit verification.");
      }

      setRecord(data?.verification || data || null);
      setMessage("Verification submitted. Our team will review your documents.");
      setLicenseFile(null);
      setIdFile(null);
      clearSavedFormState();
      applyVerificationToForm(data?.verification || data || null);
    } catch (err: any) {
      setError(err?.message || "Unable to submit verification.");
      setMessage(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading verification…</div>;
  }

  const feePaid = !!record?.fee_paid;
  const statusLabel =
    record?.status === "pending"
      ? "Pending review"
      : record?.status === "approved" || record?.status === "verified"
        ? "Verified"
        : record?.status === "rejected"
          ? "Rejected"
          : "Not submitted";

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-4xl font-black text-slate-900">Get Verified (Vendor)</h1>
      <p className="mt-3 text-slate-600">
        Submit your business details and a one-time verification fee to unlock
        trusted vendor status and improve organizer confidence.
      </p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Verification status
            </div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {statusLabel}
            </div>
          </div>
          <div
            className={`rounded-full px-4 py-2 text-sm font-extrabold ${
              feePaid
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {feePaid ? "Fee paid" : `Fee due: $${record?.fee_amount ?? 25}`}
          </div>
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-900">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">What you need</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li>Business name and tax identification.</li>
            <li>A valid business license or equivalent proof.</li>
            <li>A government-issued ID for identity confirmation.</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-emerald-900">
            Your information is protected
          </h2>
          <p className="mt-3 text-sm font-semibold text-emerald-900/90">
            We only collect the minimum details needed for review. Documents are
            used strictly for verification and only visible to authorized platform
            admins.
          </p>
          {record?.tax_id_masked ? (
            <div className="mt-3 text-xs font-bold text-emerald-800">
              Stored tax ID: {record.tax_id_masked}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Step 1: Basic details</h2>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          Enter your business details first. Documents are only requested after your payment is confirmed.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Business name
            </label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="Enter your business name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Tax ID / EIN
            </label>
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="Enter tax ID"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-bold text-slate-700">
            Notes for the review team
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[110px] w-full rounded-xl border border-slate-200 px-4 py-3"
            placeholder="Anything we should know about your business or documentation?"
          />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Step 2: Verification fee
            </div>
            <div className="mt-1 text-2xl font-black text-slate-900">
              ${record?.fee_amount ?? 25}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              One-time secure payment. After payment, you will upload your documents once and submit.
            </p>
          </div>

          <button
            type="button"
            disabled={feePaid || paying}
            onClick={handlePay}
            className={`rounded-full px-5 py-3 text-sm font-extrabold ${
              feePaid || paying
                ? "bg-slate-100 text-slate-400"
                : "bg-violet-600 text-white hover:bg-violet-700"
            }`}
          >
            {feePaid
              ? "Fee paid"
              : paying
                ? "Starting payment…"
                : `Pay $${record?.fee_amount ?? 25}`}
          </button>
        </div>
      </div>

      {feePaid ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Step 3: Upload documents</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Your payment is confirmed. Upload your documents now, then submit for review.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">
                Business license
              </label>
              <input
                type="file"
                onChange={(e) => {
                  setLicenseFile(e.target.files?.[0] || null);
                  setError(null);
                }}
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              {licenseFile ? (
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  Selected: {licenseFile.name}
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">
                Government ID
              </label>
              <input
                type="file"
                onChange={(e) => {
                  setIdFile(e.target.files?.[0] || null);
                  setError(null);
                }}
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              {idFile ? (
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  Selected: {idFile.name}
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            disabled={!licenseFile || !idFile || submitting}
            onClick={submitNow}
            className={`mt-6 w-full rounded-2xl px-6 py-4 text-base font-black ${
              !licenseFile || !idFile || submitting
                ? "bg-slate-200 text-slate-500"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {submitting ? "Submitting…" : "Submit for verification"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
