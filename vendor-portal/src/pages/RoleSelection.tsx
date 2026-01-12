import React from "react";
import { useNavigate } from "react-router-dom";

export default function RoleSelection() {
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Choose your role</h1>
          <p className="text-slate-300 mt-2">
            Log in as an Organizer or Vendor to access your dashboard.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <button
            onClick={() => nav("/organizer/login")}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-left hover:bg-slate-900/70 transition"
          >
            <div className="text-xl font-semibold">Organizer</div>
            <div className="text-slate-300 mt-2">
              Create events, edit booth maps, review applications, manage contacts.
            </div>
            <div className="mt-4 inline-flex rounded-full bg-indigo-600 px-4 py-2 font-semibold">
              Continue
            </div>
          </button>

          <button
            onClick={() => nav("/vendor/login")}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-left hover:bg-slate-900/70 transition"
          >
            <div className="text-xl font-semibold">Vendor</div>
            <div className="text-slate-300 mt-2">
              Find events, apply for booths, manage applications and profile.
            </div>
            <div className="mt-4 inline-flex rounded-full bg-emerald-600 px-4 py-2 font-semibold">
              Continue
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
