import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearSession, readSession } from "../../auth/authStorage";
import VendCoreLogo from "../ui/VendCoreLogo";

export default function PublicTopNav({ current = "" }: { current?: string }) {
  const navigate = useNavigate();
  const session = useMemo(() => readSession(), []);

  const navLink = (to: string, label: string, key: string) => (
    <Link
      to={to}
      className={[
        "text-sm font-bold transition",
        current === key ? "text-brand-900" : "text-slate-600 hover:text-brand-800",
      ].join(" ")}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" className="shrink-0">
          <VendCoreLogo size={150} />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navLink("/events", "Events", "events")}
          {navLink("/vendors", "Vendors", "vendors")}
          {navLink("/organizers", "Organizers", "organizers")}
          {navLink("/venues", "Venues", "venues")}
          {navLink("/pricing", "Pricing", "pricing")}
        </nav>

        {session?.accessToken ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-900 transition hover:bg-slate-100"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                clearSession();
                navigate("/login");
              }}
              className="rounded-xl bg-brand-900 px-5 py-2 text-sm font-black text-white transition hover:bg-brand-800"
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-900 transition hover:bg-slate-100"
            >
              Sign In
            </Link>
            <Link
              to="/get-started"
              className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-black text-white transition hover:bg-brand-700"
            >
              Get Started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
