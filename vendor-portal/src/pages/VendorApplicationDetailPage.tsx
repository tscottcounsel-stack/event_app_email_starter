// src/pages/VendorApplicationDetailPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getVendorApplication,
  type VendorApplicationDetail,
} from "../api/vendorApplications";

function formatMoney(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

const VendorApplicationDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { applicationId } = useParams<{ applicationId: string }>();

  const [app, setApp] = useState<VendorApplicationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) {
      setError("No application id provided in URL.");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const idNum = Number(applicationId);
        if (!Number.isFinite(idNum)) {
          throw new Error(`Invalid application id: ${applicationId}`);
        }

        const data = await getVendorApplication(idNum);
        if (!cancelled) {
          setApp(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to load application.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center rounded border px-3 py-1 text-sm hover:bg-gray-100"
      >
        ← Back
      </button>

      <h1 className="text-xl font-semibold mb-4">
        Application Details
      </h1>

      {loading && <p>Loading…</p>}
      {error && (
        <p className="text-red-600 mb-4">
          {error}
        </p>
      )}

      {app && (
        <div className="space-y-2 border rounded-md p-4 bg-white">
          <div>
            <span className="font-medium">Event:</span>{" "}
            {app.event_title}
          </div>
          <div>
            <span className="font-medium">Status:</span>{" "}
            {app.status}
          </div>
          <div>
            <span className="font-medium">Payment status:</span>{" "}
            {app.payment_status}
          </div>
          <div>
            <span className="font-medium">Total due:</span>{" "}
            {formatMoney(app.total_due_cents)}
          </div>
          <div>
            <span className="font-medium">Total paid:</span>{" "}
            {formatMoney(app.total_paid_cents)}
          </div>
          <div>
            <span className="font-medium">Submitted:</span>{" "}
            {app.submitted_at ?? "—"}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorApplicationDetailPage;
