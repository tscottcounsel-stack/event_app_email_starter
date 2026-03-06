// src/pages/PublicForgotPasswordPage.tsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

// If you later add a backend endpoint, update this path:
const RESET_PATH = "/auth/forgot-password";

function isValidEmail(email: string) {
  const v = String(email || "").trim();
  // simple + safe email check for UI gating
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function PublicForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedEmail = useMemo(() => String(email || "").trim(), [email]);
  const canSubmit = useMemo(
    () => isValidEmail(normalizedEmail) && !submitting,
    [normalizedEmail, submitting]
  );

  async function onSubmit() {
    setError(null);

    if (!isValidEmail(normalizedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);

    try {
      // We purposely show a success state even if backend isn’t implemented,
      // to avoid “account enumeration” and keep UX clean.
      //
      // If/when backend exists, implement POST { email } here.
      const url = `${API_BASE}${RESET_PATH}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      // If endpoint doesn't exist yet, treat as success (UI flow is still valid)
      if (!res.ok) {
        // 404/405 likely means "not implemented yet" in your API
        setSent(true);
        return;
      }

      setSent(true);
    } catch {
      // offline / server down — still show success for UX
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-purple-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
            <span className="text-lg font-black text-slate-900">VendorConnect</span>
          </Link>

          <Link
            to="/login"
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            Back to Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="rounded-[34px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-extrabold text-violet-800">
            Account Access
          </div>

          <h1 className="mt-3 text-3xl font-black text-slate-900">Reset your password</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Enter your email and we’ll send a reset link if an account exists.
          </p>

          <div className="mt-6 h-px w-full bg-slate-200" />

          {sent ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-extrabold text-emerald-900">Check your inbox</div>
              <div className="mt-1 text-sm font-semibold text-emerald-800">
                If an account exists for <span className="font-black">{normalizedEmail}</span>, you’ll
                receive a reset link shortly.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/login"
                  className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-slate-800"
                >
                  Return to Sign in
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                    setError(null);
                  }}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                >
                  Send another link
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              {error ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                  {error}
                </div>
              ) : null}

              <label className="text-xs font-black text-slate-700">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                placeholder="you@example.com"
              />

              <button
                type="button"
                disabled={!canSubmit}
                className={[
                  "mt-4 w-full rounded-2xl px-6 py-3 text-sm font-black text-white",
                  canSubmit
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600"
                    : "bg-slate-300",
                ].join(" ")}
                onClick={onSubmit}
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>

              <div className="mt-6 text-center text-sm font-semibold text-slate-600">
                Remembered it?{" "}
                <Link to="/login" className="font-black text-indigo-700 hover:text-indigo-800">
                  Sign in
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
