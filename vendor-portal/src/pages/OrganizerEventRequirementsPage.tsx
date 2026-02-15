// vendor-portal/src/pages/OrganizerEventRequirementsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/* ---------------- Types ---------------- */

type BoothCategory = {
  id: string;
  name: string;
  baseSize: string; // e.g. "10x10"
  basePrice: number; // dollars
};

type VendorRestriction = {
  id: string;
  text: string;
};

type ComplianceRequirement = {
  id: string;
  text: string;
  required: boolean;
};

type DocumentRequirement = {
  id: string;
  name: string;
  required: boolean;
  dueBy?: string; // freeform
};

type RefundPolicy =
  | "No Refunds"
  | "Full Refund"
  | "Partial Refund"
  | "Event Credits Only";

type PaymentSettings = {
  requireDeposit: boolean;
  depositPercent: number; // 0-100
  lateFee: number; // dollars
  refundPolicy: RefundPolicy;
  paymentNotes?: string;
};

type RequirementsModel = {
  version: string;
  eventId: number;

  boothCategories: BoothCategory[];
  customRestrictions: VendorRestriction[];
  complianceItems: ComplianceRequirement[];
  documentRequirements: DocumentRequirement[];
  paymentSettings: PaymentSettings;

  updatedAt?: string;
};

type EventConfigTemplate = {
  id: string;
  name: string;
  description: string;
  createdAt: string;

  boothCategories: BoothCategory[];
  customRestrictions: VendorRestriction[];
  complianceItems: ComplianceRequirement[];
  documentRequirements: DocumentRequirement[];
  paymentSettings: PaymentSettings;
};

/* ---------------- Config ---------------- */

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

const LS_EVENT_REQ_PREFIX = "organizer:event";
const LS_TEMPLATES_KEY = "event-config-templates";
const BULLET = "\u2022";

/**
 * IMPORTANT:
 * Hardcode the API routes here so we NEVER hit "/organ.ts/...".
 */
const API = {
  organizerGet: (eventId: number) => `/organizer/events/${eventId}/requirements`,
  organizerPut: (eventId: number) => `/organizer/events/${eventId}/requirements`,
  organizerPost: (eventId: number) => `/organizer/events/${eventId}/requirements`,

  // Optional fallback read endpoint if you expose it
  publicGet: (eventId: number) => `/events/${eventId}/requirements`,
};

/* ---------------- Helpers ---------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(v: string, fallback = 0) {
  const s = (v ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Stable string -> positive int (for FastAPI schemas that want int IDs)
 */
function stableIntId(input: string) {
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // uint32
}

/**
 * Normalize payload for API:
 * - snake_case keys (FastAPI/Pydantic-friendly)
 * - ids -> int
 * - numbers never ""
 */
function normalizeForApi(m: RequirementsModel) {
  // Backend expects:
  // { version: int, requirements: { ... } }
  // and it wants version to be an integer.
  return {
    version: 2, // <-- IMPORTANT: int, not string

    requirements: {
      // If backend expects event_id inside requirements, keep it:
      event_id: Number(m.eventId),

      booth_categories: (m.boothCategories || []).map((c) => ({
        id: stableIntId(String(c.id)),
        name: String(c.name || ""),
        base_size: String(c.baseSize || ""),
        base_price: Number(c.basePrice) || 0,
      })),

      custom_restrictions: (m.customRestrictions || []).map((r) => ({
        id: stableIntId(String(r.id)),
        text: String(r.text || ""),
      })),

      compliance_items: (m.complianceItems || []).map((c) => ({
        id: stableIntId(String(c.id)),
        text: String(c.text || ""),
        required: !!c.required,
      })),

      document_requirements: (m.documentRequirements || []).map((d) => ({
        id: stableIntId(String(d.id)),
        name: String(d.name || ""),
        required: !!d.required,
        due_by: String(d.dueBy || ""),
      })),

      payment_settings: {
        require_deposit: !!m.paymentSettings?.requireDeposit,
        deposit_percent: Number(m.paymentSettings?.depositPercent) || 0,
        late_fee: Number(m.paymentSettings?.lateFee) || 0,
        refund_policy: m.paymentSettings?.refundPolicy || "No Refunds",
        payment_notes: String(m.paymentSettings?.paymentNotes || ""),
      },

      updated_at: new Date().toISOString(),
    },
  };
}
async function fetchJson(path: string, opts: { accessToken?: string } = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  return { ok: res.ok, status: res.status, data };
}

