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
    <div className="h-screen bg-white overflow-hidden">
      <div className="h-full flex">
        {/* left nav */}
        <aside className="w-64 border-r bg-white px-4 py-4 overflow-y-auto">
          <div className="mb-6">
            <div className="text-lg font-semibold">VendorConnect</div>
            <div className="text-xs text-slate-500">Verified vendors &amp; organizers</div>
          </div>

          {/* ORGANIZER NAV */}
          {isOrganizer && (
            <nav className="space-y-1">
              <NavLink to="/organizer/dashboard" className={({ isActive }) => cls(isActive)}>
                Dashboard
              </NavLink>

              <NavLink to="/organizer/events" className={({ isActive }) => cls(isActive)}>
                Events
              </NavLink>

              <NavLink to="/organizer/contacts" className={({ isActive }) => cls(isActive)}>
  Messaging
</NavLink>

              <NavLink to="/organizer/profile" className={({ isActive }) => cls(isActive)}>
                Organizer Profile
              </NavLink>

              <NavLink to="/organizer/billing" className={({ isActive }) => cls(isActive)}>
                Billing
              </NavLink>

              <NavLink to="/organizer/settings" className={({ isActive }) => cls(isActive)}>
                Settings
              </NavLink>
            </nav>
          )}

          {/* VENDOR NAV */}
          {isVendor && (
            <nav className="space-y-1">
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
            </nav>
          )}

          {/* PUBLIC NAV (only when not logged in) */}
          {!isOrganizer && !isVendor && (
            <nav className="space-y-1">
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
            </nav>
          )}
        </aside>

        {/* main */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* header */}
          <div className="border-b px-6 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">
                  {isOrganizer ? "Organizer Dashboard" : isVendor ? "Vendor Portal" : "Public"}
                </div>
                <div className="text-xs text-slate-500">{loc.pathname}</div>
              </div>

              <div className="flex items-center gap-2">
                {!isOrganizer && !isVendor && (
                  <Link
                    to="/"
                    className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Public
                  </Link>
                )}

                {(isOrganizer || isVendor) && (
                  <button
                    onClick={onSignOut}
                    className="rounded-full border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Sign Out
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
