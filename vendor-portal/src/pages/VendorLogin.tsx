// src/pages/VendorLoginPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, setAuthTokens, clearAuthTokens } from "../api";

type LoginResponse = {
  access_token: string;
  token_type: string;
};

const VendorLoginPage: React.FC = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // Backend expects "username" for email
      const body = {
        username: email.trim(),
        password,
      };

      const res = await apiPost<LoginResponse>("/auth/login/json", body);

      // Store token with role = "vendor"
      setAuthTokens(res.access_token, "vendor");

      // Go to vendor events list
      navigate("/vendor/events");
    } catch (err: any) {
      console.error("Vendor login failed", err);
      clearAuthTokens();
      setError(err?.message ?? "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Vendor Login</h1>
          <p className="text-sm text-gray-600">
            Sign in to view and apply for events.
          </p>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              autoComplete="username"
              className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vendor@example.com"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 rounded-lg bg-blue-600 text-white text-sm font-medium py-2.5 hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in as Vendor"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default VendorLoginPage;
