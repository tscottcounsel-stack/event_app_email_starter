// vendor-portal/src/pages/OrganizerContactsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, createOrganizerContact, fetchOrganizerContacts } from "../api";

type Contact = {
  id: number;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  created_at?: string;
  updated_at?: string;
};

type OrganizerContactsList = {
  items: Contact[];
  count: number;
  value?: Contact[]; // legacy
  Count?: number; // legacy
};

type DryRunRecipient = {
  contact_id: number;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  rendered_text: string;
  reason_skipped?: string | null;
};

type DryRunResponse = {
  channel: "email" | "sms";
  subject?: string | null;
  body: string;
  eligible: DryRunRecipient[];
  skipped: DryRunRecipient[];
};

type BulkMessageSummary = {
  id: number;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  status: string;
  created_at?: string | null;
  queued_at?: string | null;
  sent_at?: string | null;
  eligible_count?: number | null;
  skipped_count?: number | null;
};

type BulkMessageRecipientOut = {
  id?: number;
  contact_id: number;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  status: "eligible" | "skipped" | "queued" | "sent" | "failed" | string;
  reason_skipped?: string | null;
  rendered_text?: string | null;
};

type BulkMessageListResponse = {
  items: BulkMessageSummary[];
  count: number;
};

type BulkMessageDetailResponse = {
  message: BulkMessageSummary;
  recipients: BulkMessageRecipientOut[];
};

