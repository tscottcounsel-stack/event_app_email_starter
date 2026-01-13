import React, { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createOrganizerContact,
  fetchOrganizerContacts,
  updateOrganizerContact,
} from "../api";

type Contact = {
  id: number;
  organizer_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  tags: string[];
};

function parseTags(input: string): string[] {
  if (!input) return [];
  const raw = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function tagsToString(tags: string[]): string {
  return (tags ?? []).join(", ");
}

function appendTagToInput(existing: string, tag: string): string {
  const current = parseTags(existing);
  const t = (tag ?? "").trim();
  if (!t) return existing;
  const exists = current.some((x) => x.toLowerCase() === t.toLowerCase());
  if (exists) return tagsToString(current);
  return tagsToString([...current, t]);
}

function apiErrorToMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    return String((err as any).message);
  }
  return "Something went wrong.";
}

function normalize(s: unknown): string {
  return (s ?? "").toString().toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string): React.ReactNode {
  const t = (text ?? "").toString();
  const q = (query ?? "").trim();
  if (!t || !q) return t;

  // Keep it safe + simple: literal substring highlighting, case-insensitive
  const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
  const parts = t.split(re);

  if (parts.length <= 1) return t;

  return (
    <>
      {parts.map((p, i) => {
        const isMatch = p.toLowerCase() === q.toLowerCase();
        return isMatch ? (
          <mark key={i} className="rounded px-1">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        );
      })}
    </>
  );
}

