import React, { useState } from "react";
import { Link } from "react-router-dom";

export default function PublicForgotPasswordPage() {
  const [email, setEmail] = useState("");

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
          <h1 className="text-3xl font-black text-slate-900">Reset your password</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Enter your email and we’ll send a reset link. (UI-only for now)
          </p>

          <div className="mt-8">
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
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-black text-white"
              onClick={() => alert("Reset flow coming next phase.")}
            >
              Send reset link
            </button>

            <div className="mt-6 text-center text-sm font-semibold text-slate-600">
              Remembered it?{" "}
              <Link to="/login" className="font-black text-indigo-700 hover:text-indigo-800">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