async function saveJson(
  method: "POST" | "PUT",
  path: string,
  body: any,
  opts: { accessToken?: string } = {}
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  return { ok: res.ok, status: res.status, data };
}

function readTemplates(): EventConfigTemplate[] {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeTemplates(list: EventConfigTemplate[]) {
  localStorage.setItem(LS_TEMPLATES_KEY, JSON.stringify(list));
}

function toRequirementsModel(
  eventId: number,
  src: Partial<RequirementsModel> | null | undefined
): RequirementsModel {
  const base: RequirementsModel = {
    version: "event_requirements_v1_2",
    eventId,
    boothCategories: [],
    customRestrictions: [],
    complianceItems: [],
    documentRequirements: [],
    paymentSettings: {
      requireDeposit: true,
      depositPercent: 50,
      lateFee: 0,
      refundPolicy: "No Refunds",
      paymentNotes: "",
    },
    updatedAt: new Date().toISOString(),
  };

  if (!src) return base;

  return {
    ...base,
    ...src,
    eventId,
    boothCategories: Array.isArray(src.boothCategories)
      ? src.boothCategories
      : base.boothCategories,
    customRestrictions: Array.isArray(src.customRestrictions)
      ? src.customRestrictions
      : base.customRestrictions,
    complianceItems: Array.isArray(src.complianceItems)
      ? src.complianceItems
      : base.complianceItems,
    documentRequirements: Array.isArray(src.documentRequirements)
      ? src.documentRequirements
      : base.documentRequirements,
    paymentSettings: src.paymentSettings
      ? { ...base.paymentSettings, ...src.paymentSettings }
      : base.paymentSettings,
    updatedAt: new Date().toISOString(),
  };
}

/* ---------------- Default Templates ---------------- */

const DEFAULT_TEMPLATES: EventConfigTemplate[] = [
  {
    id: "tpl_tech_conf",
    name: "Tech Conference",
    description: "Technology exhibitions and trade shows",
    createdAt: new Date().toISOString(),
    boothCategories: [
      { id: uid("bc"), name: "Standard Booth", baseSize: "10x10", basePrice: 800 },
      { id: uid("bc"), name: "Premium Booth", baseSize: "10x20", basePrice: 1500 },
      { id: uid("bc"), name: "Sponsor Booth", baseSize: "20x20", basePrice: 3500 },
    ],
    customRestrictions: [
      { id: uid("r"), text: "No loud amplified audio without approval." },
      { id: uid("r"), text: "No open flames or hazardous materials." },
      { id: uid("r"), text: "No solicitation outside assigned booth area." },
    ],
    complianceItems: [
      { id: uid("c"), text: "Electrical equipment inspected and certified.", required: true },
      { id: uid("c"), text: "All staff must wear event badges at all times.", required: true },
      { id: uid("c"), text: "Fire code clearance maintained (3ft aisle).", required: true },
      { id: uid("c"), text: "Wiring taped down / cable ramps used.", required: false },
    ],
    documentRequirements: [
      { id: uid("d"), name: "Certificate of Insurance (COI)", required: true, dueBy: "14 days before event" },
      { id: uid("d"), name: "Electrical request form (if needed)", required: false, dueBy: "7 days before event" },
      { id: uid("d"), name: "Brand guidelines acknowledgment", required: false, dueBy: "" },
    ],
    paymentSettings: {
      requireDeposit: true,
      depositPercent: 50,
      refundPolicy: "Partial Refund",
      lateFee: 50,
      paymentNotes: "Deposit due at application approval. Remaining balance due 30 days before event.",
    },
  },
  {
    id: "tpl_art_fair",
    name: "Art Fair",
    description: "Art shows, craft fairs, maker markets",
    createdAt: new Date().toISOString(),
    boothCategories: [
      { id: uid("bc"), name: "Artist Booth", baseSize: "10x10", basePrice: 250 },
      { id: uid("bc"), name: "Corner Booth", baseSize: "10x10", basePrice: 325 },
      { id: uid("bc"), name: "Large Booth", baseSize: "10x20", basePrice: 450 },
    ],
    customRestrictions: [
      { id: uid("r"), text: "No resale / mass-produced goods unless approved." },
      { id: uid("r"), text: "No hazardous materials / solvents in open areas." },
      { id: uid("r"), text: "No amplified music without approval." },
    ],
    complianceItems: [
      { id: uid("c"), text: "Display must be stable and weighted if outdoors.", required: true },
      { id: uid("c"), text: "Tablecloths or booth dressing required.", required: false },
      { id: uid("c"), text: "All products must be labeled with price.", required: false },
      { id: uid("c"), text: "No blocking walkways / keep within booth footprint.", required: true },
    ],
    documentRequirements: [
      { id: uid("d"), name: "Vendor agreement acknowledgment", required: true, dueBy: "" },
      { id: uid("d"), name: "COI (if required by venue)", required: false, dueBy: "" },
      { id: uid("d"), name: "Sales tax certificate (if applicable)", required: false, dueBy: "" },
    ],
    paymentSettings: {
      requireDeposit: true,
      depositPercent: 50,
      refundPolicy: "Event Credits Only",
      lateFee: 0,
      paymentNotes: "Balance due 14 days before event. Late payments may forfeit booth selection.",
    },
  },
];

/* ---------------- UI Bits ---------------- */

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-lg font-black text-slate-900">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300";
const smallBtn =
  "rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50";
const primaryBtn =
  "rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-indigo-700";

/* ---------------- Component ---------------- */

export default function OrganizerEventRequirementsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { accessToken } = useAuth();

  const eid = useMemo(() => {
    const n = Number(eventId);
    return Number.isFinite(n) ? n : null;
  }, [eventId]);

  const storageKey = useMemo(() => {
    return `${LS_EVENT_REQ_PREFIX}:${eventId}:requirements`;
  }, [eventId]);

  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<RequirementsModel | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [templates, setTemplates] = useState<EventConfigTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<"templates" | "builder">("templates");

  useEffect(() => {
    const saved = readTemplates();
    if (saved.length === 0) {
      writeTemplates(DEFAULT_TEMPLATES);
      setTemplates(DEFAULT_TEMPLATES);
    } else {
      setTemplates(saved);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      if (!eid || !eventId) {
        setLoading(false);
        setModel(null);
        return;
      }

      // 1) local first
      try {
        const local = localStorage.getItem(storageKey);
        if (local) {
          const parsed = JSON.parse(local);
          const m = toRequirementsModel(eid, parsed);
          if (!cancelled) setModel(m);
        }
      } catch {
        // ignore
      }

      // 2) API next
      const tries = [API.organizerGet(eid), API.publicGet(eid)];
      for (const path of tries) {
        const res = await fetchJson(path, { accessToken });
        if (res.ok && res.data) {
          const m = toRequirementsModel(eid, res.data as any);
          if (!cancelled) {
            setModel(m);
            try {
              localStorage.setItem(storageKey, JSON.stringify(m));
            } catch {
              // ignore
            }
          }
          break;
        }
      }

      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [eid, eventId, storageKey, accessToken]);

  function bump(m: RequirementsModel): RequirementsModel {
    return { ...m, updatedAt: new Date().toISOString() };
  }

  function applyTemplate(tpl: EventConfigTemplate) {
    if (!eid) return;

    const next = bump(
      toRequirementsModel(eid, {
        version: "event_requirements_v1_2",
        eventId: eid,
        boothCategories: tpl.boothCategories,
        customRestrictions: tpl.customRestrictions,
        complianceItems: tpl.complianceItems,
        documentRequirements: tpl.documentRequirements,
        paymentSettings: tpl.paymentSettings,
      })
    );

    setModel(next);
    setActiveTab("builder");

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setToast("Template loaded.");
    } catch {
      // ignore
    }
  }

  function saveAsTemplate() {
    if (!model) return;

    const name = window.prompt("Template name?", "My Template");
    if (!name) return;

    const description = window.prompt("Template description?", "Custom template") || "";

    const tpl: EventConfigTemplate = {
      id: uid("tpl"),
      name,
      description,
      createdAt: new Date().toISOString(),
      boothCategories: model.boothCategories,
      customRestrictions: model.customRestrictions,
      complianceItems: model.complianceItems,
      documentRequirements: model.documentRequirements,
      paymentSettings: model.paymentSettings,
    };

    const next = [tpl, ...templates];
    setTemplates(next);
    writeTemplates(next);
    setToast("Template saved.");
  }

  function deleteTemplate(templateId: string) {
    const next = templates.filter((t) => t.id !== templateId);
    setTemplates(next);
    writeTemplates(next);
    setToast("Template deleted.");
  }

  function addCategory() {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: [
          ...model.boothCategories,
          { id: uid("bc"), name: "New category", baseSize: "10x10", basePrice: 0 },
        ],
      })
    );
  }

  function addRestriction() {
    if (!model) return;
    setModel(
      bump({
        ...model,
        customRestrictions: [...model.customRestrictions, { id: uid("r"), text: "" }],
      })
    );
  }

  function addCompliance() {
    if (!model) return;
    setModel(
      bump({
        ...model,
        complianceItems: [...model.complianceItems, { id: uid("c"), text: "", required: true }],
      })
    );
  }

  function addDocReq() {
    if (!model) return;
    setModel(
      bump({
        ...model,
        documentRequirements: [
          ...model.documentRequirements,
          { id: uid("d"), name: "", required: true, dueBy: "" },
        ],
      })
    );
  }

  function removeById<K extends keyof RequirementsModel>(key: K, id: string) {
    if (!model) return;
    const list = (model[key] as any[]) || [];
    setModel(bump({ ...model, [key]: list.filter((x) => x.id !== id) } as any));
  }

  function updateCategory(id: string, patch: Partial<BoothCategory>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: model.boothCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })
    );
  }

  function updateRestriction(id: string, patch: Partial<VendorRestriction>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        customRestrictions: model.customRestrictions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      })
    );
  }

  function updateCompliance(id: string, patch: Partial<ComplianceRequirement>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        complianceItems: model.complianceItems.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })
    );
  }

  function updateDocReq(id: string, patch: Partial<DocumentRequirement>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        documentRequirements: model.documentRequirements.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      })
    );
  }

  async function onSave(): Promise<boolean> {
    if (!model || !eid) {
      setError("Cannot save: missing eventId/model.");
      setToast(null);
      return false;
    }

    setSaving(true);
    setError(null);
    setToast(null);

    // Always cache locally first
    try {
      localStorage.setItem(storageKey, JSON.stringify(model));
    } catch {
      // ignore
    }

    const payload = normalizeForApi(model);

    const attempts: Array<{ method: "PUT" | "POST"; path: string }> = [
      { method: "PUT", path: API.organizerPut(eid) },
      { method: "POST", path: API.organizerPost(eid) },
    ];

    for (const attempt of attempts) {
      try {
        console.log("REQ SAVE ->", attempt.method, `${API_BASE}${attempt.path}`, payload);

        const res = await saveJson(attempt.method, attempt.path, payload, { accessToken });

        console.log("REQ SAVE <-", attempt.method, attempt.path, res.status, res.ok, res.data);

        if (res.ok) {
          setSaving(false);
          setToast("Saved to API ✅");
          return true;
        }

        const detail = (res.data as any)?.detail;
        const msg =
          (typeof res.data === "string" ? res.data : null) ||
          (typeof detail === "string" ? detail : null) ||
          (Array.isArray(detail) ? JSON.stringify(detail) : null) ||
          `Save failed (${res.status})`;

        setError(msg);
      } catch (e: any) {
        console.log("REQ SAVE ERROR", e);
        setError(e?.message || "Save failed (network error)");
      }
    }

    setSaving(false);
    setToast(null);
    return false;
  }

  async function onSaveAndContinue() {
    const ok = await onSave();
    if (!ok) return;
    navigate(`/organizer/events/${eid}/layout`);
  }