export default function OrganizerContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New contact form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Contact> | null>(null);
  const [editTagsInput, setEditTagsInput] = useState("");

  // Search + filters
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"name_asc" | "newest" | "oldest">(
    "name_asc"
  );

  const qNorm = useMemo(() => (query ?? "").trim(), [query]);

  async function load() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchOrganizerContacts();
      const list = (res?.value ?? []) as Contact[];
      setItems(list);
    } catch (e) {
      setErrorMsg(apiErrorToMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 2500);
    return () => clearTimeout(t);
  }, [successMsg]);

  const nameError = useMemo(() => {
    if (!nameTouched) return null;
    if (!name.trim()) return "Name is required.";
    return null;
  }, [nameTouched, name]);

  const newContactCanSubmit = useMemo(() => {
    return !!name.trim() && !savingNew && savingId === null;
  }, [name, savingNew, savingId]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setNameTouched(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    if (!name.trim()) return;

    setSavingNew(true);
    try {
      await createOrganizerContact({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        company: company.trim() || null,
        notes: notes.trim() || null,
        tags: parseTags(tagsInput),
      });

      setSuccessMsg("Contact saved.");
      setName("");
      setEmail("");
      setPhone("");
      setCompany("");
      setTagsInput("");
      setNotes("");
      setNameTouched(false);

      await load();
    } catch (e2) {
      setErrorMsg(apiErrorToMessage(e2));
    } finally {
      setSavingNew(false);
    }
  }

  function startEdit(c: Contact) {
    setSuccessMsg(null);
    setErrorMsg(null);
    setEditingId(c.id);
    setEditDraft({
      id: c.id,
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      company: c.company ?? "",
      notes: c.notes ?? "",
      tags: c.tags ?? [],
    });
    setEditTagsInput((c.tags ?? []).join(", "));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditTagsInput("");
  }

  async function saveEdit() {
    if (!editingId || !editDraft) return;

    const draftName = (editDraft.name ?? "").toString().trim();
    if (!draftName) {
      setErrorMsg("Name is required to save changes.");
      return;
    }

    setSavingId(editingId);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await updateOrganizerContact(editingId, {
        name: draftName,
        email: (editDraft.email ?? "").toString().trim() || null,
        phone: (editDraft.phone ?? "").toString().trim() || null,
        company: (editDraft.company ?? "").toString().trim() || null,
        notes: (editDraft.notes ?? "").toString().trim() || null,
        tags: parseTags(editTagsInput),
      });

      setSuccessMsg("Changes saved.");
      cancelEdit();
      await load();
    } catch (e) {
      setErrorMsg(apiErrorToMessage(e));
    } finally {
      setSavingId(null);
    }
  }

  // Tag cloud
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of items) {
      for (const t of c.tags ?? []) {
        const key = t.trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => {
        const dc = b[1] - a[1];
        if (dc !== 0) return dc;
        return a[0].localeCompare(b[0]);
      })
      .map(([tag, count]) => ({ tag, count }));
  }, [items]);

  // Filter + sort
  const filtered = useMemo(() => {
    const q = normalize(query).trim();

    let list = items.slice();

    if (tagFilter) {
      const tf = tagFilter.toLowerCase();
      list = list.filter((c) =>
        (c.tags ?? []).some((t) => t.toLowerCase() === tf)
      );
    }

    if (q) {
      list = list.filter((c) => {
        const hay = [
          c.name,
          c.email,
          c.phone,
          c.company,
          c.notes,
          ...(c.tags ?? []),
        ]
          .map(normalize)
          .join(" | ");
        return hay.includes(q);
      });
    }

    if (sortMode === "name_asc") {
      list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    } else if (sortMode === "newest") {
      list.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    } else if (sortMode === "oldest") {
      list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    }

    return list;
  }, [items, query, tagFilter, sortMode]);

  const showingText = useMemo(() => {
    const total = items.length;
    const shown = filtered.length;
    if (total === shown) return `${shown}`;
    return `${shown} of ${total}`;
  }, [items.length, filtered.length]);

  const busy = loading || savingNew || savingId !== null;

  function handleTagClick(tag: string) {
    // If editing, quick-add to the edit tags input.
    if (editingId !== null) {
      setEditTagsInput((prev) => appendTagToInput(prev, tag));
      return;
    }
    // Otherwise filter.
    setTagFilter((prev) =>
      prev?.toLowerCase() === tag.toLowerCase() ? null : tag
    );
  }

  const highlightOn = editingId === null && qNorm.length > 0;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Organizer Contacts</h1>
          <p className="text-sm opacity-70">
            Upload/import later. For now this is a stable form + list wiring.
          </p>
        </div>

        <a className="text-sm underline" href="/organizer/profile">
          ← Back to Profile
        </a>
      </div>

      <div className="mt-4 space-y-3">
        {successMsg && (
          <div className="rounded-xl border border-green-300 bg-green-50 p-3 text-sm">
            <div className="font-semibold">Success</div>
            <div>{successMsg}</div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm">
            <div className="font-semibold">Error</div>
            <div>{errorMsg}</div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Create form */}
        <div className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Add a contact</h2>

          <form className="mt-4 space-y-4" onSubmit={onCreate}>
            <div>
              <label className="text-sm font-medium" htmlFor="contact_name">
                Name <span className="text-red-600">*</span>
              </label>
              <input
                id="contact_name"
                name="name"
                autoComplete="name"
                className={`mt-1 w-full rounded-xl border p-2 ${
                  nameError ? "border-red-400" : ""
                }`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="Jane Vendor"
              />
              {nameError && (
                <div className="mt-1 text-xs text-red-600">{nameError}</div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="contact_email">
                Email
              </label>
              <input
                id="contact_email"
                name="email"
                autoComplete="email"
                className="mt-1 w-full rounded-xl border p-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@vendor.com"
              />
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="contact_phone">
                Phone
              </label>
              <input
                id="contact_phone"
                name="phone"
                autoComplete="tel"
                className="mt-1 w-full rounded-xl border p-2"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="404-555-5555"
              />
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="contact_company">
                Company
              </label>
              <input
                id="contact_company"
                name="company"
                autoComplete="organization"
                className="mt-1 w-full rounded-xl border p-2"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Peanuts Co"
              />
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="contact_tags">
                Tags (comma-separated)
              </label>
              <input
                id="contact_tags"
                name="tags"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border p-2"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="food truck, VIP, sponsor"
              />
              <div className="mt-1 text-xs opacity-70">
                We’ll auto-trim and de-dupe tags.
              </div>
            </div>

            <div>
              <label className="text-sm font-medium" htmlFor="contact_notes">
                Notes
              </label>
              <textarea
                id="contact_notes"
                name="notes"
                className="mt-1 w-full rounded-xl border p-2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Met at Holiday Bazaar. Great response time."
                rows={4}
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              disabled={!newContactCanSubmit}
            >
              {savingNew ? "Saving…" : "Save contact"}
            </button>
          </form>
        </div>

        {/* List + search */}
        <div className="rounded-2xl border p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold">Contacts ({showingText})</div>
            <button
              className="text-sm underline disabled:opacity-50"
              onClick={load}
              disabled={busy}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* Search + sort */}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label className="sr-only" htmlFor="contacts_search">
                Search contacts
              </label>
              <input
                id="contacts_search"
                name="contacts_search"
                autoComplete="off"
                className="w-full rounded-xl border p-2"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, phone, company, notes, tags…"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm opacity-70" htmlFor="contacts_sort">
                Sort
              </label>
              <select
                id="contacts_sort"
                className="rounded-xl border p-2 text-sm"
                value={sortMode}
                onChange={(e) =>
                  setSortMode(e.target.value as "name_asc" | "newest" | "oldest")
                }
              >
                <option value="name_asc">Name (A→Z)</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          </div>

          {/* Tag filter chips */}
          {allTags.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Tags{" "}
                  {editingId !== null ? (
                    <span className="ml-2 text-xs font-normal opacity-60">
                      (click to add to edit tags)
                    </span>
                  ) : null}
                </div>
                {(tagFilter || query) && (
                  <button
                    className="text-sm underline"
                    onClick={() => {
                      setTagFilter(null);
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {allTags.slice(0, 16).map(({ tag, count }) => {
                  const active =
                    tagFilter?.toLowerCase() === tag.toLowerCase() &&
                    editingId === null;

                  return (
                    <button
                      key={`tag-${tag}`}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active ? "bg-black text-white" : ""
                      }`}
                      onClick={() => handleTagClick(tag)}
                      title={
                        editingId !== null
                          ? `Add "${tag}" to edit tags`
                          : `Filter by ${tag}`
                      }
                    >
                      {highlightOn ? highlightText(tag, qNorm) : tag}{" "}
                      <span className="opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>

              {allTags.length > 16 && (
                <div className="mt-1 text-xs opacity-60">
                  Showing top 16 tags.
                </div>
              )}
            </div>
          )}

          <div className="mt-4">
            {filtered.length === 0 ? (
              <div className="text-sm opacity-70">
                {items.length === 0
                  ? "No contacts yet."
                  : "No matches. Try clearing filters."}
              </div>
            ) : (
              <ul className="space-y-3">
                {filtered.map((c) => {
                  const isEditing = editingId === c.id;
                  const isSavingThis = savingId === c.id;

                  const showName = c.name || "(no name)";
                  const showEmail = c.email || "";
                  const showPhone = c.phone || "";
                  const showCompany = c.company || "";
                  const showNotes = c.notes || "";

                  return (
                    <li key={c.id} className="rounded-2xl border p-4">
                      {!isEditing ? (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="font-semibold">
                                {highlightOn
                                  ? highlightText(showName, qNorm)
                                  : showName}
                              </div>

                              <div className="mt-1 text-sm opacity-80">
                                {showEmail ? (
                                  <div>
                                    {highlightOn
                                      ? highlightText(showEmail, qNorm)
                                      : showEmail}
                                  </div>
                                ) : null}
                                {showPhone ? (
                                  <div>
                                    {highlightOn
                                      ? highlightText(showPhone, qNorm)
                                      : showPhone}
                                  </div>
                                ) : null}
                                {showCompany ? (
                                  <div>
                                    {highlightOn
                                      ? highlightText(showCompany, qNorm)
                                      : showCompany}
                                  </div>
                                ) : null}
                              </div>

                              {c.tags?.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {c.tags.map((t) => (
                                    <button
                                      key={`${c.id}-tag-${t}`}
                                      type="button"
                                      className="rounded-full border px-2 py-0.5 text-xs"
                                      onClick={() => handleTagClick(t)}
                                      title="Filter by this tag"
                                    >
                                      {highlightOn
                                        ? highlightText(t, qNorm)
                                        : t}
                                    </button>
                                  ))}
                                </div>
                              ) : null}

                              {showNotes ? (
                                <div className="mt-2 text-sm opacity-80">
                                  {highlightOn
                                    ? highlightText(showNotes, qNorm)
                                    : showNotes}
                                </div>
                              ) : null}
                            </div>

                            <button
                              className="text-sm underline"
                              onClick={() => startEdit(c)}
                            >
                              Edit
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div className="font-semibold">Edit contact</div>
                            <button
                              className="text-sm underline disabled:opacity-50"
                              onClick={cancelEdit}
                              disabled={isSavingThis}
                            >
                              Cancel
                            </button>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3">
                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_name_${c.id}`}
                              >
                                Name <span className="text-red-600">*</span>
                              </label>
                              <input
                                id={`edit_name_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                value={(editDraft?.name ?? "") as string}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...(prev ?? {}),
                                    name: e.target.value,
                                  }))
                                }
                              />
                            </div>

                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_email_${c.id}`}
                              >
                                Email
                              </label>
                              <input
                                id={`edit_email_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                value={(editDraft?.email ?? "") as string}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...(prev ?? {}),
                                    email: e.target.value,
                                  }))
                                }
                              />
                            </div>

                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_phone_${c.id}`}
                              >
                                Phone
                              </label>
                              <input
                                id={`edit_phone_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                value={(editDraft?.phone ?? "") as string}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...(prev ?? {}),
                                    phone: e.target.value,
                                  }))
                                }
                              />
                            </div>

                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_company_${c.id}`}
                              >
                                Company
                              </label>
                              <input
                                id={`edit_company_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                value={(editDraft?.company ?? "") as string}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...(prev ?? {}),
                                    company: e.target.value,
                                  }))
                                }
                              />
                            </div>

                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_tags_${c.id}`}
                              >
                                Tags (comma-separated)
                              </label>
                              <input
                                id={`edit_tags_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                value={editTagsInput}
                                onChange={(e) => setEditTagsInput(e.target.value)}
                              />
                              <div className="mt-1 text-xs opacity-70">
                                Tip: while editing, click any tag chip to add it
                                here.
                              </div>
                            </div>

                            <div>
                              <label
                                className="text-sm font-medium"
                                htmlFor={`edit_notes_${c.id}`}
                              >
                                Notes
                              </label>
                              <textarea
                                id={`edit_notes_${c.id}`}
                                className="mt-1 w-full rounded-xl border p-2"
                                rows={3}
                                value={(editDraft?.notes ?? "") as string}
                                onChange={(e) =>
                                  setEditDraft((prev) => ({
                                    ...(prev ?? {}),
                                    notes: e.target.value,
                                  }))
                                }
                              />
                            </div>

                            <button
                              className="w-full rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
                              onClick={saveEdit}
                              disabled={savingId !== null || savingNew}
                            >
                              {isSavingThis ? "Saving…" : "Save changes"}
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
