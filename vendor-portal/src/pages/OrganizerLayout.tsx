import React from "react";
import { Outlet, NavLink } from "react-router-dom";

export default function OrganizerLayout() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 p-6">
        <div className="text-xl font-black mb-8">
          Organizer
        </div>

        <nav className="space-y-2">
          <NavLink
            to="/organizer/dashboard"
            className={({ isActive }) =>
              `block rounded-xl px-4 py-2 font-semibold ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            Dashboard
          </NavLink>

          <NavLink
            to="/organizer/events"
            className={({ isActive }) =>
              `block rounded-xl px-4 py-2 font-semibold ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            Events
          </NavLink>

          <NavLink
            to="/organizer/contacts"
            className={({ isActive }) =>
              `block rounded-xl px-4 py-2 font-semibold ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            Contacts
          </NavLink>

          <NavLink
            to="/organizer/profile"
            className={({ isActive }) =>
              `block rounded-xl px-4 py-2 font-semibold ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            Organizer Profile
          </NavLink>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
