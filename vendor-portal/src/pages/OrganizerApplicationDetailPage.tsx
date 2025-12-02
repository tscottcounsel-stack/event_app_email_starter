// src/pages/OrganizerApplicationDetailPage.tsx
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";

import {
  getOrganizerApplicationDetail,
  type OrganizerApplicationDetail,
} from "../api/organizerApplications";

import { formatMoney } from "../utils/money";

const OrganizerApplicationDetailPage: React.FC = () => {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();

  const [app, setApp] = useState<OrganizerApplicationDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load application
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!applicationId) {
      setError("Missing application id in URL.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await getOrganizerApplicationDetail(Number(applicationId));
        if (cancelled) return;
        setApp(data);
      } catch (err: any) {
        console.error("Failed to load organizer application detail", err);
        if (!cancelled) {
          setError(
            err?.message ??
              "Could not load this application. Please try again later."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // ---------------------------------------------------------------------------
  // Derived fields
  // ---------------------------------------------------------------------------

  const outstandingCents = useMemo(() => {
    if (!app) return 0;
    return (app.total_due_cents || 0) - (app.total_paid_cents || 0);
  }, [app]);

  function goBackToList() {
    if (app?.event_id) {
      navigate(`/organizer/applications?event_id=${app.event_id}`);
    } else {
      navigate("/organizer/applications");
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function StatusBadge(status: string | undefined) {
    if (!status) return null;
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";

    switch (status) {
      case "approved":
        return (
          <span className={`${base} bg-green-50 text-green-700 border-green-300`}>
            Approved
          </span>
        );
      case "rejected":
        return (
          <span className={`${base} bg-red-50 text-red-700 border-red-300`}>
            Rejected
          </span>
        );
      default:
        return (
          <span
            className={`${base} bg-yellow-50 text-yellow-700 border-yellow-300`}
          >
            Pending
          </span>
        );
    }
  }

  function PaymentBadge(status: string | undefined | null) {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";

    if (status === "paid") {
      return (
        <span className={`${base} bg-green-50 text-green-700 border-green-300`}>
          Paid
        </span>
      );
    }
    return (
      <span className={`${base} bg-gray-50 text-gray-700 border-gray-300`}>
        Unpaid
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Top level states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={goBackToList}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← Back to applications
        </button>
        <div className="text-sm text-gray-600">Loading application…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={goBackToList}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← Back to applications
        </button>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button
          onClick={goBackToList}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← Back to applications
        </button>
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Application not found.
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main UI
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Back link */}
      <button
        onClick={goBackToList}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        ← Back to applications
      </button>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <div className="text-xs uppercase text-gray-500 mb-1">
            Application #{app.id}
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {app.vendor_name || app.business_name || "Vendor application"}
          </h1>
          <div className="text-sm text-gray-600 mt-1">
            {app.event_title && (
              <>
                For{" "}
                <span className="font-medium text-gray-800">
                  {app.event_title}
                </span>
                {app.submitted_at && (
                  <>
                    {" "}
                    • submitted{" "}
                    {new Date(app.submitted_at).toLocaleString()}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {StatusBadge(app.status)}
          {PaymentBadge(app.payment_status)}
        </div>
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <SummaryCard label="Total due" value={formatMoney(app.total_due_cents)} />
        <SummaryCard
          label="Total paid"
          value={formatMoney(app.total_paid_cents)}
          color="green"
        />
        <SummaryCard
          label="Outstanding"
          value={formatMoney(outstandingCents)}
          color={outstandingCents > 0 ? "orange" : "default"}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Vendor info */}
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Vendor details
          </h2>

          <dl className="space-y-2 text-sm">
            <Row label="Vendor name">
              {app.vendor_name || "—"}
            </Row>
            <Row label="Business name">
              {app.business_name || "—"}
            </Row>
            <Row label="Email">
              {app.vendor_email ? (
                <a
                  href={`mailto:${app.vendor_email}`}
                  className="text-blue-600 hover:underline"
                >
                  {app.vendor_email}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Phone">
              {app.vendor_phone || "—"}
            </Row>
            {app.categories && app.categories.length > 0 && (
              <Row label="Categories">
                <div className="flex flex-wrap gap-1">
                  {app.categories.map((c, idx) => (
                    <span
                      key={`${c}-${idx}`}
                      className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </Row>
            )}
          </dl>
        </section>

        {/* Meta */}
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Application meta
          </h2>
          <dl className="space-y-2 text-sm">
            <Row label="Application ID">#{app.id}</Row>
            <Row label="Event ID">{app.event_id}</Row>
            <Row label="Status">{StatusBadge(app.status)}</Row>
            <Row label="Payment">{PaymentBadge(app.payment_status)}</Row>
            <Row label="Submitted at">
              {app.submitted_at
                ? new Date(app.submitted_at).toLocaleString()
                : "—"}
            </Row>
          </dl>

          <div className="mt-4 text-xs text-gray-500">
            Editing / approve / reject actions can hook in here later when the
            organizer workflows are ready.
          </div>
        </section>
      </div>

      {/* Application answers / raw payload */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Application details
        </h2>

        {app.answers ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 overflow-auto">
            {JSON.stringify(app.answers, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">
            No structured answers were returned for this application.
          </p>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Small reusable components
// ---------------------------------------------------------------------------

const SummaryCard: React.FC<{
  label: string;
  value: string | number;
  color?: "default" | "green" | "orange";
}> = ({ label, value, color = "default" }) => {
  const colorClass =
    color === "green"
      ? "text-green-700"
      : color === "orange"
      ? "text-orange-600"
      : "text-gray-900";

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex justify-between gap-4">
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-900 text-right">{children}</dd>
  </div>
);

export default OrganizerApplicationDetailPage;
