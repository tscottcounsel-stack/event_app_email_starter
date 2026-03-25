// src/pages/OrganizerLayout.tsx
import React, { useMemo } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  User,
  MessageSquare,
  CreditCard,
  Settings,
  LogOut,
  Shield,
} from "lucide-react";

/**
 * OrganizerLayout
 * - Fixed sidebar
 * - Fixed top header
 * - Main content scrolls (except "full-bleed" pages like Map Editor, which own their own scrolling)
 *
 * KEY SCROLL RULE:
 * - Every flex column ancestor must have min-h-0
 * - The scrolling element must have overflow-y-auto and flex-1
 */
export default function OrganizerLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  // TEMP admin check for now.
  // Later, replace with your real auth/session role source.

  // Pages that must be full-height + full-bleed (no padding) so inner panels can scroll
  const fullBleed =
    location.pathname.includes("/layout") ||
    location.pathname.includes("/map") ||
    location.pathname.toLowerCase().includes("mapeditor") ||
    location.pathname.toLowerCase().includes("boothmap");

  const { pageTitle, pageSubtitle } = useMemo(() => {
    const p = location.pathname.toLowerCase();

    // IMPORTANT: More specific routes must come BEFORE broader ones like "/organizer/events"
    if (p.includes("/organizer/vendor-preview")) {
      return {
        pageTitle: "Application Preview",
        pageSubtitle: "Review a vendor application and related details.",
      };
    }

    // Event Applications list (your screenshot route: /organizer/events/:eventId/applications)
    if (p.includes("/organizer/events") && p.includes("/applications")) {
      return {
        pageTitle: "Applications",
        pageSubtitle: "Review applications and manage booth reservations.",
      };
    }

    // Booth map editor / layout picker
    if (p.includes("/organizer/events") && p.includes("/layout")) {
      return {
        pageTitle: "Booth Map Editor",
        pageSubtitle: "Assign, change, or release booth reservations.",
      };
    }

    if (p.includes("/admin/payments")) {
      return {
        pageTitle: "Admin Payments",
        pageSubtitle: "Review marketplace payments and organizer payout status.",
      };
    }

    if (p.includes("/admin")) {
      return {
        pageTitle: "Admin Dashboard",
        pageSubtitle: "Monitor platform activity, payments, and verification flow.",
      };
    }

    if (p.includes("/organizer/dashboard")) {
      return {
        pageTitle: "Organizer Dashboard",
        pageSubtitle: "A command center for events, applications, and contacts.",
      };
    }

    if (p.includes("/organizer/events")) {
      return {
        pageTitle: "Events",
        pageSubtitle: "Create and manage events and their details.",
      };
    }

    if (p.includes("/organizer/contacts")) {
      return {
        pageTitle: "Contacts",
        pageSubtitle: "Manage your organizer contacts and invitations.",
      };
    }

    if (p.includes("/organizer/profile")) {
      return {
        pageTitle: "Organizer Profile",
        pageSubtitle: "Manage your organizer profile details.",
      };
    }

    if (p.includes("/organizer/messages")) {
      return {
        pageTitle: "Messaging",
        pageSubtitle: "Communicate with vendors and keep conversations organized.",
      };
    }

    // Fallback
    return {
      pageTitle: "Organizer",
      pageSubtitle: "A command center for events, applications, and contacts.",
    };
  }, [location.pathname]);

  function navClass(isActive: boolean) {
    return [
      "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition",
      isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100",
    ].join(" ");
  }

  function iconClass(isActive: boolean) {
    return [
      "h-5 w-5",
      isActive ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700",
    ].join(" ");
  }

  return (
    <div
      className="h-screen min-h-0 flex overflow-hidden bg-slate-50 text-slate-900"
      style={{
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-white p-5">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Users className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold">Organizer Dashboard</div>
            <div className="text-xs font-semibold text-slate-500">
              Manage events & applications
            </div>
          </div>
        </div>

        <nav className="space-y-1">
          <NavLink to="/organizer/dashboard" className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (
              <>
                <LayoutDashboard className={iconClass(isActive)} />
                <span>Dashboard</span>
              </>
            )}
          </NavLink>

          <NavLink to="/organizer/events" className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (
              <>
                <CalendarDays className={iconClass(isActive)} />
                <span>Events</span>
              </>
            )}
          </NavLink>

          <NavLink to="/organizer/contacts" className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (
              <>
                <Users className={iconClass(isActive)} />
                <span>Contacts</span>
              </>
            )}
          </NavLink>

          <NavLink to="/organizer/profile" className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (
              <>
                <User className={iconClass(isActive)} />
                <span>Organizer Profile</span>
              </>
            )}
          </NavLink>


        <NavLink to="/organizer/verify" className={({ isActive }) => navClass(isActive)}>
          {({ isActive }) => (
            <>
              <Shield className={iconClass(isActive)} />
              <span>Get Verified</span>
            </>
          )}
        </NavLink>
<NavLink
            to="/organizer/messages"
            className={({ isActive }) => navClass(isActive)}
          >
            {({ isActive }) => (
              <>
                <MessageSquare className={iconClass(isActive)} />
                <span>Messaging</span>
              </>
            )}
          </NavLink>


          {/* Optional future routes (disabled so we don't create broken links) */}
          <div className="mt-2">
            <div className="px-4 pb-2 pt-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
              Coming soon
            </div>
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-400">
              <CreditCard className="h-5 w-5 text-slate-300" />
              Billing
            </div>
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-400">
              <Settings className="h-5 w-5 text-slate-300" />
              Settings
            </div>
          </div>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-8 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-2xl font-extrabold">{pageTitle}</div>
              <div className="mt-1 text-sm text-slate-600">{pageSubtitle}</div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => navigate("/logout")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <div
          className={[
            "flex-1 min-h-0",
            fullBleed ? "overflow-hidden p-0" : "overflow-y-auto px-8 py-6",
          ].join(" ")}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}





