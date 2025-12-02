// src/pages/VendorProfilePage.tsx

import React from "react";
import { Link } from "react-router-dom";

const VendorProfilePage: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-4">
      {/* Back link */}
      <div className="text-xs mb-2">
        <Link
          to="/vendor/events"
          className="text-emerald-600 hover:text-emerald-700 hover:underline"
        >
          ← Back to events
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          Vendor profile
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          This is your vendor hub. Edit your profile (soon), browse events, and
          keep track of where you&apos;ve applied.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 md:grid-cols-3 text-xs">
        <Link
          to="/vendor/events"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-slate-900 shadow-sm hover:border-emerald-400 hover:shadow-md"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Browse events
          </div>
          <p className="mt-1 text-[11px] text-emerald-900">
            See festivals and markets you can apply to. From there you can view
            the map and pick a booth.
          </p>
        </Link>

        <Link
          to="/vendor/applications"
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-900 shadow-sm hover:border-slate-400 hover:shadow-md"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            My applications
          </div>
          <p className="mt-1 text-[11px] text-slate-600">
            Review where you&apos;ve applied, see statuses like pending,
            approved, or paid.
          </p>
        </Link>

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Edit profile (coming soon)
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            You&apos;ll be able to customize your business name, photos, contact
            info, and more—similar to a Fiverr/Upwork profile.
          </p>
        </div>
      </div>

      {/* Temporary basic info block – you can wire in real data later */}
      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4 text-xs text-slate-800">
        <p className="mb-2 font-semibold">
          Basic profile (placeholder for now).
        </p>
        <p className="mb-3 text-slate-500">
          This section will eventually show your real vendor profile pulled
          from the backend. For now it&apos;s just a safe placeholder so the
          page doesn&apos;t break.
        </p>
        <ul className="space-y-1 text-slate-700">
          <li>
            <span className="font-semibold">Business:</span> Signature Eats
          </li>
          <li>
            <span className="font-semibold">Contact:</span> Troy
          </li>
          <li>
            <span className="font-semibold">Email:</span> —
          </li>
          <li>
            <span className="font-semibold">Phone:</span> 555-123-4567
          </li>
        </ul>
      </div>
    </div>
  );
};

export default VendorProfilePage;
