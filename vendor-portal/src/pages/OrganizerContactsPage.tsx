import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  createOrganizerContact,
  fetchOrganizerContacts,
  getAccessToken,
} from "../api";

type Contact = {
  id?: number;
  organizer_id?: number;
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  tags?: string[] | null;
};

function asArray(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x.value)) return x.value; // backend: { value, Count }
  if (Array.isArray(x.items)) return x.items;
  if (Array.isArray(x.results)) return x.results;
  return [];
}

function errText(e: any): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e?.message) return String(e.message);
  return String(e);
}

export default function OrganizerContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    tags: "",
    notes: "",
  });

  const canSave = useMemo(() => form.name.trim().length > 0, [form.name]);

  async function load() {
    setLoading(true);
    setError(null);
    setBanner(null);
    // keep success visible unless user refreshes manually or saves again

    const token = getAccessToken();
    if (!token) {
      setItems([]);
      setBanner("Log in as an organizer to view/save contacts.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetchOrganizerContacts(token);
      const arr = asArray(res);
      setItems(arr as Contact[]);
    } catch (e: any) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate() {
    setError(null);
    setBanner(null);
    setSuccess(null);

    const token = getAccessToken();
    if (!token) {
      setBanner("Log in as an organizer to save contacts.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      tags: form.tags, // api.ts normalizes this into string[]
      notes: form.notes.trim() || null,
    };

    try {
      setSaving(true);
      await createOrganizerContact(payload, token);

      setForm({ name: "", email: "", phone: "", company: "", tags: "", notes: "" });
      setSuccess("Contact saved.");
      await load();

      // re-focus for rapid entry
      setTimeout(() => nameRef.current?.focus(), 50);
    } catch (e: any) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Organizer Contacts</h1>
          <p className="text-sm opacity-80">
            Upload/import later. For now this is a stable form + list wiring.
          </p>
        </div>

        <Link to="/organizer/profile" className="text-sm underline">
          ← Back to Profile
        </Link>
      </div>

      {banner && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="font-semibold">Heads up</div>
          <div className="text-sm opacity-80">{banner}</div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
          <div className="font-semibold">Error</div>
          <div className="text-sm whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-4">
          <div className="font-semibold">Success</div>
          <div className="text-sm">{success}</div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Form */}
        <div className="rounded-2xl border p-4">
          <div className="mb-3 text-lg font-semibold">Add a contact</div>

          <div className="grid gap-3">
            <div>
              <label className="text-sm opacity-80" htmlFor="contact_name">
                Name
              </label>
              <input
                ref={nameRef}
                id="contact_name"
                name="name"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm opacity-80" htmlFor="contact_email">
                Email
              </label>
              <input
                id="contact_email"
                name="email"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm opacity-80" htmlFor="contact_phone">
                Phone
              </label>
              <input
                id="contact_phone"
                name="phone"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm opacity-80" htmlFor="contact_company">
                Company
              </label>
              <input
                id="contact_company"
                name="company"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm opacity-80" htmlFor="contact_tags">
                Tags (comma-separated)
              </label>
              <input
                id="contact_tags"
                name="tags"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm opacity-80" htmlFor="contact_notes">
                Notes
              </label>
              <textarea
                id="contact_notes"
                name="notes"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                rows={4}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <button
              className="mt-2 rounded-xl border px-4 py-2 font-medium disabled:opacity-50"
              onClick={onCreate}
              disabled={!canSave || saving}
            >
              {saving ? "Saving..." : "Save contact"}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">Contacts ({items.length})</div>
            <button
              className="text-sm underline disabled:opacity-50"
              onClick={() => {
                setSuccess(null);
                load();
              }}
              disabled={loading}
              title={loading ? "Refreshing..." : "Refresh"}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-3">
            {items.length === 0 ? (
              <div className="text-sm opacity-70">No contacts yet.</div>
            ) : (
              <ul className="space-y-3">
                {items.map((c) => (
                  <li
                    key={c.id ?? `${c.name || ""}-${c.email || ""}-${Math.random()}`}
                    className="rounded-xl border p-3"
                  >
                    <div className="font-semibold">{c.name || "(no name)"}</div>
                    <div className="text-sm opacity-80">
                      {c.email ? <div>{c.email}</div> : null}
                      {c.phone ? <div>{c.phone}</div> : null}
                      {c.company ? <div>{c.company}</div> : null}
                      {c.tags && c.tags.length ? (
                        <div>Tags: {c.tags.join(", ")}</div>
                      ) : null}
                      {c.notes ? <div className="mt-1">{c.notes}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
