// src/pages/Login.tsx
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Default to vendor login unless explicitly overridden
  const next = params.get("next") || "/vendor/login";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Login</h1>

        <p className="text-sm text-slate-600">
          Choose how you’d like to sign in.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate("/vendor/login")}
            className="w-full rounded bg-emerald-600 text-white py-2 text-sm hover:bg-emerald-700"
          >
            Vendor login
          </button>

          <button
            onClick={() => navigate("/organizer/login")}
            className="w-full rounded border border-slate-300 bg-white py-2 text-sm hover:bg-slate-50"
          >
            Organizer login
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Redirect target: <span className="font-mono">{next}</span>
        </div>
      </div>
    </div>
  );
}
