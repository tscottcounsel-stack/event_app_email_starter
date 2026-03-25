import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
  role?: "vendor" | "organizer" | "admin" | string;
  companyName?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readUserFromStorage(): AuthUser | null {
  const keys = ["currentUser", "user", "auth_user", "vendorconnect_user"];
  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.id || parsed.userId)) {
        return {
          id: String(parsed.id || parsed.userId),
          email: parsed.email,
          name: parsed.name,
          role: parsed.role,
          companyName: parsed.companyName || parsed.organizationName,
        };
      }
    } catch {
      // ignore invalid json
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readUserFromStorage());

  useEffect(() => {
    const onStorage = () => setUser(readUserFromStorage());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const signOut = async () => {
    // Clear common keys
    ["currentUser", "user", "auth_user", "vendorconnect_user", "token", "access_token"].forEach((k) =>
      localStorage.removeItem(k)
    );
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(() => ({ user, setUser, signOut }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // This is intentional: you forgot to wrap AuthProvider around the app.
    throw new Error("useAuth must be used within <AuthProvider>.");
  }
  return ctx;
}





