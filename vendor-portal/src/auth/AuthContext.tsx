import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  readSession,
  writeSession,
  type AuthRole,
  type AuthSession,
} from "./authStorage";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

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

/* ---------- Helpers ---------- */

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

    const payload = parts[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
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

  // Common claim names: email, user_email, username, sub
  const raw =
    claims.email ||
    claims.user_email ||
    claims.username ||
    claims.sub ||
    null;

  const email = String(raw ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/* ---------- Provider ---------- */

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

    // ✅ Ensure we never “inherit” previous user's email/profile caches
    clearSession();
    setSession(null);

    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username: email, password, role: requestedRole }),
    });

    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");

    if (!res.ok) {
      const msg =
        (typeof body === "string" && body.trim()) ||
        (body && typeof body === "object" && (body.detail || body.message || JSON.stringify(body))) ||
        `Login failed (${res.status})`;
      throw new Error(msg);
    }

    const data = body && typeof body === "object" ? body : {};
    const accessToken = pickToken(data);
    if (!accessToken) throw new Error("Server did not return an access_token");

    const tokenRole = deriveRoleFromToken(accessToken);
    const finalRole = tokenRole ?? requestedRole;

    // ✅ Use token email if present (prevents “typed email” mismatch / dev stub weirdness)
    const tokenEmail = deriveEmailFromToken(accessToken);
    const finalEmail = tokenEmail ?? String(email || "").trim().toLowerCase();

    const next: AuthSession = { accessToken, role: finalRole, email: finalEmail };
    writeSession(next);
    setSession(next);
  };

  const refresh: AuthState["refresh"] = async () => {
    const current = readSession();
    if (!current?.accessToken) return false;

    const res = await fetch(`${API_BASE}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${current.accessToken}` },
    });

    if (!res.ok) {
      logout();
      return false;
    }

    const data = await res.json().catch(() => ({}));
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
      // ✅ keep email in sync with token claims if present
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
