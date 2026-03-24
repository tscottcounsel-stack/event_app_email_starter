// src/pages/PublicLoginPage.tsx
import React, { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type Role = "vendor" | "organizer";

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link to="/events" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Events
          </Link>
          <Link to="/vendors" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Vendors
          </Link>
          <Link to="/pricing" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/get-started"
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 text-sm font-black text-white"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function RolePill({
  active,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl border p-5 text-left transition ${
        active
          ? "border-indigo-400 bg-indigo-50 shadow-sm"
          : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm">
          <span className="text-xl">{icon}</span>
        </div>

        <div className="flex-1">
          <div className="text-lg font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>
        </div>

        <div
          className={`mt-1 h-5 w-5 rounded-full border-2 ${
            active ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"
          }`}
        />
      </div>
    </button>
  );
}

function roleHome(role: string | null) {
  if (role === "admin") return "/admin";
  return role === "organizer" ? "/organizer/dashboard" : "/vendor/dashboard";
}

function pathMatchesRole(fromPath: string, role: string | null) {
  if (!fromPath || !role) return false;

  const p = fromPath.startsWith("/") ? fromPath : `/${fromPath}`;

  if (role === "admin") return p === "/admin" || p.startsWith("/admin/");
  if (role === "organizer") return p === "/organizer" || p.startsWith("/organizer/");
  return p === "/vendor" || p.startsWith("/vendor/");
}

function getStoredRole(): string | null {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) return null;

    if (token.startsWith("devtoken:")) {
      const parts = token.split(":");
      return parts[2] || null;
    }

    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    const payload = JSON.parse(atob(padded));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export default function PublicLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const roleRef = useRef<Role>("vendor");

  const [role, setRole] = useState<Role>("vendor");
  const [email, setEmail] = useState("vendor@example.com");
  const [password, setPassword] = useState("vendor123");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel = useMemo(() => (role === "vendor" ? "Vendor" : "Organizer"), [role]);

  function setRoleAndDefaults(next: Role) {
    roleRef.current = next;
    setRole(next);

    if (next === "organizer") {
      setEmail("organizer@example.com");
      setPassword("organizer123");
    } else {
      setEmail("vendor@example.com");
      setPassword("vendor123");
    }

    setError(null);
  }

  async function handleContinue(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault?.();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const submitRole = roleRef.current;

      await login({ email, password, role: submitRole });

      const actualRole = getStoredRole();
      const from = (location.state as any)?.from;
      const fallback = roleHome(actualRole);
      const dest =
        typeof from === "string" && pathMatchesRole(from, actualRole) ? from : fallback;

      setTimeout(() => {
        navigate(dest, { replace: true });
      }, 0);
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      <section className="bg-gradient-to-br from-indigo-100 via-white to-purple-100">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <div className="inline-flex rounded-full bg-indigo-100 px-4 py-2 text-sm font-black text-indigo-700">
                Sign in to VendorConnect
              </div>

              <h1 className="mt-6 text-5xl font-black leading-tight text-slate-900">
                Welcome back.
                <span className="block bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Let’s get you in.
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-base font-semibold text-slate-600">
                Choose your role, sign in, and pick up where you left off. Verified partners only — built for quality and
                trust.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <RolePill
                  active={role === "vendor"}
                  icon="🧳"
                  title="Vendor"
                  subtitle="Browse events, apply, book booths."
                  onClick={() => setRoleAndDefaults("vendor")}
                />
                <RolePill
                  active={role === "organizer"}
                  icon="📣"
                  title="Organizer"
                  subtitle="Create events, maps, and review apps."
                  onClick={() => setRoleAndDefaults("organizer")}
                />
              </div>

              <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold text-slate-600">
                <div className="inline-flex items-center gap-2">
                  <span className="text-emerald-600">✓</span> Secure sign-in
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="text-emerald-600">✓</span> Verified community
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="text-emerald-600">✓</span> Fast onboarding
                </div>
              </div>
            </div>

            <div>
              <div className="rounded-[34px] border border-slate-200 bg-white p-8 shadow-sm">
                <div className="text-2xl font-black text-slate-900">VendorConnect Login</div>
                <div className="mt-2 text-sm font-semibold text-slate-600">
                  Signing in as: <span className="font-black text-slate-900">{roleLabel}</span>
                </div>

                <form onSubmit={handleContinue} className="mt-8 space-y-4">
                  <div>
                    <label htmlFor="email" className="text-xs font-black text-slate-700">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="you@example.com"
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className="text-xs font-black text-slate-700">
                        Password
                      </label>

                      <Link
                        to="/forgot-password"
                        className="text-xs font-black text-indigo-700 hover:text-indigo-800"
                      >
                        Forgot password?
                      </Link>
                    </div>

                    <input
                      id="password"
                      name="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="••••••••"
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-400"
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  {error ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full rounded-2xl px-6 py-3 text-sm font-black text-white ${
                      loading ? "bg-slate-400" : "bg-gradient-to-r from-indigo-600 to-purple-600"
                    }`}
                  >
                    {loading ? "Signing In..." : "Sign In"}
                  </button>
                </form>

                <div className="mt-6 text-center text-sm font-semibold text-slate-600">
                  Don’t have an account?{" "}
                  <Link to="/get-started" className="font-black text-indigo-700 hover:text-indigo-800">
                    Get Started
                  </Link>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-xs font-semibold text-slate-600">
                  <span className="font-black text-slate-900">Note:</span> Session is now managed globally (auto-restore
                  on refresh). If your token expires, we’ll refresh it via <code>/refresh</code>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
