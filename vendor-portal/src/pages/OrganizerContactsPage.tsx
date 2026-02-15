import React, { useState } from "react";

export default function OrganizerContactsPage() {
  const [contacts] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const total = contacts.length;
  const selected = selectedIds.length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8">
      {/* Page Title */}
      <h1 className="mb-6 text-3xl font-extrabold text-slate-900">
        Contact Management
      </h1>

      {/* Top Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-lg font-extrabold text-slate-900">
              Contact Management
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              {total} total contacts • {selected} selected
            </div>
          </div>

          {/* Right Buttons */}
          <div className="flex flex-wrap gap-2">
            <button className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
              + Add Contact
            </button>

            <button className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
              ⬆ Import CSV
            </button>

            <button className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
              ⬇ Export CSV
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <select className="w-full max-w-xs rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">
            <option>All Events</option>
          </select>

          <div className="flex flex-wrap gap-2">
            <button className="rounded-full bg-emerald-200 px-5 py-2 text-sm font-semibold text-emerald-900">
              ✓ Select All
            </button>

            <button className="rounded-full bg-indigo-200 px-5 py-2 text-sm font-semibold text-indigo-900">
              ✉ Email ({selected})
            </button>

            <button className="rounded-full bg-indigo-200 px-5 py-2 text-sm font-semibold text-indigo-900">
              💬 Text ({selected})
            </button>
          </div>
        </div>
      </div>

      {/* Contacts Table Card */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 text-lg font-extrabold text-slate-900">
          Contacts
        </div>

        {contacts.length === 0 ? (
          <div className="py-16 text-center text-sm font-semibold text-slate-500">
            No contacts found
          </div>
        ) : (
          <div>TABLE GOES HERE</div>
        )}
      </div>
    </div>
  );
}
