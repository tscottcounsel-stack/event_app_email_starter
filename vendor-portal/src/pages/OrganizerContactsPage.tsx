// src/pages/OrganizerContactsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Upload,
  Download,
  Mail,
  MessageSquare,
  Star,
  StarOff,
  Search,
  X,
  Users,
  Tag,
  ListPlus,
  CheckSquare,
  Square,
  Trash2,
  Info,
  BarChart3,
  Link2,
  Send,
  UserPlus,
} from "lucide-react";

/* -------------------------------- Types -------------------------------- */

type Contact = {
  id: string;

  firstName: string;
  lastName: string;

  company?: string;
  title?: string;

  email?: string;
  phone?: string;

  city?: string;
  state?: string;

  vip?: boolean;
  tags: string[];
  lists: string[]; // custom list IDs

  notes?: string;

  createdAt: number;
  lastContactedAt?: number;
};

type ContactList = {
  id: string;
  name: string;
  createdAt: number;
};

type Activity = {
  id: string;
  type: "email" | "text";
  subject?: string;
  message: string;
  audience: "selected" | "filtered" | "vip";
  recipientsCount: number;
  createdAt: number;
};

type InviteLink = {
  id: string;
  label: string;
  url: string;
  createdAt: number;
  opens: number;
  applies: number;
};

type VendorPool = {
  id: string;
  name: string;
  contactIds: string[];
  createdAt: number;
};

const LS_CONTACTS = "vc.organizer.contacts.v1";
const LS_LISTS = "vc.organizer.contactLists.v1";
const LS_ACTIVITY = "vc.organizer.contactActivity.v1";
const LS_INVITE_LINKS = "vc.organizer.inviteLinks.v1";
const LS_VENDOR_POOLS = "vc.organizer.vendorPools.v1";

/* -------------------------------- Utils -------------------------------- */

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function now() {
  return Date.now();
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatDate(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function normalizeCsvValue(v: string) {
  return v.replace(/^"|"$/g, "").trim();
}

/**
 * Minimal CSV parser:
 * - Handles commas inside quotes (basic)
 * - Assumes header row
 * - Returns array of records keyed by header
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur = "";
  let inQuotes = false;
  const row: string[] = [];

  function pushCell() {
    row.push(cur);
    cur = "";
  }
  function pushRow() {
    rows.push([...row]);
    row.length = 0;
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && next === '"') {
      // escaped quote
      cur += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      pushCell();
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      // handle CRLF
      if (ch === "\r" && next === "\n") i++;
      pushCell();
      pushRow();
      continue;
    }

    cur += ch;
  }

  // last cell
  pushCell();
  if (row.some((c) => c.length > 0)) pushRow();

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => normalizeCsvValue(h).toLowerCase());
  const data = rows.slice(1);

  return data
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => {
      const rec: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rec[h] = normalizeCsvValue(r[idx] ?? "");
      });
      return rec;
    });
}

function toCsv(rows: Array<Record<string, string>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string) => {
    const s = (v ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ];
  return lines.join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------ UI Helpers ------------------------------ */

function PillButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "soft" | "neutral";
  leftIcon?: React.ReactNode;
  title?: string;
}) {
  const v = props.variant ?? "neutral";
  const base =
    "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-extrabold transition border";
  const styles =
    v === "primary"
      ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
      : v === "soft"
      ? "bg-indigo-50 text-indigo-900 border-indigo-100 hover:bg-indigo-100"
      : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50";

  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cx(
        base,
        styles,
        props.disabled && "opacity-50 cursor-not-allowed hover:bg-white"
      )}
    >
      {props.leftIcon}
      {props.children}
    </button>
  );
}

function SmallChip(props: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={cx(
        "rounded-full border px-3 py-1 text-xs font-extrabold transition",
        props.active
          ? "bg-indigo-50 text-indigo-800 border-indigo-200"
          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
      )}
    >
      {props.children}
    </button>
  );
}

