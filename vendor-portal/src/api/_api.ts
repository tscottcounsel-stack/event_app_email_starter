const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8011";

export async function apiGet(path: string) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
    },
  });
  return res.json();
}

export async function apiPost(path: string, body: any) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}
