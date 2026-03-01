export type AuthRole = "vendor" | "organizer" | "admin";

export type AuthSession = {
  accessToken: string;
  role: AuthRole;
  email?: string;
};

const TOKEN_KEY = "accessToken";
const ROLE_KEY = "userRole";
const EMAIL_KEY = "userEmail";

export function readSession(): AuthSession | null {
  const accessToken = localStorage.getItem(TOKEN_KEY);
  const roleRaw = (localStorage.getItem(ROLE_KEY) || "").toLowerCase();
  const email = localStorage.getItem(EMAIL_KEY) || undefined;

  if (!accessToken) return null;
  if (roleRaw !== "vendor" && roleRaw !== "organizer" && roleRaw !== "admin") return null;

  return { accessToken, role: roleRaw as AuthRole, email };
}

export function writeSession(s: AuthSession) {
  localStorage.setItem(TOKEN_KEY, s.accessToken);
  localStorage.setItem(ROLE_KEY, s.role);

  // ✅ Always overwrite email to prevent “inheriting” previous user
  if (s.email) localStorage.setItem(EMAIL_KEY, s.email);
  else localStorage.removeItem(EMAIL_KEY);

  // Optional: clear per-user caches on login/session write
  localStorage.removeItem("vendor_profile_v1");
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(EMAIL_KEY);

  // Optional caches
  localStorage.removeItem("vendor_profile_v1");
}