function ModalShell(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  widthClass?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className={cx("w-full rounded-2xl bg-white shadow-xl", props.widthClass ?? "max-w-2xl")}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-lg font-extrabold text-slate-900">{props.title}</div>
            {props.subtitle ? (
              <div className="mt-1 text-sm font-semibold text-slate-600">{props.subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full p-2 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-700" />
          </button>
        </div>

        <div className="px-6 py-6">{props.children}</div>

        {props.footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
            {props.footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Toast(props: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => props.onClose(), 2400);
    return () => window.clearTimeout(t);
  }, [props]);

  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-900 shadow-lg">
        {props.message}
      </div>
    </div>
  );
}

/* -------------------------------- Page -------------------------------- */

type Segment = "all" | "vip";

export default function OrganizerContactsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<string>("");

  const [contacts, setContacts] = useState<Contact[]>(
    safeParseJSON<Contact[]>(typeof window !== "undefined" ? localStorage.getItem(LS_CONTACTS) : null, [])
  );
  const [lists, setLists] = useState<ContactList[]>(
    safeParseJSON<ContactList[]>(typeof window !== "undefined" ? localStorage.getItem(LS_LISTS) : null, [])
  );
  const [activity, setActivity] = useState<Activity[]>(
    safeParseJSON<Activity[]>(typeof window !== "undefined" ? localStorage.getItem(LS_ACTIVITY) : null, [])
  );
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>(
    safeParseJSON<InviteLink[]>(typeof window !== "undefined" ? localStorage.getItem(LS_INVITE_LINKS) : null, [])
  );
  const [vendorPools, setVendorPools] = useState<VendorPool[]>(
    safeParseJSON<VendorPool[]>(typeof window !== "undefined" ? localStorage.getItem(LS_VENDOR_POOLS) : null, [])
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [segment, setSegment] = useState<Segment>("all");

  const [search, setSearch] = useState<string>("");
  const [filterListId, setFilterListId] = useState<string>("all");
  const [filterHasEmail, setFilterHasEmail] = useState<boolean>(false);
  const [filterHasPhone, setFilterHasPhone] = useState<boolean>(false);
  const [filterTag, setFilterTag] = useState<string>("");

  const [sortBy, setSortBy] = useState<"name" | "created" | "lastContacted">("name");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showComposer, setShowComposer] = useState<null | { type: "email" | "text" }>(null);
  const [showListModal, setShowListModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showBulkAssignListModal, setShowBulkAssignListModal] = useState(false);

  const [importPreview, setImportPreview] = useState<Contact[]>([]);
  const [importRawCount, setImportRawCount] = useState<number>(0);

  const [newListName, setNewListName] = useState("");

  const allTags = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();

    let list = [...contacts];

    if (segment === "vip") list = list.filter((c) => !!c.vip);

    if (filterListId !== "all") list = list.filter((c) => c.lists.includes(filterListId));

    if (filterHasEmail) list = list.filter((c) => !!c.email?.trim());
    if (filterHasPhone) list = list.filter((c) => !!c.phone?.trim());

    if (filterTag.trim()) {
      const t = filterTag.trim().toLowerCase();
      list = list.filter((c) => c.tags.some((x) => x.toLowerCase() === t));
    }

    if (q) {
      list = list.filter((c) => {
        const hay = [
          c.firstName,
          c.lastName,
          c.company,
          c.title,
          c.email,
          c.phone,
          c.city,
          c.state,
          c.tags.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (sortBy === "name") {
      list.sort((a, b) => {
        const an = `${a.lastName || ""} ${a.firstName || ""}`.trim().toLowerCase();
        const bn = `${b.lastName || ""} ${b.firstName || ""}`.trim().toLowerCase();
        return an.localeCompare(bn);
      });
    } else if (sortBy === "created") {
      list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    } else {
      list.sort((a, b) => (b.lastContactedAt ?? 0) - (a.lastContactedAt ?? 0));
    }

    return list;
  }, [contacts, search, segment, filterListId, filterHasEmail, filterHasPhone, filterTag, sortBy]);

  const total = contacts.length;
  const visibleCount = filteredContacts.length;

  const selectedCount = selectedIds.size;

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    filteredContacts.forEach((c) => {
      if (selectedIds.has(c.id)) n++;
    });
    return n;
  }, [filteredContacts, selectedIds]);

  const outreachSentCount = useMemo(() => activity.reduce((sum, a) => sum + (a.recipientsCount || 0), 0), [activity]);
  const inviteOpenCount = useMemo(() => inviteLinks.reduce((sum, l) => sum + (l.opens || 0), 0), [inviteLinks]);
  const inviteApplyCount = useMemo(() => inviteLinks.reduce((sum, l) => sum + (l.applies || 0), 0), [inviteLinks]);
  const contactsWithEmail = useMemo(() => contacts.filter((c) => !!c.email?.trim()).length, [contacts]);
  const fillRate = contactsWithEmail > 0 ? Math.round((inviteApplyCount / contactsWithEmail) * 100) : 0;

  const latestInviteLink = inviteLinks[0];

  function createInviteLink() {
    const id = uid('invite');
    const slug = id.slice(-8);
    const link: InviteLink = {
      id,
      label: `General Invite ${inviteLinks.length + 1}`,
      url: `${window.location.origin}/apply/invite/${slug}`,
      createdAt: now(),
      opens: 0,
      applies: 0,
    };
    setInviteLinks((prev) => [link, ...prev]);
    try {
      navigator.clipboard?.writeText(link.url);
      show('Invite link created and copied.');
    } catch {
      show('Invite link created.');
    }
  }

  function simulateInviteOpen() {
    if (!latestInviteLink) {
      show('Create an invite link first.');
      return;
    }
    setInviteLinks((prev) =>
      prev.map((item) =>
        item.id === latestInviteLink.id ? { ...item, opens: item.opens + 1 } : item
      )
    );
    show('Invite open tracked.');
  }

  function simulateApplyTracked() {
    if (!latestInviteLink) {
      show('Create an invite link first.');
      return;
    }
    setInviteLinks((prev) =>
      prev.map((item) =>
        item.id === latestInviteLink.id ? { ...item, applies: item.applies + 1 } : item
      )
    );
    show('Vendor apply tracked.');
  }

  function createVendorPoolFromSelected() {
    if (selectedIds.size === 0) {
      show('Select contacts first.');
      return;
    }
    const pool: VendorPool = {
      id: uid('pool'),
      name: `Vendor Pool ${vendorPools.length + 1}`,
      contactIds: Array.from(selectedIds),
      createdAt: now(),
    };
    setVendorPools((prev) => [pool, ...prev]);
    show(`Vendor pool created with ${pool.contactIds.length} contact(s).`);
  }

  function runEmailAutomation() {
    const recipients = selectedIds.size || filteredContacts.length;
    if (recipients === 0) {
      show('No contacts available for automation.');
      return;
    }
    const item: Activity = {
      id: uid('activity'),
      type: 'email',
      subject: 'Event invite automation',
      message: 'Automated invite sequence queued.',
      audience: selectedIds.size ? 'selected' : 'filtered',
      recipientsCount: recipients,
      createdAt: now(),
    };
    setActivity((prev) => [item, ...prev]);
    show(`Email automation queued for ${recipients} contact(s).`);
  }

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts));
    } catch {
      // ignore
    }
  }, [contacts]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_LISTS, JSON.stringify(lists));
    } catch {
      // ignore
    }
  }, [lists]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_ACTIVITY, JSON.stringify(activity));
    } catch {
      // ignore
    }
  }, [activity]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INVITE_LINKS, JSON.stringify(inviteLinks));
    } catch {
      // ignore
    }
  }, [inviteLinks]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VENDOR_POOLS, JSON.stringify(vendorPools));
    } catch {
      // ignore
    }
  }, [vendorPools]);

  function show(msg: string) {
    setToast(msg);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredContacts.forEach((c) => next.add(c.id));
      return next;
    });
    show(`Selected ${filteredContacts.length} visible contact(s).`);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    show("Selection cleared.");
  }

  function toggleVip(id: string) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, vip: !c.vip } : c))
    );
  }

  function deleteSelected() {
    if (selectedIds.size === 0) {
      show("No contacts selected.");
      return;
    }
    const count = selectedIds.size;
    setContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)));
    setSelectedIds(new Set());
    show(`Deleted ${count} contact(s).`);
  }

  function openImportPicker() {
    fileInputRef.current?.click();
  }

  function onFilePicked(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const recs = parseCsv(text);
      setImportRawCount(recs.length);

      // Map common header names → contact fields
      const mapped: Contact[] = recs.map((r) => {
        const firstName = r["first name"] || r["firstname"] || r["first"] || "";
        const lastName = r["last name"] || r["lastname"] || r["last"] || "";
        const email = r["email"] || r["e-mail"] || "";
        const phone = r["phone"] || r["mobile"] || r["cell"] || "";
        const company = r["company"] || r["organization"] || "";
        const title = r["title"] || r["role"] || "";
        const city = r["city"] || "";
        const state = r["state"] || "";
        const tags = (r["tags"] || "")
          .split(/[;|,]/)
          .map((t) => t.trim())
          .filter(Boolean);

        return {
          id: uid("c"),
          firstName,
          lastName,
          email,
          phone,
          company,
          title,
          city,
          state,
          vip: false,
          tags,
          lists: [],
          notes: "",
          createdAt: now(),
        };
      });

      setImportPreview(mapped);
      setShowImportModal(true);
    };
    reader.readAsText(file);
  }

  function mergeImported() {
    if (importPreview.length === 0) {
      show("No rows to import.");
      setShowImportModal(false);
      return;
    }

    // Simple merge rule: if email matches existing contact, update missing fields + merge tags
    setContacts((prev) => {
      const byEmail = new Map<string, Contact>();
      prev.forEach((c) => {
        const e = (c.email ?? "").trim().toLowerCase();
        if (e) byEmail.set(e, c);
      });

      const next = [...prev];

      importPreview.forEach((incoming) => {
        const e = (incoming.email ?? "").trim().toLowerCase();
        if (e && byEmail.has(e)) {
          const existing = byEmail.get(e)!;
          const merged: Contact = {
            ...existing,
            firstName: existing.firstName || incoming.firstName,
            lastName: existing.lastName || incoming.lastName,
            phone: existing.phone || incoming.phone,
            company: existing.company || incoming.company,
            title: existing.title || incoming.title,
            city: existing.city || incoming.city,
            state: existing.state || incoming.state,
            tags: Array.from(new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])),
          };
          const idx = next.findIndex((x) => x.id === existing.id);
          if (idx >= 0) next[idx] = merged;
        } else {
          next.push(incoming);
        }
      });

      return next;
    });

    show(`Imported ${importPreview.length} contact(s).`);
    setImportPreview([]);
    setImportRawCount(0);
    setShowImportModal(false);
  }

  function exportCsv(mode: "filtered" | "selected") {
    const rows =
      mode === "selected"
        ? contacts.filter((c) => selectedIds.has(c.id))
        : filteredContacts;

    if (rows.length === 0) {
      show(mode === "selected" ? "No contacts selected to export." : "No contacts to export.");
      return;
    }

    const csvRows = rows.map((c) => ({
      "First Name": c.firstName ?? "",
      "Last Name": c.lastName ?? "",
      Company: c.company ?? "",
      Title: c.title ?? "",
      Email: c.email ?? "",
      Phone: c.phone ?? "",
      City: c.city ?? "",
      State: c.state ?? "",
      VIP: c.vip ? "yes" : "no",
      Tags: (c.tags ?? []).join("; "),
      Lists: (c.lists ?? [])
        .map((id) => lists.find((l) => l.id === id)?.name)
        .filter(Boolean)
        .join("; "),
      Notes: c.notes ?? "",
      "Created At": new Date(c.createdAt).toISOString(),
      "Last Contacted At": c.lastContactedAt ? new Date(c.lastContactedAt).toISOString() : "",
    }));

    const content = toCsv(csvRows);
    downloadText(
      `contacts_${mode}_${new Date().toISOString().slice(0, 10)}.csv`,
      content
    );
    show(`Exported ${rows.length} contact(s).`);
  }

  function createList() {
    const name = newListName.trim();
    if (!name) {
      show("List name required.");
      return;
    }
    const exists = lists.some((l) => l.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      show("A list with that name already exists.");
      return;
    }
    const list: ContactList = { id: uid("list"), name, createdAt: now() };
    setLists((prev) => [list, ...prev]);
    setNewListName("");
    setShowListModal(false);
    show(`Created list: ${name}`);
  }

  function bulkAssignToList(listId: string) {
    if (selectedIds.size === 0) {
      show("No contacts selected.");
      return;
    }
    setContacts((prev) =>
      prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        if (c.lists.includes(listId)) return c;
        return { ...c, lists: [...c.lists, listId] };
      })
    );
    show("Assigned selected contacts to list.");
  }

  function bulkRemoveFromList(listId: string) {
    if (selectedIds.size === 0) {
      show("No contacts selected.");
      return;
    }
    setContacts((prev) =>
      prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        return { ...c, lists: c.lists.filter((x) => x !== listId) };
      })
    );
    show("Removed selected contacts from list.");
  }

  function bulkAddTag(tag: string) {
    const t = tag.trim();
    if (!t) {
      show("Tag required.");
      return;
    }
    if (selectedIds.size === 0) {
      show("No contacts selected.");
      return;
    }
    setContacts((prev) =>
      prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        if (c.tags.some((x) => x.toLowerCase() === t.toLowerCase())) return c;
        return { ...c, tags: [...c.tags, t] };
      })
    );
    show(`Added tag "${t}" to selected.`);
  }

  function bulkRemoveTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    if (selectedIds.size === 0) {
      show("No contacts selected.");
      return;
    }
    setContacts((prev) =>
      prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        return { ...c, tags: c.tags.filter((x) => x.toLowerCase() !== t) };
      })
    );
    show(`Removed tag "${tag}" from selected.`);
  }

  function openComposer(type: "email" | "text") {
    if (contacts.length === 0) {
      show("No contacts yet — add or import first.");
      return;
    }
    setShowComposer({ type });
  }

  function sendMessage(payload: {
    type: "email" | "text";
    audience: "selected" | "filtered" | "vip";
    subject?: string;
    message: string;
  }) {
    let recipients: Contact[] = [];

    if (payload.audience === "selected") {
      recipients = contacts.filter((c) => selectedIds.has(c.id));
    } else if (payload.audience === "vip") {
      recipients = contacts.filter((c) => !!c.vip);
    } else {
      recipients = filteredContacts;
    }

    if (recipients.length === 0) {
      show("No recipients for that audience.");
      return;
    }

    // MVP "send": update lastContactedAt for recipients + log activity
    const ts = now();
    const ids = new Set(recipients.map((r) => r.id));

    setContacts((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, lastContactedAt: ts } : c)));

    const act: Activity = {
      id: uid("act"),
      type: payload.type,
      subject: payload.subject,
      message: payload.message,
      audience: payload.audience,
      recipientsCount: recipients.length,
      createdAt: ts,
    };
    setActivity((prev) => [act, ...prev]);

    show(
      payload.type === "email"
        ? `Email sent to ${recipients.length} contact(s) (MVP).`
        : `Text sent to ${recipients.length} contact(s) (MVP).`
    );

    setShowComposer(null);
  }

  /* ------------------------------ Modals State ------------------------------ */

  const [draftAdd, setDraftAdd] = useState<Partial<Contact>>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    title: "",
    city: "",
    state: "",
    vip: false,
    tags: [],
    lists: [],
    notes: "",
  });

  function resetDraftAdd() {
    setDraftAdd({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      company: "",
      title: "",
      city: "",
      state: "",
      vip: false,
      tags: [],
      lists: [],
      notes: "",
    });
  }

  function addContact() {
    const first = (draftAdd.firstName ?? "").trim();
    const last = (draftAdd.lastName ?? "").trim();
    const email = (draftAdd.email ?? "").trim();
    const phone = (draftAdd.phone ?? "").trim();

    if (!first && !last && !email && !phone) {
      show("Add at least a name, email, or phone.");
      return;
    }

    const c: Contact = {
      id: uid("c"),
      firstName: first,
      lastName: last,
      email,
      phone,
      company: (draftAdd.company ?? "").trim(),
      title: (draftAdd.title ?? "").trim(),
      city: (draftAdd.city ?? "").trim(),
      state: (draftAdd.state ?? "").trim(),
      vip: !!draftAdd.vip,
      tags: (draftAdd.tags ?? []).map((t) => t.trim()).filter(Boolean),
      lists: (draftAdd.lists ?? []).filter(Boolean),
      notes: (draftAdd.notes ?? "").trim(),
      createdAt: now(),
      lastContactedAt: undefined,
    };

    setContacts((prev) => [c, ...prev]);
    setShowAddModal(false);
    resetDraftAdd();
    show("Contact added.");
  }

  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkListChoice, setBulkListChoice] = useState<string>("");

  /* -------------------------------- Render -------------------------------- */

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8">
      {/* Title */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Contact Management</h1>
          <div className="mt-2 text-sm font-semibold text-slate-600">
            {total} total • {visibleCount} visible • {selectedCount} selected
          </div>
        </div>
      </div>

      {/* Top Control Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-extrabold text-slate-900">Contacts Control Center</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Mass outreach, VIP lists, and segmentation.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <PillButton
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setShowAddModal(true)}
            >
              Add Contact
            </PillButton>

            <PillButton
              variant="primary"
              leftIcon={<Upload className="h-4 w-4" />}
              onClick={openImportPicker}
            >
              Import CSV
            </PillButton>

            <PillButton
              variant="primary"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => exportCsv("filtered")}
              disabled={filteredContacts.length === 0}
              title="Exports current filtered/visible list"
            >
              Export CSV
            </PillButton>
          </div>
        </div>

        {/* Segments */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <SmallChip active={segment === "all"} onClick={() => setSegment("all")}>
            All
          </SmallChip>
          <SmallChip
            active={segment === "vip"}
            onClick={() => setSegment("vip")}
            title="VIP segment"
          >
            VIP
          </SmallChip>

          <div className="mx-2 h-5 w-px bg-slate-200" />

          <SmallChip onClick={() => setShowListModal(true)} title="Create and manage lists">
            <span className="inline-flex items-center gap-2">
              <ListPlus className="h-4 w-4" />
              New List
            </span>
          </SmallChip>

          {lists.slice(0, 6).map((l) => (
            <SmallChip
              key={l.id}
              active={filterListId === l.id}
              onClick={() => setFilterListId((prev) => (prev === l.id ? "all" : l.id))}
              title="Filter by this list"
            >
              {l.name}
            </SmallChip>
          ))}
          {lists.length > 6 ? (
            <SmallChip title="Use the dropdown to filter by any list">+{lists.length - 6} more</SmallChip>
          ) : null}
        </div>

        {/* Marketplace Growth Loop */}
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-emerald-700">
                <BarChart3 className="h-4 w-4" />
                Marketplace Growth Loop
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-700">
                Invite tracking, vendor pools, email automation, vendor apply tracking, and fill analytics.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <PillButton variant="soft" leftIcon={<Link2 className="h-4 w-4" />} onClick={createInviteLink}>
                  Create Invite Link
                </PillButton>
                <PillButton variant="soft" leftIcon={<Send className="h-4 w-4" />} onClick={runEmailAutomation}>
                  Run Email Automation
                </PillButton>
                <PillButton variant="soft" leftIcon={<UserPlus className="h-4 w-4" />} onClick={createVendorPoolFromSelected}>
                  Create Vendor Pool
                </PillButton>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Invite Links</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{inviteLinks.length}</div>
              </div>
              <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Opens</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{inviteOpenCount}</div>
              </div>
              <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Applications</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{inviteApplyCount}</div>
              </div>
              <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Vendor Pools</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{vendorPools.length}</div>
              </div>
              <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Fill Rate</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{fillRate}%</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Latest Invite Link</div>
              <div className="mt-1 truncate text-sm font-bold text-slate-900">{latestInviteLink?.url ?? 'No invite link yet'}</div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={simulateInviteOpen} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
                  Track Open
                </button>
                <button type="button" onClick={simulateApplyTracked} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50">
                  Track Apply
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Email Automation</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">
                {outreachSentCount} total automated recipients logged in activity.
              </div>
            </div>

            <div className="rounded-2xl border border-white bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Vendor Pools</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">
                {vendorPools[0] ? `${vendorPools[0].name} · ${vendorPools[0].contactIds.length} contacts` : 'No vendor pools created yet.'}
              </div>
            </div>
          </div>
        </div>

        {/* Filters + Actions */}
        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, company, tags…"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              value={filterListId}
              onChange={(e) => setFilterListId(e.target.value)}
            >
              <option value="all">All Lists</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="name">Sort: Name</option>
              <option value="created">Sort: Newest</option>
              <option value="lastContacted">Sort: Last Contacted</option>
            </select>
          </div>

          <div className="lg:col-span-3 flex flex-wrap items-center justify-start gap-2 lg:justify-end">
            <PillButton
              variant="soft"
              leftIcon={visibleSelectedCount === filteredContacts.length && filteredContacts.length > 0 ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              onClick={() => {
                if (filteredContacts.length === 0) return show("No visible contacts to select.");
                if (visibleSelectedCount === filteredContacts.length) clearSelection();
                else selectAllVisible();
              }}
              disabled={filteredContacts.length === 0}
            >
              {visibleSelectedCount === filteredContacts.length && filteredContacts.length > 0
                ? "Clear Visible"
                : "Select Visible"}
            </PillButton>

            <PillButton
              variant="soft"
              leftIcon={<Mail className="h-4 w-4" />}
              onClick={() => openComposer("email")}
              title="Compose a mass email"
            >
              Email ({selectedCount})
            </PillButton>

            <PillButton
              variant="soft"
              leftIcon={<MessageSquare className="h-4 w-4" />}
              onClick={() => openComposer("text")}
              title="Compose a mass text (MVP)"
            >
              Text ({selectedCount})
            </PillButton>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <input
              type="checkbox"
              checked={filterHasEmail}
              onChange={(e) => setFilterHasEmail(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Has Email
          </label>

          <label className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <input
              type="checkbox"
              checked={filterHasPhone}
              onChange={(e) => setFilterHasPhone(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Has Phone
          </label>

          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-slate-400" />
            <select
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            >
              <option value="">All Tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <PillButton
              variant="neutral"
              leftIcon={<Tag className="h-4 w-4" />}
              onClick={() => setShowTagModal(true)}
              disabled={selectedCount === 0}
              title="Bulk tag selected contacts"
            >
              Bulk Tag
            </PillButton>

            <PillButton
              variant="neutral"
              leftIcon={<ListPlus className="h-4 w-4" />}
              onClick={() => setShowBulkAssignListModal(true)}
              disabled={selectedCount === 0 || lists.length === 0}
              title="Assign selected contacts to a list"
            >
              Assign List
            </PillButton>

            <PillButton
              variant="neutral"
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={deleteSelected}
              disabled={selectedCount === 0}
              title="Delete selected contacts"
            >
              Delete
            </PillButton>

            <PillButton
              variant="neutral"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => exportCsv("selected")}
              disabled={selectedCount === 0}
              title="Export selected contacts"
            >
              Export Selected
            </PillButton>
          </div>
        </div>
      </div>

      {/* Contacts Table */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-lg font-extrabold text-slate-900">Contacts</div>
          <div className="text-sm font-semibold text-slate-600">
            Showing {visibleCount} of {total}
          </div>
        </div>

        {filteredContacts.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              <Info className="h-4 w-4 text-slate-500" />
              No contacts found. Try clearing filters, or import a CSV.
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="grid grid-cols-12 bg-slate-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">
              <div className="col-span-1">Select</div>
              <div className="col-span-4">Contact</div>
              <div className="col-span-3">Company</div>
              <div className="col-span-2">Tags / Lists</div>
              <div className="col-span-2 text-right">Last Contacted</div>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredContacts.map((c) => {
                const isSelected = selectedIds.has(c.id);
                const listsLabel = c.lists
                  .map((id) => lists.find((l) => l.id === id)?.name)
                  .filter(Boolean);

                return (
                  <div key={c.id} className="grid grid-cols-12 items-start px-4 py-4">
                    <div className="col-span-1 pt-1">
                      <button
                        type="button"
                        onClick={() => toggleSelected(c.id)}
                        className="rounded-lg p-1 hover:bg-slate-100"
                        aria-label="Select contact"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-indigo-600" />
                        ) : (
                          <Square className="h-5 w-5 text-slate-400" />
                        )}
                      </button>
                    </div>

                    <div className="col-span-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-extrabold text-slate-900">
                            {(c.firstName || c.lastName)
                              ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()
                              : c.email || c.phone || "Unnamed Contact"}
                          </div>

                          <div className="mt-1 space-y-1 text-xs font-semibold text-slate-600">
                            {c.email ? <div>{c.email}</div> : null}
                            {c.phone ? <div>{c.phone}</div> : null}
                            {(c.city || c.state) ? (
                              <div>
                                {[c.city, c.state].filter(Boolean).join(", ")}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleVip(c.id)}
                          className="rounded-full p-2 hover:bg-slate-100"
                          title={c.vip ? "Remove VIP" : "Mark VIP"}
                        >
                          {c.vip ? (
                            <Star className="h-5 w-5 text-amber-500" />
                          ) : (
                            <StarOff className="h-5 w-5 text-slate-400" />
                          )}
                        </button>
                      </div>

                      {c.notes ? (
                        <div className="mt-2 text-xs font-semibold text-slate-500 line-clamp-2">
                          Notes: {c.notes}
                        </div>
                      ) : null}
                    </div>

                    <div className="col-span-3">
                      <div className="text-sm font-bold text-slate-900">{c.company || "—"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-600">{c.title || ""}</div>
                    </div>

                    <div className="col-span-2">
                      <div className="flex flex-wrap gap-2">
                        {c.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold text-slate-700"
                          >
                            {t}
                          </span>
                        ))}
                        {c.tags.length > 3 ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-extrabold text-slate-600">
                            +{c.tags.length - 3}
                          </span>
                        ) : null}
                      </div>

                      {listsLabel.length ? (
                        <div className="mt-2 text-xs font-bold text-slate-600">
                          {listsLabel.slice(0, 2).join(", ")}
                          {listsLabel.length > 2 ? ` +${listsLabel.length - 2}` : ""}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs font-semibold text-slate-400">No lists</div>
                      )}
                    </div>

                    <div className="col-span-2 text-right">
                      <div className="text-sm font-extrabold text-slate-900">
                        {formatDate(c.lastContactedAt)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        Added {formatDate(c.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Activity log */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-extrabold text-slate-900">Recent Outreach</div>
          {activity.length === 0 ? (
            <div className="mt-2 text-xs font-semibold text-slate-500">
              No outreach yet. Use Email/Text to send a message (MVP).
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {activity.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-extrabold text-slate-900">
                      {a.type === "email" ? "Email" : "Text"} • {a.recipientsCount} recipients
                      <span className="ml-2 text-xs font-bold text-slate-500">
                        ({a.audience})
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-500">{formatDate(a.createdAt)}</div>
                  </div>
                  {a.subject ? (
                    <div className="mt-1 text-xs font-bold text-slate-700">Subject: {a.subject}</div>
                  ) : null}
                  <div className="mt-1 text-xs font-semibold text-slate-600 line-clamp-2">
                    {a.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          onFilePicked(f);
        }}
      />

      {/* ------------------------------ Modals ------------------------------ */}

      {showAddModal ? (
        <ModalShell
          title="Add Contact"
          subtitle="Create a new contact (saved locally for now)."
          onClose={() => {
            setShowAddModal(false);
            resetDraftAdd();
          }}
          footer={
            <>
              <PillButton
                onClick={() => {
                  setShowAddModal(false);
                  resetDraftAdd();
                }}
              >
                Cancel
              </PillButton>
              <PillButton variant="primary" onClick={addContact} leftIcon={<Plus className="h-4 w-4" />}>
                Add
              </PillButton>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-extrabold text-slate-600">First Name</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.firstName as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, firstName: e.target.value }))}
                placeholder="John"
              />
            </div>
            <div>
              <div className="text-xs font-extrabold text-slate-600">Last Name</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.lastName as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, lastName: e.target.value }))}
                placeholder="Smith"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">Email</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.email as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, email: e.target.value }))}
                placeholder="contact@company.com"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">Phone</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.phone as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">Company</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.company as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, company: e.target.value }))}
                placeholder="ABC Events"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">Title</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.title as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, title: e.target.value }))}
                placeholder="Sponsor / Vendor / Staff"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">City</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.city as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, city: e.target.value }))}
                placeholder="Atlanta"
              />
            </div>

            <div>
              <div className="text-xs font-extrabold text-slate-600">State</div>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                value={draftAdd.state as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, state: e.target.value }))}
                placeholder="GA"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-slate-600">Notes</div>
                <label className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!draftAdd.vip}
                    onChange={(e) => setDraftAdd((d) => ({ ...d, vip: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  VIP
                </label>
              </div>
              <textarea
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
                rows={3}
                value={draftAdd.notes as any}
                onChange={(e) => setDraftAdd((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Optional notes…"
              />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {showImportModal ? (
        <ModalShell
          title="Import CSV"
          subtitle={`Parsed ${importRawCount} row(s). Preview below.`}
          onClose={() => {
            setShowImportModal(false);
            setImportPreview([]);
            setImportRawCount(0);
          }}
          footer={
            <>
              <PillButton
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview([]);
                  setImportRawCount(0);
                }}
              >
                Cancel
              </PillButton>
              <PillButton variant="primary" onClick={mergeImported} leftIcon={<Upload className="h-4 w-4" />}>
                Import
              </PillButton>
            </>
          }
          widthClass="max-w-3xl"
        >
          {importPreview.length === 0 ? (
            <div className="text-sm font-semibold text-slate-600">No rows found in CSV.</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="grid grid-cols-12 bg-slate-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <div className="col-span-4">Name</div>
                <div className="col-span-4">Email</div>
                <div className="col-span-4">Phone</div>
              </div>
              <div className="divide-y divide-slate-100">
                {importPreview.slice(0, 8).map((c) => (
                  <div key={c.id} className="grid grid-cols-12 px-4 py-3 text-sm font-semibold text-slate-800">
                    <div className="col-span-4">{`${c.firstName} ${c.lastName}`.trim() || "—"}</div>
                    <div className="col-span-4">{c.email || "—"}</div>
                    <div className="col-span-4">{c.phone || "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importPreview.length > 8 ? (
            <div className="mt-3 text-xs font-semibold text-slate-500">
              Showing first 8 of {importPreview.length} imported contacts.
            </div>
          ) : null}
        </ModalShell>
      ) : null}

      {showComposer ? (
        <ComposerModal
          type={showComposer.type}
          selectedCount={selectedCount}
          filteredCount={filteredContacts.length}
          vipCount={contacts.filter((c) => !!c.vip).length}
          onClose={() => setShowComposer(null)}
          onSend={sendMessage}
        />
      ) : null}

      {showListModal ? (
        <ModalShell
          title="Create List"
          subtitle="Lists let you segment contacts (VIP is separate)."
          onClose={() => {
            setShowListModal(false);
            setNewListName("");
          }}
          footer={
            <>
              <PillButton
                onClick={() => {
                  setShowListModal(false);
                  setNewListName("");
                }}
              >
                Cancel
              </PillButton>
              <PillButton variant="primary" onClick={createList} leftIcon={<ListPlus className="h-4 w-4" />}>
                Create
              </PillButton>
            </>
          }
        >
          <div>
            <div className="text-xs font-extrabold text-slate-600">List Name</div>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Sponsors"
            />
          </div>
          {lists.length ? (
            <div className="mt-6">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Existing Lists
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {lists.map((l) => (
                  <span
                    key={l.id}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700"
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </ModalShell>
      ) : null}

      {showTagModal ? (
        <ModalShell
          title="Bulk Tag"
          subtitle="Add or remove a tag for selected contacts."
          onClose={() => {
            setShowTagModal(false);
            setBulkTagInput("");
          }}
          footer={
            <>
              <PillButton
                onClick={() => {
                  setShowTagModal(false);
                  setBulkTagInput("");
                }}
              >
                Close
              </PillButton>
              <PillButton
                variant="primary"
                onClick={() => {
                  bulkAddTag(bulkTagInput);
                  setShowTagModal(false);
                  setBulkTagInput("");
                }}
                leftIcon={<Tag className="h-4 w-4" />}
              >
                Add Tag
              </PillButton>
            </>
          }
        >
          <div>
            <div className="text-xs font-extrabold text-slate-600">Tag</div>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              value={bulkTagInput}
              onChange={(e) => setBulkTagInput(e.target.value)}
              placeholder="vip, sponsor, food, etc…"
            />
          </div>

          {allTags.length ? (
            <div className="mt-5">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Quick Remove
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {allTags.slice(0, 12).map((t) => (
                  <SmallChip
                    key={t}
                    onClick={() => {
                      bulkRemoveTag(t);
                      setShowTagModal(false);
                    }}
                    title="Remove this tag from selected"
                  >
                    Remove: {t}
                  </SmallChip>
                ))}
              </div>
            </div>
          ) : null}
        </ModalShell>
      ) : null}

      {showBulkAssignListModal ? (
        <ModalShell
          title="Assign Selected to List"
          subtitle="Choose a list to assign (or remove)."
          onClose={() => {
            setShowBulkAssignListModal(false);
            setBulkListChoice("");
          }}
          footer={
            <>
              <PillButton
                onClick={() => {
                  setShowBulkAssignListModal(false);
                  setBulkListChoice("");
                }}
              >
                Close
              </PillButton>

              <PillButton
                onClick={() => {
                  if (!bulkListChoice) return show("Pick a list.");
                  bulkRemoveFromList(bulkListChoice);
                  setShowBulkAssignListModal(false);
                  setBulkListChoice("");
                }}
                disabled={!bulkListChoice}
                leftIcon={<X className="h-4 w-4" />}
              >
                Remove
              </PillButton>

              <PillButton
                variant="primary"
                onClick={() => {
                  if (!bulkListChoice) return show("Pick a list.");
                  bulkAssignToList(bulkListChoice);
                  setShowBulkAssignListModal(false);
                  setBulkListChoice("");
                }}
                disabled={!bulkListChoice}
                leftIcon={<ListPlus className="h-4 w-4" />}
              >
                Assign
              </PillButton>
            </>
          }
        >
          <div>
            <div className="text-xs font-extrabold text-slate-600">List</div>
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              value={bulkListChoice}
              onChange={(e) => setBulkListChoice(e.target.value)}
            >
              <option value="">Select a list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </ModalShell>
      ) : null}

      {toast ? <Toast message={toast} onClose={() => setToast("")} /> : null}
    </div>
  );
}

/* ---------------------------- Composer Modal ---------------------------- */

function ComposerModal(props: {
  type: "email" | "text";
  selectedCount: number;
  filteredCount: number;
  vipCount: number;
  onClose: () => void;
  onSend: (payload: {
    type: "email" | "text";
    audience: "selected" | "filtered" | "vip";
    subject?: string;
    message: string;
  }) => void;
}) {
  const [audience, setAudience] = useState<"selected" | "filtered" | "vip">("selected");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const recipientsCount =
    audience === "selected" ? props.selectedCount : audience === "vip" ? props.vipCount : props.filteredCount;

  const canSend = message.trim().length > 0 && recipientsCount > 0;

  return (
    <ModalShell
      title={props.type === "email" ? "Mass Email" : "Mass Text (MVP)"}
      subtitle="This is an MVP composer — it updates last-contacted and logs the outreach."
      onClose={props.onClose}
      footer={
        <>
          <PillButton onClick={props.onClose}>Cancel</PillButton>
          <PillButton
            variant="primary"
            disabled={!canSend}
            leftIcon={props.type === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            onClick={() =>
              props.onSend({
                type: props.type,
                audience,
                subject: props.type === "email" ? subject : undefined,
                message,
              })
            }
          >
            Send ({recipientsCount})
          </PillButton>
        </>
      }
      widthClass="max-w-3xl"
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800">
            <input
              type="radio"
              name="aud"
              checked={audience === "selected"}
              onChange={() => setAudience("selected")}
            />
            Selected ({props.selectedCount})
          </label>

          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800">
            <input
              type="radio"
              name="aud"
              checked={audience === "filtered"}
              onChange={() => setAudience("filtered")}
            />
            Filtered ({props.filteredCount})
          </label>

          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-800">
            <input
              type="radio"
              name="aud"
              checked={audience === "vip"}
              onChange={() => setAudience("vip")}
            />
            VIP ({props.vipCount})
          </label>
        </div>

        {props.type === "email" ? (
          <div>
            <div className="text-xs font-extrabold text-slate-600">Subject</div>
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick update about the event…"
            />
          </div>
        ) : null}

        <div>
          <div className="text-xs font-extrabold text-slate-600">Message</div>
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              props.type === "email"
                ? "Write your email…"
                : "Write your text message…"
            }
          />
        </div>

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-900">
          Tip: If you want the old “real send” behavior later, we can wire this to your backend/email provider without changing the UI.
        </div>
      </div>
    </ModalShell>
  );
}



