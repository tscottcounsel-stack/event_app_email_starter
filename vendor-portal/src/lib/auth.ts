export type LoginResp = {
  access_token: string;
  token_type?: string;
  role?: string;
  user_id?: number;
  email?: string;
};

const TOKEN_KEY = "access_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(tok: string) {
  localStorage.setItem(TOKEN_KEY, tok);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
export function isAuthed() {
  return Boolean(getToken());
}

export async function login(email: string, password: string) {
  // FastAPI's OAuth2PasswordRequestForm expects form-encoded *username/password*
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);

  const resp = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      // Important: form-encoding, not JSON
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Login failed (${resp.status})`);
  }

  const data = (await resp.json()) as LoginResp;
  if (!data?.access_token) throw new Error("No access_token in response");

  setToken(data.access_token);
  return data; // role/email available if you want to store them too
}
