import React, { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

const ORGANIZER_VERIFICATION_FORM_STORAGE_KEY = "organizer_verification_form";

type VerificationDocument = {
  label?: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
};

type VerificationRecord = {
  status: string;
  fee_amount: number;
  fee_paid: boolean;
  payment_status?: string;
  paid_at?: number | null;
  submitted_at?: number | null;
  business_name?: string;
  tax_id_masked?: string;
  notes?: string;
  documents?: VerificationDocument[];
  business_license_url?: string | null;
  government_id_url?: string | null;
};

type StoredOrganizerVerificationDraft = {
  businessName: string;
  notes: string;
  paypal: string;
  venmo: string;
  cashApp: string;
};

export default function OrganizerGetVerifiedPage() {
  const [record, setRecord] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [notes, setNotes] = useState("");
  const [paypal, setPaypal] = useState("");
  const [venmo, setVenmo] = useState("");
  const [cashApp, setCashApp] = useState("");
  const [businessLicenseFile, setBusinessLicenseFile] = useState<File | null>(null);
  const [governmentIdFile, setGovernmentIdFile] = useState<File | null>(null);

  const token =
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    "";

  const search = useMemo(() => new URLSearchParams(window.location.search), []);

  function saveFormState(overrides?: Partial<StoredOrganizerVerificationDraft>) {
    const payload: StoredOrganizerVerificationDraft = {
      businessName: overrides?.businessName ?? businessName,
      notes: overrides?.notes ?? notes,
      paypal: overrides?.paypal ?? paypal,
      venmo: overrides?.venmo ?? venmo,
      cashApp: overrides?.cashApp ?? cashApp,
    };

    localStorage.setItem(
      ORGANIZER_VERIFICATION_FORM_STORAGE_KEY,
      JSON.stringify(payload)
    );
  }

  function restoreSavedFormState() {
    const savedRaw = localStorage.getItem(
      ORGANIZER_VERIFICATION_FORM_STORAGE_KEY
    );
    if (!savedRaw) return;

    try {
      const saved = JSON.parse(
        savedRaw
      ) as StoredOrganizerVerificationDraft;
      setBusinessName(saved.businessName || "");
      setNotes(saved.notes || "");
      setPaypal(saved.paypal || "");
      setVenmo(saved.venmo || "");
      setCashApp(saved.cashApp || "");
    } catch {
      localStorage.removeItem(ORGANIZER_VERIFICATION_FORM_STORAGE_KEY);
    }
  }

  function clearSavedFormState() {
    localStorage.removeItem(ORGANIZER_VERIFICATION_FORM_STORAGE_KEY);
  }

  function buildReviewNotes() {
    const sections: string[] = [];

    const trimmedNotes = notes.trim();
    const trimmedPaypal = paypal.trim();
    const trimmedVenmo = venmo.trim();
    const trimmedCashApp = cashApp.trim();

    if (trimmedNotes) {
      sections.push(trimmedNotes);
    }

    const payoutLines: string[] = [];
    if (trimmedPaypal) payoutLines.push(`PayPal: ${trimmedPaypal}`);
    if (trimmedVenmo) payoutLines.push(`Venmo: ${trimmedVenmo}`);
    if (trimmedCashApp) payoutLines.push(`Cash App: ${trimmedCashApp}`);

    if (payoutLines.length) {
      sections.push(
        `Preferred payout/contact routes:\n${payoutLines.join("\n")}`
      );
    }

    return sections.join("\n\n");
  }

  function applyVerificationToForm(verification: VerificationRecord | null) {
    if (!verification) return;

    if (verification.business_name) {
      setBusinessName(verification.business_name);
    }

    if (verification.notes) {
      const incomingNotes = String(verification.notes || "");
      setNotes((prev) => prev || incomingNotes);

      const paypalMatch = incomingNotes.match(/PayPal:\s*(.+)/i);
      const venmoMatch = incomingNotes.match(/Venmo:\s*(.+)/i);
      const cashAppMatch = incomingNotes.match(/Cash App:\s*(.+)/i);

      if (paypalMatch?.[1]) setPaypal((prev) => prev || paypalMatch[1].trim());
      if (venmoMatch?.[1]) setVenmo((prev) => prev || venmoMatch[1].trim());
      if (cashAppMatch?.[1]) setCashApp((prev) => prev || cashAppMatch[1].trim());
    }
  }

  async function loadStatus() {
    if (!token) {
      setError("You must be logged in to complete organizer verification.");
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
    loadStatus().catch(() => setLoading(false));
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

        setMessage(
          "Verification payment confirmed. Now upload your documents and submit for review."
        );

        const clean = new URL(window.location.href);
        clean.searchParams.delete("payment");
        clean.searchParams.delete("session_id");
        window.history.replaceState(
          {},
          "",
          `${clean.pathname}${clean.search}${clean.hash}`
        );
      } catch (err: any) {
        setError(err?.message || "Unable to confirm payment.");
      }
    })();
  }, [token, search]);

  useEffect(() => {
    saveFormState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, notes, paypal, venmo, cashApp]);

  async function handlePay() {
    if (!token) {
      setError("You must be signed in to pay the verification fee.");
      return;
    }

    if (!businessName.trim()) {
      setError("Please enter your organization name before payment.");
      return;
    }

    try {
      saveFormState();
      setPaying(true);
      setError(null);
      setMessage("Redirecting to secure payment…");

      const reviewNotes = buildReviewNotes();

      const res = await fetch(`${API_BASE}/verification/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          success_url: `${window.location.origin}/organizer/verify?payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${window.location.origin}/organizer/verify?payment=cancel`,
          business_name: businessName.trim(),
          notes: reviewNotes,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail || "Unable to start payment.");
      }

      if (!data?.url) {
        throw new Error("No checkout URL returned.");
      }

      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.message || "Payment failed.");
      setMessage(null);
    } finally {
      setPaying(false);
    }
  }

  async function submitNow() {
    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);

      if (!token) {
        throw new Error("You must be signed in.");
      }

      if (!record?.fee_paid) {
        throw new Error("Please pay the verification fee before submitting.");
      }

      if (!businessName.trim()) {
        throw new Error("Organization name is required.");
      }

      if (!businessLicenseFile) {
        throw new Error("Business registration / license file is required.");
      }

      if (!governmentIdFile) {
        throw new Error("Government ID or legitimacy document is required.");
      }

      const formData = new FormData();
      formData.append("business_name", businessName.trim());
      formData.append("tax_id", "");
      formData.append("notes", buildReviewNotes());
      formData.append("business_license", businessLicenseFile);
      formData.append("government_id", governmentIdFile);

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

      setRecord(data?.verification || null);
      setMessage(
        "Verification submitted. Our team will review your organization details."
      );
      setBusinessLicenseFile(null);
      setGovernmentIdFile(null);
      clearSavedFormState();
      applyVerificationToForm(data?.verification || null);
    } catch (err: any) {
      setError(err?.message || "Unable to submit verification.");
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

  const uploadedDocuments = record?.documents || [];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-4xl font-black text-slate-900">
        Get Verified (Organizer)
      </h1>

      <p className="mt-3 text-slate-600">
        Verify your organization to host events, build trust with vendors, and
        unlock stronger organizer credibility on the platform.
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
            {feePaid
              ? "Fee paid"
              : `Fee due: $${record?.fee_amount ?? 49}`}
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
            <li>Your organization or business name.</li>
            <li>A business registration or license document.</li>
            <li>An ID or legitimacy document for review.</li>
            <li>
              Optional payout/contact routes like PayPal, Venmo, or Cash App.
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-emerald-900">
            Your information is protected
          </h2>
          <p className="mt-3 text-sm font-semibold text-emerald-900/90">
            We use your documents only for verification review. Only authorized
            admins can review them. We do not require bank account details on
            this form.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">
          Step 1: Organization details
        </h2>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          Enter your organization details first. Documents are only requested after your payment is confirmed.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Organization name
            </label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="Enter your organization name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              PayPal
            </label>
            <input
              value={paypal}
              onChange={(e) => setPaypal(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="PayPal email or username (optional)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Venmo
            </label>
            <input
              value={venmo}
              onChange={(e) => setVenmo(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="Venmo handle (optional)"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Cash App
            </label>
            <input
              value={cashApp}
              onChange={(e) => setCashApp(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
              placeholder="Cash App tag (optional)"
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
            placeholder="Tell us about your organization or upcoming events."
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
              ${record?.fee_amount ?? 49}
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
              : `Pay $${record?.fee_amount ?? 49}`}
          </button>
        </div>
      </div>

      {feePaid ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">
            Step 3: Upload documents
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Your payment is confirmed. Upload your documents now, then submit for review.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">
                Business registration / license
              </label>
              <input
                type="file"
                onChange={(e) => {
                  setBusinessLicenseFile(e.target.files?.[0] || null);
                  setError(null);
                }}
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              {businessLicenseFile ? (
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  Selected: {businessLicenseFile.name}
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">
                Government ID or legitimacy document
              </label>
              <input
                type="file"
                onChange={(e) => {
                  setGovernmentIdFile(e.target.files?.[0] || null);
                  setError(null);
                }}
                className="w-full rounded-xl border border-slate-200 px-4 py-3"
              />
              {governmentIdFile ? (
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  Selected: {governmentIdFile.name}
                </div>
              ) : null}
            </div>
          </div>

          {uploadedDocuments.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">
                Previously submitted documents
              </div>
              <div className="mt-3 space-y-2">
                {uploadedDocuments.map((doc, index) => (
                  <div
                    key={`${doc.name}-${index}`}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                  >
                    <div className="font-bold text-slate-900">
                      {doc.label || "Document"}
                    </div>
                    <div>{doc.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button
            disabled={!businessLicenseFile || !governmentIdFile || submitting}
            onClick={submitNow}
            className={`mt-6 w-full rounded-2xl px-6 py-4 text-base font-black ${
              !businessLicenseFile || !governmentIdFile || submitting
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
