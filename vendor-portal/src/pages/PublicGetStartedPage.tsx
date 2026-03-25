import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type Role = "vendor" | "organizer";

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        <Link
          to="/login"
          className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

function RoleCard({
  active,
  title,
  subtitle,
  icon,
  bullets,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  bullets: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-[28px] border p-7 text-left shadow-sm transition",
        active ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      <div className="flex items-start gap-5">
        <div className={["grid h-14 w-14 place-items-center rounded-2xl", active ? "bg-indigo-50" : "bg-slate-50"].join(" ")}>
          {icon}
        </div>

        <div className="min-w-0">
          <div className="text-2xl font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>

          <ul className="mt-5 space-y-2 text-sm font-semibold text-slate-700">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className={active ? "text-indigo-600" : "text-slate-400"}>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {active ? (
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-black text-indigo-700">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-white">✓</span>
              Selected
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function PublicGetStartedPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(null);

  const vendorBullets = useMemo(
    () => ["Browse verified events", "Choose your business categories for better search placement", "Showcase your portfolio", "Secure payment processing"],
    []
  );

  const organizerBullets = useMemo(
    () => ["Create unlimited events", "Custom booth layouts", "Vendor applications management", "Payment & analytics dashboard"],
    []
  );

  function goNext() {
    if (!role) return;
    navigate(`/create-account?role=${role}`);
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />

      <section className="bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tight text-slate-900">Create Your Account</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base font-semibold text-slate-600">
              Join VendorConnect&apos;s trusted marketplace of verified organizers and vendors
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-2">
            <RoleCard
              active={role === "vendor"}
              title="Vendor"
              subtitle="Apply to events, manage your business profile, and book booths."
              icon={<span className="text-2xl">🏪</span>}
              bullets={vendorBullets}
              onClick={() => setRole("vendor")}
            />

            <RoleCard
              active={role === "organizer"}
              title="Organizer"
              subtitle="Create events, manage vendors, sell booth space, and accept payments."
              icon={<span className="text-2xl">📅</span>}
              bullets={organizerBullets}
              onClick={() => setRole("organizer")}
            />
          </div>

          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={goNext}
              disabled={!role}
              className={[
                "rounded-2xl px-16 py-4 text-base font-black text-white shadow-sm transition",
                role ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-95" : "bg-slate-300 cursor-not-allowed",
              ].join(" ")}
            >
              Continue
            </button>
          </div>

          <div className="mt-6 text-center text-sm font-semibold text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-black text-indigo-700 hover:text-indigo-800">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}



