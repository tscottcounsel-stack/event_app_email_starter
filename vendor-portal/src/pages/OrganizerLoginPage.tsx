import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, login, setUserRole } from "../api";

export default function OrganizerLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("organizer@example.com");
  const [password, setPassword] = React.useState("password");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);

      // mark role for Layout/router
      setUserRole("organizer");

      // ✅ go to dashboard, not events
      navigate("/organizer/dashboard", { replace: true });
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] p-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6">
        <div className="text-xl font-semibold">Organizer Login</div>
        <div className="mt-1 text-sm text-slate-600">
          Manage events, layouts, and vendor applications.
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <div className="text-sm font-medium">Email</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <div className="text-sm font-medium">Password</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>

          <button
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <Link to="/vendor/login" className="text-indigo-700 hover:underline">
            Vendor Login
          </Link>
          <Link to="/register" className="text-indigo-700 hover:underline">
            Create account
          </Link>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Auth endpoint: POST /login
        </div>
      </div>
    </div>
  );
}
