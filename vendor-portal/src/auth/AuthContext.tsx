import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  readSession,
  writeSession,
  type AuthRole,
  type AuthSession,
} from "./authStorage";

const API_BASE = import.meta.env.VITE_API_BASE;

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

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const payloadPart = parts[1];
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function deriveRoleFromToken(accessToken: string): AuthRole | null {
  const claims = decodeJwtPayload(accessToken);
  if (!claims) return null;

  const direct =
    normalizeRole(claims.role) ||
    normalizeRole(claims.user_role) ||
    normalizeRole(claims.app_role);

  if (direct) return direct;

  if (Array.isArray(claims.roles) && claims.roles.length > 0) {
    const first = normalizeRole(claims.roles[0]);
    if (first) return first;
  }

  return null;
}

function deriveEmailFromToken(accessToken: string): string | null {
  const claims = decodeJwtPayload(accessToken);
  if (!claims) return null;

  const raw =
    claims.email ||
    claims.user_email ||
    claims.username ||
    claims.sub ||
    null;

  const email = String(raw ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
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
    const requestedRole = role;

    clearSession();
    setSession(null);

    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        role: requestedRole,
      }),
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

    const tokenRole = deriveRoleFromToken(accessToken);
    const finalRole = tokenRole ?? requestedRole;

    const tokenEmail = deriveEmailFromToken(accessToken);
    const finalEmail = tokenEmail ?? String(email || "").trim().toLowerCase();

    const next: AuthSession = {
      accessToken,
      role: finalRole,
      email: finalEmail,
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

    const text = await res.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    const newToken = pickToken(data);

    if (!newToken) {
      logout();
      return false;
    }

    const tokenRole = deriveRoleFromToken(newToken);
    const tokenEmail = deriveEmailFromToken(newToken);

    const next: AuthSession = {
      accessToken: newToken,
      role: tokenRole ?? current.role,
      email: tokenEmail ?? current.email,
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





