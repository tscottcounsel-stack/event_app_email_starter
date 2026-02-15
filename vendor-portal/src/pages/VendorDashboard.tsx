import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Vendor Control Center Dashboard
 * - Control center style like Organizer dashboard
 * - Reads vendor profile + applications from localStorage
 * - Safe for future backend swap
 */

type VendorProfile = {
  businessName?: string;
  description?: string;
  categories?: string[];
  email?: string;
  phone?: string;
  website?: string;
};

type VendorApplication = {
  eventId: number | string;
  eventName: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  submittedAt?: string;
};

const PRIMARY_BTN =
  "bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-95";
const SECONDARY_BTN =
  "border border-indigo-200 text-indigo-600 hover:bg-indigo-50";

export default function VendorDashboard() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [apps, setApps] = useState<VendorApplication[]>([]);

  // -------------------------------
  // LOAD DATA
  // -------------------------------
  useEffect(() => {
    try {
      const p = localStorage.getItem("vendor_profile_v1");
      if (p) setProfile(JSON.parse(p));

      const a = localStorage.getItem("vendor_apps_v1");
      if (a) setApps(JSON.parse(a));
    } catch {}
  }, []);

  // -------------------------------
  // PROFILE COMPLETION CHECK
  // -------------------------------
  const profileComplete = useMemo(() => {
    if (!profile) return false;

    return (
      !!profile.businessName &&
      !!profile.email &&
      !!profile.phone &&
      !!profile.categories?.length
    );
  }, [profile]);

  // -------------------------------
  // KPI METRICS
  // -------------------------------
  const submittedCount = apps.filter(
    (a) => a.status === "submitted"
  ).length;

  const draftCount = apps.filter(
    (a) => a.status === "draft"
  ).length;

  const totalApps = apps.length;

  // -------------------------------
  // UI
  // -------------------------------
  return (
    <div className="p-6 space-y-6">

      {/* PROFILE BANNER (HIDES WHEN COMPLETE) */}
      {!profileComplete && (
        <div className="bg-white rounded-2xl shadow p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Complete Your Business Profile
            </h2>
            <p className="text-gray-500 text-sm">
              Set up your business details to start applying to events.
            </p>
          </div>

          <button
            onClick={() => navigate("/vendor/profile/setup")}
            className={`px-5 py-2 rounded-xl ${PRIMARY_BTN}`}
          >
            Setup Profile
          </button>
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid md:grid-cols-4 gap-4">

        <KpiCard title="Total Applications" value={totalApps} />
        <KpiCard title="Submitted" value={submittedCount} />
        <KpiCard title="Drafts" value={draftCount} />
        <KpiCard title="Profile Status" value={profileComplete ? "Complete" : "Incomplete"} />

      </div>

      {/* MY APPLICATIONS */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">My Applications</h3>
            <p className="text-sm text-gray-500">
              Drafts and submissions
            </p>
          </div>

          <button
            onClick={() => navigate("/vendor/applications")}
            className={`px-4 py-2 rounded-lg ${SECONDARY_BTN}`}
          >
            View All →
          </button>
        </div>

        {apps.length === 0 ? (
          <EmptyApps navigate={navigate} />
        ) : (
          <div className="space-y-3">
            {apps.slice(0, 5).map((a) => (
              <div
                key={a.eventId}
                className="border rounded-xl p-4 flex justify-between items-center"
              >
                <div>
                  <div className="font-medium">{a.eventName}</div>
                  <div className="text-sm text-gray-500 capitalize">
                    {a.status}
                  </div>
                </div>

                <button
                  onClick={() =>
                    navigate(`/vendor/events/${a.eventId}`)
                  }
                  className={`px-4 py-2 rounded-lg ${PRIMARY_BTN}`}
                >
                  View
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AVAILABLE EVENTS PREVIEW */}
      <div className="bg-white rounded-2xl shadow p-6 flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Available Events</h3>
          <p className="text-sm text-gray-500">
            Find events that match your business
          </p>
        </div>

        <button
          onClick={() => navigate("/vendor/events")}
          className={`px-5 py-2 rounded-xl ${PRIMARY_BTN}`}
        >
          Browse Events
        </button>
      </div>

    </div>
  );
}

/* ---------------------------- */

function KpiCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/* ---------------------------- */

function EmptyApps({ navigate }: { navigate: any }) {
  return (
    <div className="border rounded-xl p-10 text-center">
      <div className="text-gray-500 mb-2">
        No applications yet
      </div>
      <button
        onClick={() => navigate("/vendor/events")}
        className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white"
      >
        Browse Events
      </button>
    </div>
  );
}
