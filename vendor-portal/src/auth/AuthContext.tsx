import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  readSession,
  writeSession,
  type AuthRole,
  type AuthSession,
} from "./authStorage";

// ✅ FIXED API BASE
const RAW_API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "");

type AuthState = {
  session: AuthSession | null;
  isReady: boolean;
  isAuthed: boolean;
  role: AuthRole | null;
  email?: string;
  accessToken?: string;
  login: (payload: { email: string; password: string; role: AuthRole }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<boolean>;
};

const Ctx = createContext<AuthState | null>(null);

function pickToken(data: any): string | null {
  return data?.access_token || data?.accessToken || data?.token || null;
}

function normalizeRole(value: unknown): AuthRole | null {
  const r = String(value ?? "").trim().toLowerCase();
  if (r === "vendor" || r === "organizer" || r === "admin") return r as AuthRole;
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    setIsReady(true);
  }, []);

  const logout = () => {
    clearSession();
    setSession(null);
  };

  const login: AuthState["login"] = async ({ email, password, role }) => {
    if (!API_BASE) {
      throw new Error("API base URL is not configured");
    }

    clearSession();
    setSession(null);

    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, role }),
    });

    const text = await res.text();

    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const message =
        typeof data === "object" && data?.detail
          ? data.detail
          : typeof data === "string" && data
          ? data
          : `Login failed (${res.status})`;

      throw new Error(message);
    }

    const accessToken = pickToken(data);
    if (!accessToken) throw new Error("Server did not return an access_token");

    const next: AuthSession = {
      accessToken,
      role,
      email: String(email || "").trim().toLowerCase(),
    };

    writeSession(next);
    setSession(next);
  };

  const refresh: AuthState["refresh"] = async () => {
    const current = readSession();
    if (!current?.accessToken) return false;

    const res = await fetch(`${API_BASE}/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
      },
    });

    if (!res.ok) {
      logout();
      return false;
    }

    const data = await res.json().catch(() => null);
    const newToken = pickToken(data);

    if (!newToken) {
      logout();
      return false;
    }

    const next: AuthSession = {
      accessToken: newToken,
      role: current.role,
      email: current.email,
    };

    writeSession(next);
    setSession(next);
    return true;
  };

  const value = useMemo<AuthState>(() => {
    return {
      session,
      isReady,
      isAuthed: !!session?.accessToken,
      role: session?.role ?? null,
      email: session?.email,
      accessToken: session?.accessToken,
      login,
      logout,
      refresh,
    };
  }, [session, isReady]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
