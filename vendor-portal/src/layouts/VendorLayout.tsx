import React from "react";
import { NavLink, Outlet } from "react-router-dom";

const linkBase =
  "block rounded-xl px-4 py-3 text-sm font-semibold hover:bg-slate-100";
const active = "bg-slate-100 text-slate-900";
const idle = "text-slate-700";

export default function VendorLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="w-64 shrink-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4">
            <div className="text-lg font-extrabold text-slate-900">Vendor</div>
            <div className="text-sm text-slate-600">Portal</div>
          </div>

          <nav className="space-y-2">
            <NavLink
              to="/vendor/events"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? active : idle}`
              }
            >
              Events
            </NavLink>
            <NavLink
              to="/vendor/profile"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? active : idle}`
              }
            >
              Profile
            </NavLink>
            <NavLink
              to="/vendor/contacts"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? active : idle}`
              }
            >
              Contacts
            </NavLink>
            <NavLink
              to="/vendor/messaging"
              className={({ isActive }) =>
                `${linkBase} ${isActive ? active : idle}`
              }
            >
              Messaging
            </NavLink>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}