async function onSaveAndContinue() {
  const ok = await onSave();
  if (!ok) return;
  if (eid) navigate(`/organizer/events/${eid}/layout`);
}

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Loading requirements…</div>
      </div>
    );
  }

  if (!model || !eid) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Requirements</div>
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error || "Unable to load requirements."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-4xl font-black tracking-tight text-slate-900">
            Event {eid} Requirements Builder
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-600">
            Load a template, customize requirements, save, then continue to Map Editor.
          </div>

          <div className="mt-4 text-xs font-bold text-slate-500">
            Debug keys:
            <div className="mt-1 font-mono text-[11px] text-slate-600">{storageKey}</div>
            <div className="mt-1 font-mono text-[11px] text-slate-600">{model.version}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex gap-2">
            <button type="button" onClick={onSave} className={primaryBtn} disabled={saving}>
  {saving ? "Saving…" : "Save Requirements (API)"}
</button>

            <button
              type="button"
              onClick={() => setActiveTab("builder")}
              className={smallBtn}
              title="Review / edit"
            >
              Review
            </button>
          </div>

          <button
            type="button"
            onClick={onSaveAndContinue}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
            disabled={saving}
          >
            Save & Continue → Map Editor
          </button>
        </div>
      </div>

      {toast ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          {error}
        </div>
      ) : null}

      <div className="mt-8 grid gap-6">
        <Section
          title="Templates"
          subtitle="Load a pre-built template or manage your saved templates. Loading overwrites current configuration."
          right={
            <button type="button" onClick={saveAsTemplate} className={smallBtn}>
              Save as Template
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={
                activeTab === "templates"
                  ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                  : smallBtn
              }
              onClick={() => setActiveTab("templates")}
            >
              Browse Templates
            </button>
            <button
              type="button"
              className={
                activeTab === "builder"
                  ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                  : smallBtn
              }
              onClick={() => setActiveTab("builder")}
            >
              Edit Builder
            </button>
          </div>

          {activeTab === "templates" ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-black text-slate-900">{t.name}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-600">{t.description}</div>
                      <div className="mt-3 text-xs font-bold text-slate-500">
                        Booths: {t.boothCategories.length} {BULLET} Restrictions:{" "}
                        {t.customRestrictions.length} {BULLET} Compliance:{" "}
                        {t.complianceItems.length} {BULLET} Docs:{" "}
                        {t.documentRequirements.length}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
                      >
                        Load
                      </button>
                      <button type="button" onClick={() => deleteTemplate(t.id)} className={smallBtn}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Section>

        <Section
          title="Booth Categories"
          subtitle="Define booth types (size + base price). Your map editor can reference these categories."
          right={
            <button type="button" onClick={addCategory} className={smallBtn}>
              Add category
            </button>
          }
        >
          <div className="grid gap-4">
            {model.boothCategories.map((c) => (
              <div
                key={c.id}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-4"
              >
                <input
                  value={c.name}
                  onChange={(e) => updateCategory(c.id, { name: e.target.value })}
                  className={inputCls}
                  placeholder="Category name"
                />
                <input
                  value={c.baseSize}
                  onChange={(e) => updateCategory(c.id, { baseSize: e.target.value })}
                  className={inputCls}
                  placeholder="Base size (e.g., 10x10)"
                />
                <input
                  value={String(c.basePrice ?? 0)}
                  onChange={(e) =>
                    updateCategory(c.id, { basePrice: clamp(toNumber(e.target.value, 0), 0, 999999) })
                  }
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="Price"
                />
                <button type="button" onClick={() => removeById("boothCategories", c.id)} className={smallBtn}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Vendor Restrictions"
          subtitle="Custom rules vendors must follow."
          right={
            <button type="button" onClick={addRestriction} className={smallBtn}>
              Add restriction
            </button>
          }
        >
          <div className="grid gap-3">
            {model.customRestrictions.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-center"
              >
                <input
                  className={inputCls}
                  value={r.text}
                  onChange={(e) => updateRestriction(r.id, { text: e.target.value })}
                  placeholder="Restriction text"
                />
                <button type="button" onClick={() => removeById("customRestrictions", r.id)} className={smallBtn}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Compliance Requirements"
          subtitle="Items vendors must confirm (checkboxes on the vendor application)."
          right={
            <button type="button" onClick={addCompliance} className={smallBtn}>
              Add requirement
            </button>
          }
        >
          <div className="grid gap-3">
            {model.complianceItems.map((c) => (
              <div
                key={c.id}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-[1fr_auto_auto]"
              >
                <input
                  value={c.text}
                  onChange={(e) => updateCompliance(c.id, { text: e.target.value })}
                  className={inputCls}
                  placeholder="Compliance requirement"
                />
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!c.required}
                    onChange={(e) => updateCompliance(c.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button type="button" onClick={() => removeById("complianceItems", c.id)} className={smallBtn}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Document Requirements"
          subtitle="Docs vendors may need to upload (COI, permits, etc.)."
          right={
            <button type="button" onClick={addDocReq} className={smallBtn}>
              Add document
            </button>
          }
        >
          <div className="grid gap-3">
            {model.documentRequirements.map((d) => (
              <div
                key={d.id}
                className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-[1fr_1fr_auto_auto]"
              >
                <input
                  className={inputCls}
                  value={d.name}
                  onChange={(e) => updateDocReq(d.id, { name: e.target.value })}
                  placeholder="Document name"
                />
                <input
                  className={inputCls}
                  value={d.dueBy || ""}
                  onChange={(e) => updateDocReq(d.id, { dueBy: e.target.value })}
                  placeholder="Due by (optional)"
                />
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!d.required}
                    onChange={(e) => updateDocReq(d.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button type="button" onClick={() => removeById("documentRequirements", d.id)} className={smallBtn}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Payment Settings" subtitle="Define deposit rules, late fees, and refund policy.">
          <div className="grid gap-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <label className="flex items-center gap-2 text-sm font-black text-slate-900">
                <input
                  type="checkbox"
                  checked={!!model.paymentSettings.requireDeposit}
                  onChange={(e) =>
                    setModel(
                      bump({
                        ...model,
                        paymentSettings: { ...model.paymentSettings, requireDeposit: e.target.checked },
                      })
                    )
                  }
                />
                Require deposit
              </label>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-black text-slate-700">Deposit %</div>
                  <input
                    className={`mt-2 ${inputCls}`}
                    value={String(model.paymentSettings.depositPercent ?? 0)}
                    onChange={(e) =>
                      setModel(
                        bump({
                          ...model,
                          paymentSettings: {
                            ...model.paymentSettings,
                            depositPercent: clamp(toNumber(e.target.value, 0), 0, 100),
                          },
                        })
                      )
                    }
                    inputMode="numeric"
                  />
                </div>

                <div>
                  <div className="text-xs font-black text-slate-700">Late fee ($)</div>
                  <input
                    className={`mt-2 ${inputCls}`}
                    value={String(model.paymentSettings.lateFee ?? 0)}
                    onChange={(e) =>
                      setModel(
                        bump({
                          ...model,
                          paymentSettings: {
                            ...model.paymentSettings,
                            lateFee: clamp(toNumber(e.target.value, 0), 0, 999999),
                          },
                        })
                      )
                    }
                    inputMode="numeric"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black text-slate-700">Refund Policy</div>
              <select
                className={`mt-2 ${inputCls}`}
                value={model.paymentSettings.refundPolicy}
                onChange={(e) =>
                  setModel(
                    bump({
                      ...model,
                      paymentSettings: {
                        ...model.paymentSettings,
                        refundPolicy: e.target.value as RefundPolicy,
                      },
                    })
                  )
                }
              >
                <option value="No Refunds">No Refunds</option>
                <option value="Full Refund">Full Refund</option>
                <option value="Partial Refund">Partial Refund</option>
                <option value="Event Credits Only">Event Credits Only</option>
              </select>

              <div className="mt-4 text-xs font-black text-slate-700">Payment Notes</div>
              <textarea
                className={`mt-2 min-h-[120px] ${inputCls}`}
                value={model.paymentSettings.paymentNotes || ""}
                onChange={(e) =>
                  setModel(
                    bump({
                      ...model,
                      paymentSettings: { ...model.paymentSettings, paymentNotes: e.target.value },
                    })
                  )
                }
                placeholder="Shown to vendors during application / invoicing."
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
