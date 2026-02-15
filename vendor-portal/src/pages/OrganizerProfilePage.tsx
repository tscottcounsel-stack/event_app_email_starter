import React from "react";
import { useNavigate } from "react-router-dom";

export default function OrganizerProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Organizer Profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          View or update your organizer information.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              Complete Your Organizer Profile
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Set up your organization details to start creating events and working with vendors.
            </div>
          </div>

          <button
            onClick={() => navigate("/organizer-profile-setup")}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
          >
            Complete Profile
          </button>
        </div>
      </div>
    </div>
  );
}