function normalizeTags(input: string): string[] {
  const raw = input
    .split(",")
    .map((s) => s.trim())
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

function renderTemplate(
  template: string,
  c: Pick<Contact, "name" | "company" | "email" | "phone">
) {
  const name = c.name ?? "";
  const company = c.company ?? "";
  const email = c.email ?? "";
  const phone = c.phone ?? "";
  return (template ?? "")
    .replaceAll("{name}", name)
    .replaceAll("{company}", company)
    .replaceAll("{email}", email)
    .replaceAll("{phone}", phone);
}

function escapeCsvValue(v: string): string {
  const needsQuotes = /[",\n\r]/.test(v);
  const safe = v.replace(/"/g, '""');
  return needsQuotes ? `"${safe}"` : safe;
}

function downloadTextFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function nowStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ButtonPill(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "soft" | "ghost";
  className?: string;
  title?: string;
}) {
  const { children, onClick, disabled, variant = "soft", className = "", title } = props;
  const base =
    "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : variant === "ghost"
      ? "bg-white border hover:bg-gray-50"
      : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200";
  return (
    <button
      className={`${base} ${styles} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function ModalShell(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
  headerRight?: React.ReactNode;
  firstFocusRef?: React.RefObject<HTMLButtonElement>;
}) {
  const { title, subtitle, onClose, children, maxWidthClass = "max-w-3xl", headerRight, firstFocusRef } = props;

  // Esc closes
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(() => firstFocusRef?.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [firstFocusRef]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${maxWidthClass} max-h-[85vh] rounded-2xl bg-white shadow-xl border flex flex-col`}>
        <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            {subtitle && <div className="text-sm text-gray-500 mt-1">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              className="px-3 py-2 rounded-lg bg-black text-white hover:opacity-90"
              onClick={onClose}
              title="Close (Esc)"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export default function OrganizerContactsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  // UI-only event dropdown
  const [eventFilter, setEventFilter] = useState<string>("all");

  // Add Contact modal
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newTags, setNewTags] = useState("");

  // Compose modal
  const [composeOpen, setComposeOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);

  // Queued campaigns (Phase 2 — persistence)
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<BulkMessageSummary[]>([]);
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [campaignDetail, setCampaignDetail] = useState<BulkMessageDetailResponse | null>(null);

  const composeFirstFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadContacts() {
    setError(null);
    setLoading(true);
    try {
      const res = (await fetchOrganizerContacts()) as OrganizerContactsList;
      setContacts(res.items || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  async function refreshContacts() {
    setError(null);
    setRefreshing(true);
    try {
      const res = (await fetchOrganizerContacts()) as OrganizerContactsList;
      setContacts(res.items || []);
      setToast("Contacts refreshed.");
    } catch (e: any) {
      setError(e?.message || "Failed to refresh contacts");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadCampaigns() {
    setCampaignsError(null);
    setCampaignsLoading(true);
    try {
      const res = await apiGet<BulkMessageListResponse>("/organizer/messages");
      setCampaigns(res.items || []);
    } catch (e: any) {
      // campaigns are optional: don’t destabilize the page
      setCampaignsError(e?.message || "Failed to load queued campaigns");
    } finally {
      setCampaignsLoading(false);
    }
  }

  async function openCampaignDetail(id: number) {
    setCampaignsError(null);
    setCampaignDetailLoading(true);
    setCampaignDetail(null);
    setCampaignDetailOpen(true);
    try {
      const res = await apiGet<BulkMessageDetailResponse>(`/organizer/messages/${id}`);
      setCampaignDetail(res);
    } catch (e: any) {
      setCampaignsError(e?.message || "Failed to load campaign details");
      setCampaignDetailOpen(false);
    } finally {
      setCampaignDetailLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
    loadCampaigns();
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) for (const t of c.tags || []) s.add(t);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tf = tagFilter.trim();
    return contacts.filter((c) => {
      const matchesSearch =
        !q ||
        (c.name || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q);

      const matchesTag = !tf || (c.tags || []).includes(tf);
      return matchesSearch && matchesTag;
    });
  }, [contacts, search, tagFilter]);

  const selectedContacts = useMemo(() => {
    const m = new Map<number, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return Array.from(selectedIds).map((id) => m.get(id)).filter(Boolean) as Contact[];
  }, [contacts, selectedIds]);

  const emailEligibleCount = useMemo(() => selectedContacts.filter((c) => !!c.email).length, [selectedContacts]);
  const smsEligibleCount = useMemo(() => selectedContacts.filter((c) => !!c.phone).length, [selectedContacts]);

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.id);
      return next;
    });
    setToast(filtered.length ? `Selected ${filtered.length} (filtered) contacts.` : "No contacts to select.");
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setToast("Selection cleared.");
  }

  async function saveContact() {
    setError(null);

    const name = newName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }

    try {
      await createOrganizerContact({
        name,
        company: newCompany.trim() || null,
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
        tags: normalizeTags(newTags),
      });

      setToast("Contact saved.");
      setAddOpen(false);
      setNewName("");
      setNewCompany("");
      setNewEmail("");
      setNewPhone("");
      setNewTags("");

      await refreshContacts();
    } catch (e: any) {
      setError(e?.message || "Failed to save contact");
    }
  }

  function openCompose(ch: "email" | "sms") {
    setChannel(ch);
    setComposeOpen(true);
    setDryRun(null);
  }

  function closeCompose() {
    setComposeOpen(false);
    setDryRun(null);
  }

  function insertVar(v: string) {
    const el = document.getElementById("compose-body") as HTMLTextAreaElement | null;
    if (!el) {
      setBody((prev) => (prev || "") + v);
      return;
    }
    const start = el.selectionStart ?? (el.value || "").length;
    const end = el.selectionEnd ?? start;
    const before = (body || "").slice(0, start);
    const after = (body || "").slice(end);
    const next = `${before}${v}${after}`;
    setBody(next);

    setTimeout(() => {
      el.focus();
      const pos = start + v.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  }

  async function runDryRun() {
    setError(null);
    setDryRunLoading(true);
    try {
      const payload = {
        channel,
        subject: channel === "email" ? (subject.trim() || null) : null,
        body: body ?? "",
        contact_ids: Array.from(selectedIds),
      };
      const res = await apiPost<DryRunResponse>("/organizer/messages/dry-run", payload);
      setDryRun(res);
      setToast("Dry-run complete.");
    } catch (e: any) {
      setError(e?.message || "Dry-run failed");
    } finally {
      setDryRunLoading(false);
    }
  }

  async function queueCampaign() {
    setError(null);

    if (selectedIds.size === 0) {
      setToast("Select at least one contact.");
      return;
    }

    const payload = {
      channel,
      subject: channel === "email" ? (subject.trim() || null) : null,
      body: body ?? "",
      contact_ids: Array.from(selectedIds),
    };

    try {
      const res = await apiPost<any>("/organizer/messages/queue", payload);
      const id = (res && (res.bulk_message_id ?? res.id)) as number | undefined;
      setToast(id ? `Queued campaign #${id}.` : "Queued campaign.");

      await loadCampaigns();
      setDryRun(null); // avoid preview confusion after queue
    } catch (e: any) {
      setError(e?.message || "Failed to queue campaign");
    }
  }

  function exportContactsCsvTop() {
    const rows = filtered;
    const header = ["id", "name", "company", "email", "phone", "tags"].join(",");
    const lines = rows.map((c) => {
      const tags = (c.tags || []).join("|");
      return [
        String(c.id),
        escapeCsvValue(c.name || ""),
        escapeCsvValue(c.company || ""),
        escapeCsvValue(c.email || ""),
        escapeCsvValue(c.phone || ""),
        escapeCsvValue(tags),
      ].join(",");
    });
    const csv = [header, ...lines].join("\n");
    downloadTextFile(`contacts_${nowStamp()}.csv`, csv, "text/csv");
    setToast("Exported CSV.");
  }

  function exportRecipientsCsvFromModal() {
    const use = dryRun ? [...(dryRun.eligible || []), ...(dryRun.skipped || [])] : selectedContacts.map((c) => ({
      contact_id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      rendered_text: renderTemplate(body ?? "", c),
      reason_skipped: null,
    }));

    const header = [
      "contact_id",
      "name",
      "company",
      "email",
      "phone",
      "rendered_text",
      "reason_skipped",
    ].join(",");

    const lines = use.map((r: any) =>
      [
        String(r.contact_id),
        escapeCsvValue(r.name || ""),
        escapeCsvValue(r.company || ""),
        escapeCsvValue(r.email || ""),
        escapeCsvValue(r.phone || ""),
        escapeCsvValue(r.rendered_text || ""),
        escapeCsvValue(r.reason_skipped || ""),
      ].join(",")
    );

    const csv = [header, ...lines].join("\n");
    downloadTextFile(`recipients_${channel}_${nowStamp()}.csv`, csv, "text/csv");
    setToast("Recipients CSV exported.");
  }

  async function copyRecipientList() {
    const list =
      dryRun?.eligible?.length
        ? dryRun.eligible
            .map((r) => (channel === "email" ? r.email : r.phone))
            .filter(Boolean)
            .join("\n")
        : selectedContacts
            .map((c) => (channel === "email" ? c.email : c.phone))
            .filter(Boolean)
            .join("\n");

    if (!list.trim()) {
      setToast("No recipients to copy.");
      return;
    }

    const ok = await copyToClipboard(list);
    setToast(ok ? "Recipients copied." : "Copy failed.");
  }

  async function copyRenderedMessage() {
    const first =
      dryRun?.eligible?.[0] ||
      (selectedContacts[0]
        ? ({
            rendered_text: renderTemplate(body ?? "", selectedContacts[0]),
          } as any)
        : null);

    if (!first?.rendered_text) {
      setToast("Nothing to copy yet.");
      return;
    }

    const ok = await copyToClipboard(String(first.rendered_text));
    setToast(ok ? "Rendered message copied." : "Copy failed.");
  }

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Contact Management</h1>

        {toast && <div className="mb-4 rounded-lg border bg-white px-4 py-3 text-sm">{toast}</div>}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Top control card */}
        <div className="rounded-2xl border bg-white shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Contact Management</div>
              <div className="text-sm text-gray-500 mt-1">
                {loading ? "Loading…" : `${contacts.length} total contacts`} • {selectedIds.size} selected
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap justify-end">
              <ButtonPill variant="primary" onClick={() => setAddOpen(true)}>
                + Add Contact
              </ButtonPill>

              <ButtonPill
                variant="primary"
                onClick={() => setToast("Import CSV is UI-only for Phase 1 (safe).")}
                title="UI-only (safe)"
              >
                ⬆ Import CSV
              </ButtonPill>

              <ButtonPill
                variant="primary"
                onClick={exportContactsCsvTop}
                disabled={filtered.length === 0}
                title="Exports current filtered contacts list"
              >
                ⬇ Export CSV
              </ButtonPill>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4 flex-wrap">
            <select
              className="w-full sm:w-[360px] rounded-xl border px-4 py-3 text-sm bg-white"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              title="UI-only for now"
            >
              <option value="all">All Events</option>
            </select>

            <ButtonPill
              variant="soft"
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              className="bg-emerald-200 text-emerald-900 hover:bg-emerald-300"
            >
              ✓ Select All
            </ButtonPill>

            <ButtonPill
              variant="soft"
              onClick={() => openCompose("email")}
              disabled={selectedIds.size === 0}
              className="bg-indigo-200 text-indigo-900 hover:bg-indigo-300"
              title="Opens compose modal"
            >
              ✉ Email ({emailEligibleCount})
            </ButtonPill>

            <ButtonPill
              variant="soft"
              onClick={() => openCompose("sms")}
              disabled={selectedIds.size === 0}
              className="bg-violet-200 text-violet-900 hover:bg-violet-300"
              title="Opens compose modal"
            >
              💬 Text ({smsEligibleCount})
            </ButtonPill>

            <button
              className="ml-auto text-sm text-gray-500 hover:text-gray-800"
              onClick={clearSelection}
              disabled={selectedIds.size === 0}
              title="Clear selection"
            >
              Clear selection
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <input
              className="w-full sm:w-[360px] rounded-xl border px-4 py-3 text-sm"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="rounded-xl border px-4 py-3 text-sm bg-white"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button
              className="text-sm text-gray-500 hover:text-gray-800"
              onClick={() => {
                setSearch("");
                setTagFilter("");
              }}
            >
              Clear filters
            </button>

            <button
              className="text-sm text-gray-500 hover:text-gray-800"
              onClick={refreshContacts}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Queued Campaigns (Phase 2) */}
        <div className="rounded-2xl border bg-white shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Queued Campaigns</div>
              <div className="text-sm text-gray-500 mt-1">Saved campaigns (no provider sending yet).</div>
            </div>

            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
              onClick={loadCampaigns}
              disabled={campaignsLoading}
            >
              {campaignsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {campaignsError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {campaignsError}
            </div>
          )}

          {campaignsLoading ? (
            <div className="mt-4 text-sm text-gray-600">Loading queued campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="mt-6 text-sm text-gray-600">
              No queued campaigns yet. Select contacts → Compose → Queue campaign.
            </div>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3 w-20">ID</th>
                    <th className="text-left px-4 py-3 w-28">Channel</th>
                    <th className="text-left px-4 py-3">Subject</th>
                    <th className="text-left px-4 py-3 w-28">Status</th>
                    <th className="text-left px-4 py-3 w-40">Queued</th>
                    <th className="text-left px-4 py-3 w-24">Eligible</th>
                    <th className="text-left px-4 py-3 w-24">Skipped</th>
                    <th className="text-left px-4 py-3 w-28">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((m) => (
                    <tr key={m.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">#{m.id}</td>
                      <td className="px-4 py-3 uppercase text-xs tracking-wide">{m.channel}</td>
                      <td className="px-4 py-3">{m.subject || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full border bg-white text-xs">
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {m.queued_at || m.created_at || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">{m.eligible_count ?? <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">{m.skipped_count ?? <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <button
                          className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
                          onClick={() => openCampaignDetail(m.id)}
                          title="View recipients"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Contacts panel */}
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-6 py-5 border-b">
            <div className="text-lg font-semibold">Contacts</div>
          </div>

          {loading ? (
            <div className="p-10 text-sm text-gray-600">Loading contacts…</div>
          ) : filtered.length === 0 ? (
            <div className="p-14 text-center">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                <span className="text-2xl">👥</span>
              </div>
              <div className="text-lg font-medium text-gray-700">No contacts found</div>
              <div className="text-sm text-gray-500 mt-1">Add contacts manually or import from CSV</div>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-6 py-3 w-12"></th>
                    <th className="text-left px-6 py-3">Name</th>
                    <th className="text-left px-6 py-3">Company</th>
                    <th className="text-left px-6 py-3">Email</th>
                    <th className="text-left px-6 py-3">Phone</th>
                    <th className="text-left px-6 py-3">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const checked = selectedIds.has(c.id);
                    return (
                      <tr key={c.id} className="border-t hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <input type="checkbox" checked={checked} onChange={() => toggleSelect(c.id)} />
                        </td>
                        <td className="px-6 py-3 font-medium">{c.name || <span className="text-gray-400">—</span>}</td>
                        <td className="px-6 py-3">{c.company || <span className="text-gray-400">—</span>}</td>
                        <td className="px-6 py-3">{c.email || <span className="text-gray-400">—</span>}</td>
                        <td className="px-6 py-3">{c.phone || <span className="text-gray-400">—</span>}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(c.tags || []).length === 0 ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              c.tags.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full border bg-white text-xs"
                                >
                                  {t}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Contact Modal */}
        {addOpen && (
          <ModalShell
            title="Add Contact"
            subtitle="Create a new organizer contact."
            onClose={() => setAddOpen(false)}
            maxWidthClass="max-w-2xl"
          >
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="rounded-xl border px-4 py-3 text-sm"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="rounded-xl border px-4 py-3 text-sm"
                  placeholder="Company"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                />
                <input
                  className="rounded-xl border px-4 py-3 text-sm"
                  placeholder="Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <input
                  className="rounded-xl border px-4 py-3 text-sm"
                  placeholder="Phone"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>

              <input
                className="rounded-xl border px-4 py-3 text-sm w-full"
                placeholder="Tags (comma-separated, e.g., vip, sponsor)"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button className="px-4 py-2 rounded-lg border hover:bg-gray-50" onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" onClick={saveContact}>
                  Save
                </button>
              </div>
            </div>
          </ModalShell>
        )}

        {/* Campaign Detail Modal */}
        {campaignDetailOpen && (
          <ModalShell
            title={campaignDetail?.message ? `Campaign #${campaignDetail.message.id}` : "Campaign"}
            subtitle="Recipients snapshot for this queued campaign."
            onClose={() => {
              setCampaignDetailOpen(false);
              setCampaignDetail(null);
            }}
            maxWidthClass="max-w-5xl"
          >
            <div className="p-5">
              {campaignDetailLoading ? (
                <div className="text-sm text-gray-600">Loading details…</div>
              ) : !campaignDetail ? (
                <div className="text-sm text-gray-600">No details loaded.</div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-white p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm text-gray-500">Channel</div>
                        <div className="font-medium uppercase">{campaignDetail.message.channel}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Status</div>
                        <div className="font-medium">{campaignDetail.message.status}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Eligible</div>
                        <div className="font-medium">{campaignDetail.message.eligible_count ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Skipped</div>
                        <div className="font-medium">{campaignDetail.message.skipped_count ?? "—"}</div>
                      </div>
                    </div>

                    {campaignDetail.message.subject !== null && (
                      <div className="mt-3">
                        <div className="text-sm text-gray-500">Subject</div>
                        <div className="text-sm">
                          {campaignDetail.message.subject || <span className="text-gray-400">—</span>}
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <div className="text-sm text-gray-500">Body</div>
                      <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-xs">
                        {campaignDetail.message.body}
                      </pre>
                    </div>

                    <div className="mt-3">
                      <button
                        className="px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
                        onClick={async () => {
                          const ok = await copyToClipboard(campaignDetail.message.body || "");
                          setToast(ok ? "Campaign body copied." : "Copy failed.");
                        }}
                      >
                        Copy body
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-white shadow-sm overflow-auto">
                    <div className="px-5 py-4 border-b">
                      <div className="text-lg font-semibold">Recipients</div>
                      <div className="text-sm text-gray-500 mt-1">{campaignDetail.recipients.length} total</div>
                    </div>

                    {campaignDetail.recipients.length === 0 ? (
                      <div className="p-6 text-sm text-gray-600">No recipients stored.</div>
                    ) : (
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left px-5 py-3 w-24">ID</th>
                            <th className="text-left px-5 py-3">Name</th>
                            <th className="text-left px-5 py-3">Email</th>
                            <th className="text-left px-5 py-3">Phone</th>
                            <th className="text-left px-5 py-3 w-28">Status</th>
                            <th className="text-left px-5 py-3">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaignDetail.recipients.map((r, idx) => (
                            <tr key={`${r.contact_id}-${idx}`} className="border-t">
                              <td className="px-5 py-3 font-medium">{r.contact_id}</td>
                              <td className="px-5 py-3">{r.name || <span className="text-gray-400">—</span>}</td>
                              <td className="px-5 py-3">{r.email || <span className="text-gray-400">—</span>}</td>
                              <td className="px-5 py-3">{r.phone || <span className="text-gray-400">—</span>}</td>
                              <td className="px-5 py-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full border bg-white text-xs">
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-5 py-3">{r.reason_skipped || <span className="text-gray-400">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ModalShell>
        )}

        {/* Compose Modal */}
        {composeOpen && (
          <ModalShell
            title="Compose"
            subtitle="Preview-only. No sending. Use dry-run for eligible/skipped + rendered text."
            onClose={closeCompose}
            maxWidthClass="max-w-5xl"
            firstFocusRef={composeFirstFocusRef}
            headerRight={
              <div className="flex items-center gap-2">
                <button
                  ref={composeFirstFocusRef}
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                  onClick={exportRecipientsCsvFromModal}
                  title={dryRun ? "Export eligible/skipped with rendered text" : "Export selected"}
                >
                  Export recipients CSV
                </button>
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                  onClick={copyRecipientList}
                  title="Copy eligible recipient addresses (or selected if no dry-run yet)"
                >
                  Copy recipients
                </button>
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50"
                  onClick={copyRenderedMessage}
                  title="Copy rendered message for the first eligible preview"
                >
                  Copy rendered message
                </button>
                <button
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  onClick={queueCampaign}
                  disabled={selectedIds.size === 0 || (channel === "email" ? emailEligibleCount : smsEligibleCount) === 0}
                  title="Persist as queued (no real sending yet)"
                >
                  Queue campaign
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 h-full">
              <div className="p-5 border-b lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Channel</span>
                    <div className="inline-flex rounded-lg border overflow-hidden">
                      <button
                        className={`px-3 py-2 text-sm ${channel === "email" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
                        onClick={() => {
                          setChannel("email");
                          setDryRun(null);
                        }}
                      >
                        Email
                      </button>
                      <button
                        className={`px-3 py-2 text-sm ${channel === "sms" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
                        onClick={() => {
                          setChannel("sms");
                          setDryRun(null);
                        }}
                      >
                        SMS
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-gray-600">
                    Selected: <span className="font-medium">{selectedIds.size}</span>
                    <span className="text-gray-400"> • </span>
                    Eligible:{" "}
                    <span className="font-medium">{channel === "email" ? emailEligibleCount : smsEligibleCount}</span>
                  </div>
                </div>

                {channel === "email" && (
                  <div className="mt-4">
                    <label className="text-sm font-medium">Subject</label>
                    <input
                      className="mt-1 w-full rounded-xl border px-4 py-3 text-sm"
                      placeholder="Subject (optional)"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                )}

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Message</label>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Insert:</span>
                      <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => insertVar("{name}")}>
                        {"{name}"}
                      </button>
                      <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => insertVar("{company}")}>
                        {"{company}"}
                      </button>
                      <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => insertVar("{email}")}>
                        {"{email}"}
                      </button>
                      <button className="px-2 py-1 rounded border hover:bg-gray-50" onClick={() => insertVar("{phone}")}>
                        {"{phone}"}
                      </button>
                    </div>
                  </div>

                  <textarea
                    id="compose-body"
                    className="mt-1 w-full rounded-xl border px-4 py-3 text-sm min-h-[220px]"
                    placeholder={`Write your ${channel.toUpperCase()} message… (preview only)`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    Variables: <span className="font-mono">{`{name} {company} {email} {phone}`}</span>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    className="px-4 py-2 rounded-lg bg-black text-white hover:opacity-90 disabled:opacity-50"
                    onClick={runDryRun}
                    disabled={dryRunLoading || selectedIds.size === 0}
                  >
                    {dryRunLoading ? "Running…" : "Dry-run"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg border hover:bg-gray-50"
                    onClick={() => {
                      setDryRun(null);
                      setToast("Preview reset.");
                    }}
                  >
                    Reset preview
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold">Preview</div>
                    <div className="text-sm text-gray-500 mt-1">
                      Showing first 3 recipients. (From dry-run)
                    </div>
                  </div>

                  <div className="text-sm text-gray-600">
                    Eligible: <span className="font-medium">{dryRun?.eligible?.length ?? 0}</span>
                    <span className="text-gray-400"> • </span>
                    Skipped: <span className="font-medium">{dryRun?.skipped?.length ?? 0}</span>
                  </div>
                </div>

                {!dryRun ? (
                  <div className="mt-6 text-sm text-gray-600">
                    Run <span className="font-medium">Dry-run</span> to see eligible/skipped recipients and rendered message text.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {(dryRun.eligible || []).slice(0, 3).map((r) => (
                      <div key={r.contact_id} className="rounded-xl border bg-white p-4">
                        <div className="font-medium">{r.name || "—"}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {r.company ? `${r.company} • ` : ""}
                          {channel === "email" ? r.email : r.phone}
                        </div>
                        <div className="mt-3 text-sm whitespace-pre-wrap">{r.rendered_text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ModalShell>
        )}
      </div>
    </div>
  );
}
