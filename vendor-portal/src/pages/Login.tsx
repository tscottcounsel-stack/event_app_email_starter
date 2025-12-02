import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "@/components/Card";
import { login } from "@/lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/vendor";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, pass);
      nav(next, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Login</h1>
      <Card>
        <form className="space-y-4" onSubmit={onSubmit}>
          {err && <p className="rounded-md bg-red-50 p-2 text-red-700">{err}</p>}
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input
              type="email"
              className="w-full rounded-lg border px-3 py-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-950"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Password</label>
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-950"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required
            />
          </div>
          <button
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </Card>
    </div>
  );
}
