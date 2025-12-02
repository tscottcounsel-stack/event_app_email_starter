// src/pages/VendorDashboard.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getVendorDashboardSummary } from "../api/vendorApplications";
import { formatMoney } from "../utils/money";

type VendorDashboardSummary = {
  vendor_id: number;
  event_id: number | null;
  total_applications: number;
  pending: number;
  approved: number;
  rejected: number;
  total_due_cents: number;
  total_paid_cents: number;
  outstanding_cents: number;
};

const VendorDashboard: React.FC = () => {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<VendorDashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        setLoading(true);
        setError(null);
        const data = await getVendorDashboardSummary(); // no event_id -> all events
        if (cancelled) return;
        setSummary(data);
      } catch (err: any) {
        console.error("Failed to load vendor dashboard summary", err);
        if (!cancelled) {
          setError("Could not load your vendor dashboard summary.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalApplications = summary?.total_applications ?? 0;
  const pending = summary?.pending ?? 0;
  const approved = summary?.approved ?? 0;
  const rejected = summary?.rejected ?? 0;
  const totalDue = formatMoney(summary?.total_due_cents ?? 0);
  const totalPaid = formatMoney(summary?.total_paid_cents ?? 0);
  const outstanding = formatMoney(summary?.outstanding_cents ?? 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">Vendor dashboard</h1>
      <p className="text-sm text-gray-600 mb-6">
        See your overall status across all events.
      </p>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="mb-4 text-sm text-gray-500">Loading…</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Total applications</div>
          <div className="mt-1 text-lg font-semibold">{totalApplications}</div>
        </div>

        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Pending</div>
          <div className="mt-1 text-lg font-semibold text-amber-600">
            {pending}
          </div>
        </div>

        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Approved</div>
          <div className="mt-1 text-lg font-semibold text-green-600">
            {approved}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Rejected</div>
          <div className="mt-1 text-lg font-semibold text-rose-600">
            {rejected}
          </div>
        </div>

        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Total due</div>
          <div className="mt-1 text-lg font-semibold">{totalDue}</div>
        </div>

        <div className="rounded border border-gray-200 bg-white px-4 py-3">
          <div className="text-xs uppercase text-gray-500">Total paid</div>
          <div className="mt-1 text-lg font-semibold text-green-600">
            {totalPaid}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded border border-gray-200 bg-white px-4 py-3 max-w-sm">
          <div className="text-xs uppercase text-gray-500">Outstanding</div>
          <div className="mt-1 text-lg font-semibold text-orange-600">
            {outstanding}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigate("/vendor/events")}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Browse events
        </button>

        <button
          type="button"
          onClick={() => navigate("/vendor/profile")}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Edit profile
        </button>

        <button
          type="button"
          onClick={() => navigate("/vendor/applications")}
          className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
        >
          My applications
        </button>
      </div>
    </div>
  );
};

export default VendorDashboard;
