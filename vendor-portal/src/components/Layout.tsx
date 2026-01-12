// vendor-portal/src/components/Layout.tsx
import React from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAccessToken, getUserRole, setUserRole } from "../api";

function cls(isActive: boolean) {
  return isActive
    ? "block rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900"
    : "block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900";
}

export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const role = getUserRole();

  const onSignOut = () => {
    clearAccessToken();
    setUserRole("public");
    nav("/roles", { replace: true });
  };

  const isOrganizer = role === "organizer" || loc.pathname.startsWith("/organizer");
  const isVendor = role === "vendor" || loc.pathname.startsWith("/vendor");

  return (
    <div className="min-h-screen bg-white">
      <div className="flex">
        {/* left nav */}
        <aside className="w-64 border-r bg-white px-4 py-4">
          <div className="mb-6">
            <div className="text-lg font-semibold">VendorConnect</div>
            <div className="text-xs text-slate-500">Verified vendors &amp; organizers</div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <span className="rounded-full border px-2 py-1 text-xs text-slate-600">Public</span>
            <button
              onClick={onSignOut}
              className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400">
              PUBLIC
            </div>
            <NavLink to="/" className={({ isActive }) => cls(isActive)}>
              Public Events
            </NavLink>
            <NavLink to="/roles" className={({ isActive }) => cls(isActive)}>
              Choose Role
            </NavLink>
            <NavLink to="/organizer/login" className={({ isActive }) => cls(isActive)}>
              Organizer Login
            </NavLink>
            <NavLink to="/vendor/login" className={({ isActive }) => cls(isActive)}>
              Vendor Login
            </NavLink>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400">
              ORGANIZER (FALLBACK)
            </div>
            <NavLink to="/organizer/events" className={({ isActive }) => cls(isActive)}>
              Events
            </NavLink>
            <NavLink to="/organizer/applications" className={({ isActive }) => cls(isActive)}>
              Applicants
            </NavLink>
            <NavLink to="/organizer/contacts" className={({ isActive }) => cls(isActive)}>
              Contacts
            </NavLink>
            <NavLink to="/organizer/profile" className={({ isActive }) => cls(isActive)}>
              Organizer Profile
            </NavLink>
            <NavLink to="/organizer/messages" className={({ isActive }) => cls(isActive)}>
              Messaging
            </NavLink>
            <NavLink to="/organizer/billing" className={({ isActive }) => cls(isActive)}>
              Billing
            </NavLink>
            <NavLink to="/organizer/settings" className={({ isActive }) => cls(isActive)}>
              Settings
            </NavLink>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400">
              VENDOR (FALLBACK)
            </div>
            <NavLink to="/vendor/dashboard" className={({ isActive }) => cls(isActive)}>
              Dashboard
            </NavLink>
            <NavLink to="/vendor/events" className={({ isActive }) => cls(isActive)}>
              Events
            </NavLink>
            <NavLink to="/vendor/applications" className={({ isActive }) => cls(isActive)}>
              Applications
            </NavLink>
            <NavLink to="/vendor/profile" className={({ isActive }) => cls(isActive)}>
              Vendor Profile
            </NavLink>
          </div>

          <div className="mt-8 text-xs text-slate-400">
            Current role: <span className="text-slate-600">{role}</span>
          </div>
        </aside>

        {/* main */}
        <main className="flex-1">
          <div className="border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">
                  {isOrganizer ? "Organizer Dashboard" : isVendor ? "Event Portal" : "Public"}
                </div>
                <div className="text-xs text-slate-500">{loc.pathname}</div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Public
                </Link>
                <button
                  onClick={onSignOut}
                  className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
