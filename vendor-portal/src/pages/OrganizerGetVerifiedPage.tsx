import React, { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE ||
  "https://event-app-api-production-ccce.up.railway.app";

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

export default function OrganizerGetVerifiedPage() {
  const [record, setRecord] = useState<VerificationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  async function loadStatus() {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/verification/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      const verification = data?.verification || null;

      setRecord(verification);

      if (verification?.business_name) {
        setBusinessName(verification.business_name);
      }

      if (verification?.notes) {
        setNotes(verification.notes);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus().catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const payment = (search.get("payment") || "").toLowerCase();
    const sessionId = search.get("session_id") || "";

    if (payment !== "success" || !sessionId || !token) return;

    (async () => {
      try {
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
        setMessage("Verification payment confirmed.");

        const clean = new URL(window.location.href);
        clean.searchParams.delete("payment");
        clean.searchParams.delete("session_id");
        window.history.replaceState(
          {},
          "",
          `${clean.pathname}${clean.search}${clean.hash}`
        );
      } catch (err: any) {
        setMessage(err?.message || "Unable to confirm payment.");
      }
    })();
  }, [token, search]);

 async function handlePay() {
  try {
    console.log("STEP 1: handlePay triggered");

    setMessage("Redirecting to secure payment…");

    const res = await fetch(`${API_BASE}/verification/create-checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        success_url: `${window.location.origin}/organizer/verify?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${window.location.origin}/organizer/verify?payment=cancel`,
      }),
    });

    console.log("STEP 2: response received", res);

    const text = await res.text();
    console.log("STEP 3: raw response text:", text);

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      console.log("STEP 4: response is NOT JSON");
    }

    console.log("STEP 5: parsed data:", data);

    if (!res.ok) {
      throw new Error(data?.detail || "Request failed");
    }

    if (!data?.ok) {
      throw new Error(data?.detail || "Stripe not working");
    }

    if (!data?.url) {
      throw new Error("No checkout URL returned");
    }

    console.log("STEP 6: redirecting to:", data.url);

    window.location.href = data.url;
  } catch (err: any) {
    console.error("ERROR:", err);
    setMessage(err?.message || "Payment failed");
  }
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

  async function submitNow() {
  try {
    console.log("SUBMIT 1: submitNow triggered");
    setSubmitting(true);
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

    console.log("SUBMIT 2: sending request");

    const res = await fetch(`${API_BASE}/verification/submit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    console.log("SUBMIT 3: response received", res.status);

    const text = await res.text();
    console.log("SUBMIT 4: raw response text:", text);

    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      console.log("SUBMIT 5: response was not JSON");
    }

    console.log("SUBMIT 6: parsed data:", data);

    if (!res.ok) {
      throw new Error(data?.detail || "Unable to submit verification.");
    }

    setRecord(data?.verification || null);
    setMessage("Verification submitted. Our team will review your organization details.");
  } catch (err: any) {
    console.error("SUBMIT ERROR:", err);
    setMessage(err?.message || "Unable to submit verification.");
  } finally {
    setSubmitting(false);
  }
}

  if (loading) {
    return <div className="p-6">Loading verification…</div>;
  }

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
              record?.fee_paid
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {record?.fee_paid
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
          Organization details
        </h2>

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

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Business registration / license
            </label>
            <input
              type="file"
              onChange={(e) => setBusinessLicenseFile(e.target.files?.[0] || null)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Government ID or legitimacy document
            </label>
            <input
              type="file"
              onChange={(e) => setGovernmentIdFile(e.target.files?.[0] || null)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3"
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
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Verification fee
            </div>
            <div className="mt-1 text-2xl font-black text-slate-900">
              ${record?.fee_amount ?? 49}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              One-time secure payment for organization review.
            </p>
          </div>

         <button
  type="button"
  disabled={!!record?.fee_paid}
  onClick={() => {
    alert("Pay button clicked");
    handlePay();
  }}
  className={`rounded-full px-5 py-3 text-sm font-extrabold ${
    record?.fee_paid
      ? "bg-slate-100 text-slate-400"
      : "bg-violet-600 text-white hover:bg-violet-700"
  }`}
>
                {record?.fee_paid ? "Fee paid" : `Pay $${record?.fee_amount ?? 49}`}
          </button>
        </div>
      </div>

      <button
        disabled={!record?.fee_paid || submitting}
        onClick={submitNow}
        className={`mt-6 w-full rounded-2xl px-6 py-4 text-base font-black ${
          !record?.fee_paid || submitting
            ? "bg-slate-200 text-slate-500"
            : "bg-slate-900 text-white hover:bg-slate-800"
        }`}
      >
        {submitting ? "Submitting…" : "Submit for verification"}
      </button>
    </div>
  );
}





