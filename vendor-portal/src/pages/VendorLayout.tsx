import React, { useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

const LS_PROFILE_KEY = "vendor_profile_v1";

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const linkBase =
  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition";
const active = "bg-slate-100 text-slate-900";
const idle = "text-slate-700 hover:bg-slate-50 hover:text-slate-900";

function Icon({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white">
      {children}
    </span>
  );
}

export default function VendorLayout() {
  const navigate = useNavigate();

  const email = useMemo(() => {
    const p = safeJsonParse<any>(localStorage.getItem(LS_PROFILE_KEY));
    return String(p?.email || localStorage.getItem("userEmail") || "sam@hotdoggy.com");
  }, []);

  function handleLogout() {
    // Clear auth + session-ish keys
    localStorage.removeItem("accessToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userEmail");

    // Optional: clear vendor profile cache
    // localStorage.removeItem(LS_PROFILE_KEY);

    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="w-72 shrink-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-5 flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600" />
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold text-slate-900">Vendor Dashboard</div>
              <div className="truncate text-sm font-semibold text-slate-600">{email}</div>
            </div>
          </div>

          <nav className="space-y-2">
            <NavLink
              to="/vendor/dashboard"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM13 3h8v6h-8V3ZM3 17h8v4H3v-4Z" />
                </svg>
              </Icon>
              Dashboard
            </NavLink>

            <NavLink
              to="/vendor/applications"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6Z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8" />
                  <path d="M8 17h8" />
                </svg>
              </Icon>
              My Applications
            </NavLink>

            <NavLink
              to="/vendor/events"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 2v3M16 2v3M3 9h18" />
                  <path d="M5 6h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
                </svg>
              </Icon>
              Available Events
            </NavLink>

            <NavLink
              to="/vendor/verify"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4Z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </Icon>
              Get Verified
            </NavLink>

            <NavLink
              to="/vendor/profile/setup"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16" />
                  <path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
                  <path d="M6 7v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
                </svg>
              </Icon>
              Business Profile
            </NavLink>

            <NavLink
              to="/vendor/profile/public"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20a8 8 0 1 0-8-8 8 8 0 0 0 8 8Z" />
                  <path d="M8 14s1.5-2 4-2 4 2 4 2" />
                  <path d="M9 10h.01M15 10h.01" />
                </svg>
              </Icon>
              Public Profile
            </NavLink>

            <NavLink
              to="/vendor/messages"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
                </svg>
              </Icon>
              Messages
            </NavLink>

            <NavLink
              to="/vendor/settings"
              className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}
            >
              <Icon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                  <path d="M19.4 15a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8.4 8.4 0 0 0-1.7-1l-.3-2.6H11l-.3 2.6a8.4 8.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 13a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.6h4l.3-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6Z" />
                </svg>
              </Icon>
              Settings
            </NavLink>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
            >
              Logout
            </button>
          </div>

          <div className="mt-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}



