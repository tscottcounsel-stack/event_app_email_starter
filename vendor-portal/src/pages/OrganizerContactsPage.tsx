// vendor-portal/src/pages/OrganizerContactsPage.tsx
import React from "react";
import { Link } from "react-router-dom";
import { fetchOrganizerContacts, createOrganizerContact, ApiError } from "../api";

type Contact = {
  id?: number;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  tags?: string[] | string;
  notes?: string;
};

function asArray(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x.items)) return x.items;
  if (Array.isArray(x.results)) return x.results;
  return [];
}

export default function OrganizerContactsPage() {
  const [loading, setLoading] = React.useState(false);
  const [notImplemented, setNotImplemented] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<Contact[]>([]);

  const [form, setForm] = React.useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    tags: "",
    notes: "",
  });

  async function load() {
    setLoading(true);
    setError(null);
    setNotImplemented(false);

    try {
      const res = await fetchOrganizerContacts();

      // api.ts returns null on 404 (endpoint not built yet)
      if (!res) {
        setNotImplemented(true);
        setItems([]);
        return;
      }

      const arr = asArray(res) as Contact[];
      setItems(arr);
    } catch (e: any) {
      if (e instanceof ApiError) {
        setError(`${e.message} (HTTP ${e.status})`);
        if (e.status === 404) setNotImplemented(true);
      } else {
        setError(e?.message || "Failed to load contacts");
      }
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const payload = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        company: form.company,
        tags: form.tags,
        notes: form.notes,
      };

      const res = await createOrganizerContact(payload);

      if (!res) {
        setNotImplemented(true);
        setError("Contacts API not enabled yet on the backend (404).");
        return;
      }

      // optimistic reload
      await load();

      setForm({ name: "", email: "", phone: "", company: "", tags: "", notes: "" });
    } catch (e: any) {
      if (e instanceof ApiError) setError(`${e.message} (HTTP ${e.status})`);
      else setError(e?.message || "Failed to add contact");
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Organizer Contacts</h2>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            Upload/import later. For now this is a stable form + list wiring.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/organizer/profile" style={{ textDecoration: "none" }}>
            ← Back to Profile
          </Link>
        </div>
      </div>

      {loading && <p style={{ marginTop: 12 }}>Loading…</p>}

      {!loading && (error || notImplemented) && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f2b8b5", borderRadius: 12 }}>
          <strong>Contacts not available yet</strong>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            {error ? error : "Backend endpoint is not implemented (404)."}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
            This page is wired and stable; we’ll enable it once the backend routes exist.
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <form onSubmit={onCreate} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>Add a contact</h3>

          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <label style={{ marginTop: 8, display: "block" }}>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label style={{ marginTop: 8, display: "block" }}>Phone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

          <label style={{ marginTop: 8, display: "block" }}>Company</label>
          <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />

          <label style={{ marginTop: 8, display: "block" }}>Tags (comma-separated)</label>
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />

          <label style={{ marginTop: 8, display: "block" }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={4}
          />

          <button type="submit" style={{ marginTop: 12 }}>
            Add contact
          </button>
        </form>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            Contacts ({items.length})
            <button
              onClick={() => void load()}
              style={{ marginLeft: 10, fontSize: 13 }}
              type="button"
            >
              Refresh
            </button>
          </h3>

          {items.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No contacts yet.</div>
          ) : (
            <ul>
              {items.map((c, idx) => (
                <li key={c.id ?? idx}>
                  <strong>{c.name || "Unnamed"}</strong>{" "}
                  {c.email ? <span style={{ opacity: 0.8 }}>({c.email})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
