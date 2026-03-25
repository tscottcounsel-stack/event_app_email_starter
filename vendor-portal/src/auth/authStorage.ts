export type AuthRole = "vendor" | "organizer" | "admin";

export type AuthSession = {
  accessToken: string;
  role: AuthRole;
  email?: string;
};

const TOKEN_KEY = "accessToken";
const ROLE_KEY = "userRole";
const EMAIL_KEY = "userEmail";
const LEGACY_SESSION_KEY = "auth_session";

function normalizeRole(value: unknown): AuthRole | null {
  const roleRaw = String(value || "").toLowerCase().trim();
  if (roleRaw === "vendor" || roleRaw === "organizer" || roleRaw === "admin") {
    return roleRaw as AuthRole;
  }
  return null;
}

function readLegacySession(): Partial<AuthSession> | null {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      accessToken:
        parsed.accessToken ||
        parsed.token ||
        parsed.access_token ||
        parsed.jwt ||
        "",
      role:
        normalizeRole(parsed.role || parsed.userRole || parsed.accountType || parsed.type) ||
        undefined,
      email:
        parsed.email || parsed.userEmail || parsed.username || undefined,
    };
  } catch {
    return null;
  }
}

export function readSession(): AuthSession | null {
  const accessToken = localStorage.getItem(TOKEN_KEY) || "";
  const role = normalizeRole(localStorage.getItem(ROLE_KEY));
  const email = localStorage.getItem(EMAIL_KEY) || undefined;

  if (accessToken && role) {
    return { accessToken, role, email };
  }

  const legacy = readLegacySession();
  const legacyRole = normalizeRole(legacy?.role);
  const legacyToken = String(legacy?.accessToken || "").trim();
  const legacyEmail = legacy?.email ? String(legacy.email).trim() : undefined;

  if (!legacyToken || !legacyRole) return null;

  return {
    accessToken: legacyToken,
    role: legacyRole,
    email: legacyEmail,
  };
}

export function writeSession(s: AuthSession) {
  localStorage.setItem(TOKEN_KEY, s.accessToken);
  localStorage.setItem(ROLE_KEY, s.role);

  if (s.email) localStorage.setItem(EMAIL_KEY, s.email);
  else localStorage.removeItem(EMAIL_KEY);

  localStorage.setItem(
    LEGACY_SESSION_KEY,
    JSON.stringify({
      accessToken: s.accessToken,
      role: s.role,
      email: s.email || "",
    })
  );

  localStorage.removeItem("vendor_profile_v1");
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  localStorage.removeItem("vendor_profile_v1");
}



