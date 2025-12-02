// src/pages/DiagramAdmin.tsx
import React, { useEffect, useState } from "react";
import { DiagramEditor } from "../components/DiagramEditor";

type DiagramAdminProps = {
  eventId: number;
};

type LoginRole = "organizer" | "vendor";

const DEV_DEFAULTS: Record<LoginRole, { username: string; password: string }> = {
  organizer: {
    username: "organizer@example.com",
    password: "changeme123",
  },
  vendor: {
    username: "vendor1@example.com",
    password: "changeme123",
  },
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
    (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8011";

  async function handleLogin(role: LoginRole) {
    setLoadingRole(role);
    setError(null);

    try {
      const creds = DEV_DEFAULTS[role];

      const res = await fetch(`${baseUrl}/auth/login/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: creds.username,
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
        <button
          type="button"
          onClick={() => handleLogin("organizer")}
          disabled={isBusy}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingRole === "organizer" ? "Logging in…" : "Organizer login"}
        </button>

        <button
          type="button"
          onClick={() => handleLogin("vendor")}
          disabled={isBusy}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingRole === "vendor" ? "Logging in…" : "Vendor login"}
        </button>

        {currentRole && (
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-red-500/60 bg-transparent px-2 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/10"
          >
            Logout
          </button>
        )}
      </div>

      {currentRole ? (
        <div className="text-[11px] text-emerald-400">
          Logged in as{" "}
          <span className="font-semibold uppercase">{currentRole}</span>
          {lastLogin && <> • {lastLogin}</>}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400">
          Not logged in — using public API only
        </div>
      )}

      {error && (
        <div className="max-w-xs text-[11px] text-red-400">
          {error.length > 160 ? `${error.slice(0, 160)}…` : error}
        </div>
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

  const baseUrl =
    (import.meta as any).env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8011";

  useEffect(() => {
    try {
      if (authToken) {
        window.localStorage.setItem("apiToken", authToken);
      } else {
        window.localStorage.removeItem("apiToken");
      }

      if (role) {
        window.localStorage.setItem("apiRole", role);
      } else {
        window.localStorage.removeItem("apiRole");
      }
    } catch {
      // ignore storage issues in dev
    }
  }, [authToken, role]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Top bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Diagram Admin
            </h1>
            <p className="text-[11px] text-slate-400">
              Event #{eventId}{" "}
              {role && authToken
                ? `— logged in as ${role}`
                : "— login as organizer or vendor to test auth-protected APIs"}
            </p>
          </div>

          <LoginBar
            currentRole={role}
            onAuthChange={(token, nextRole) => {
              setAuthToken(token);
              setRole(nextRole);
            }}
          />
        </div>

        {/* tiny debug strip (E) */}
        <div className="border-t border-slate-800 bg-slate-950/70">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-1.5 text-[10px] text-slate-400">
            <div>
              API base:{" "}
              <span className="font-mono text-slate-300">{baseUrl}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>
                Role:{" "}
                <span className="font-mono text-slate-200">
                  {role ?? "none"}
                </span>
              </span>
              <span>
                Token:{" "}
                <span className="font-mono text-slate-300">
                  {authToken
                    ? `…${authToken.slice(-12)}`
                    : "(none — unauthenticated)"}
                </span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          {/* Pass authToken + role to DiagramEditor */}
          <DiagramEditor
            eventId={eventId}
            authToken={authToken ?? undefined}
            role={role}
          />
        </div>
      </main>
    </div>
  );
};

export default DiagramAdmin;
