// src/pages/DiagramAdmin.tsx
import React, { useEffect, useState } from "react";
import { DiagramEditor } from "../components/DiagramEditor";

type DiagramAdminProps = {
  eventId: number;
};

type LoginRole = "organizer" | "vendor";

const DEV_DEFAULTS: Record<LoginRole, { email: string; password: string }> = {
  organizer: { email: "organizer@example.com", password: "changeme123" },
  vendor: { email: "vendor@example.com", password: "changeme123" },
};

type LoginBarProps = {
  currentRole: LoginRole | null;
  onAuthChange: (token: string | null, role: LoginRole | null) => void;
};

const LoginBar: React.FC<LoginBarProps> = ({ currentRole, onAuthChange }) => {
  const [loadingRole, setLoadingRole] = useState<LoginRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastLogin, setLastLogin] = useState<string | null>(null);

  const baseUrl =
    (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8001";

  async function handleLogin(role: LoginRole) {
    setLoadingRole(role);
    setError(null);

    try {
      const creds = DEV_DEFAULTS[role];

      const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: creds.email,
          password: creds.password,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || "login failed"}`);
      }

      const data: { access_token?: string } = await res.json();
      if (!data.access_token) {
        throw new Error("Login succeeded but no access_token in response.");
      }

      onAuthChange(data.access_token, role);
      setLastLogin(`${role} @ ${new Date().toLocaleTimeString()}`);
    } catch (err: any) {
      console.error("Login error", err);
      setError(
        err?.message ||
          "Login failed. Check server logs or credentials and try again."
      );
      onAuthChange(null, null);
      setLastLogin(null);
    } finally {
      setLoadingRole(null);
    }
  }

  function handleLogout() {
    onAuthChange(null, null);
    setLastLogin(null);
    setError(null);
  }

  const isBusy = loadingRole !== null;

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-slate-300">
          Role:{" "}
          <span className="font-semibold text-white">
            {currentRole ?? "none"}
          </span>
        </span>

        <button
          className="rounded-md bg-slate-800 px-2 py-1 text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={isBusy}
          onClick={() => handleLogin("organizer")}
          title="Dev login as organizer"
        >
          {loadingRole === "organizer" ? "Logging in…" : "Login organizer"}
        </button>

        <button
          className="rounded-md bg-slate-800 px-2 py-1 text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={isBusy}
          onClick={() => handleLogin("vendor")}
          title="Dev login as vendor"
        >
          {loadingRole === "vendor" ? "Logging in…" : "Login vendor"}
        </button>

        <button
          className="rounded-md border border-slate-700 bg-transparent px-2 py-1 text-slate-200 hover:bg-slate-900 disabled:opacity-60"
          disabled={isBusy}
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>

      {lastLogin && <div className="text-slate-400">Last: {lastLogin}</div>}
      {error && (
        <div className="max-w-[520px] text-right text-red-300">{error}</div>
      )}
    </div>
  );
};

const DiagramAdmin: React.FC<DiagramAdminProps> = ({ eventId }) => {
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem("apiToken") || null;
    } catch {
      return null;
    }
  });

  const [role, setRole] = useState<LoginRole | null>(() => {
    try {
      const raw = window.localStorage.getItem("apiRole");
      if (raw === "organizer" || raw === "vendor") return raw;
      return null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (authToken) window.localStorage.setItem("apiToken", authToken);
      else window.localStorage.removeItem("apiToken");
    } catch {
      // ignore
    }
  }, [authToken]);

  useEffect(() => {
    try {
      if (role) window.localStorage.setItem("apiRole", role);
      else window.localStorage.removeItem("apiRole");
    } catch {
      // ignore
    }
  }, [role]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <div>
            <h1 className="text-lg font-semibold">Diagram Admin</h1>
            <div className="text-xs text-slate-400">
              Event #{eventId} · Token:{" "}
              {authToken ? "present" : "(none — unauthenticated)"}
            </div>
          </div>

          <LoginBar
            currentRole={role}
            onAuthChange={(token, nextRole) => {
              setAuthToken(token);
              setRole(nextRole);
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <DiagramEditor
            eventId={eventId}
            authToken={authToken ?? undefined}
            role={role ?? undefined}
          />
        </div>
      </main>
    </div>
  );
};

export default DiagramAdmin;
