// vendor-portal/src/pages/OrganizerEventRequirementsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import PaymentSettingsSection, {
  type PaymentSettings as OffPlatformPaymentSettings,
} from "../components/PaymentSettingsSection";

/* ---------------- Types ---------------- */

type BoothCategory = {
  id: string;
  name: string;

  baseSize: string; // e.g. "10x10"
  basePrice: number; // dollars

  additionalPerFt?: number; // dollars/ft
  cornerPremium?: number; // dollars

  fireMarshalFee?: number; // dollars
  electricalNote?: string; // optional note shown to vendors
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

type PaymentSettings = OffPlatformPaymentSettings;


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

type EventTemplate = {
  id: string;
  name: string;
  subtitle: string;

  boothDefaults: BoothCategory[];
  restrictionQuickAdds: string[];
  complianceQuickAdds: string[];
  documentQuickAdds: string[];

  restrictionsDefaults: string[];
  complianceDefaults: Array<{ text: string; required: boolean }>;
  documentsDefaults: Array<{ name: string; required: boolean; dueBy?: string }>;

  paymentDefaults: PaymentSettings;
};

/* ---------------- Config ---------------- */

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

const LS_EVENT_REQ_PREFIX = "organizer:event";

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

function dollarsToCents(dollars: number) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function centsToDollars(cents: any) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
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

/**
 * Accept either:
 * A) { version: 2, requirements: {...snake_case...} }
 * B) { ...snake_case... } (already unwrapped)
 * C) already-camelCase model
 */
function apiToOrganizerShape(src: any) {
  const root =
    src?.requirements && typeof src.requirements === "object"
      ? src.requirements
      : src;

  if (
    root &&
    (root.boothCategories || root.customRestrictions || root.complianceItems)
  ) {
    return root;
  }

  if (src?.requirements) return src;

  return { version: 2, requirements: root };
}

function toRequirementsModel(
  eventId: number,
  src: Partial<RequirementsModel> | null | undefined
): RequirementsModel {
  const base: RequirementsModel = {
    version: "event_requirements_v2",
    eventId,
    boothCategories: [],
    customRestrictions: [],
    complianceItems: [],
    documentRequirements: [],
    paymentSettings: {
      enabled: true,
      payment_url: "",
      billing_contact_email: "",
      billing_contact_phone: "",
      memo_instructions: "Include your company name + booth number.",
      refund_policy: "No Refunds",
      payment_notes: "",
      due_by: "",
      deposit_type: "none",
      deposit_value: null,
      methods: {},
    },
    updatedAt: new Date().toISOString(),
  };

  if (!src) return base;

  const anySrc: any = src as any;
  const req =
    anySrc?.requirements && typeof anySrc.requirements === "object"
      ? anySrc.requirements
      : null;

  if (req) {
    const boothCategories: BoothCategory[] = Array.isArray(req.booth_categories)
      ? req.booth_categories.map((c: any) => ({
          id: String(c?.id ?? ""),
          name: String(c?.name ?? ""),
          baseSize: String(c?.base_size ?? ""),
          basePrice:
            Number(c?.base_price ?? 0) ||
            centsToDollars(c?.base_price_cents ?? 0) ||
            0,
          additionalPerFt:
            Number(c?.additional_per_ft ?? 0) ||
            centsToDollars(c?.additional_per_ft_cents ?? 0) ||
            0,
          cornerPremium:
            Number(c?.corner_premium ?? 0) ||
            centsToDollars(c?.corner_premium_cents ?? 0) ||
            0,
          fireMarshalFee:
            Number(c?.fire_marshal_fee ?? 0) ||
            centsToDollars(c?.fire_marshal_fee_cents ?? 0) ||
            0,
          electricalNote: String(c?.electrical_note ?? ""),
        }))
      : [];

    const customRestrictions: VendorRestriction[] = Array.isArray(
      req.custom_restrictions
    )
      ? req.custom_restrictions.map((r: any) => ({
          id: String(r?.id ?? ""),
          text: String(r?.text ?? ""),
        }))
      : [];

    const complianceItems: ComplianceRequirement[] = Array.isArray(
      req.compliance_items
    )
      ? req.compliance_items.map((c: any) => ({
          id: String(c?.id ?? ""),
          text: String(c?.text ?? ""),
          required: !!c?.required,
        }))
      : [];

    const documentRequirements: DocumentRequirement[] = Array.isArray(
      req.document_requirements
    )
      ? req.document_requirements.map((d: any) => ({
          id: String(d?.id ?? ""),
          name: String(d?.name ?? ""),
          required: !!d?.required,
          dueBy: d?.due_by ? String(d.due_by) : "",
        }))
      : [];

    const ps =
      req.payment_settings && typeof req.payment_settings === "object"
        ? req.payment_settings
        : null;

    const paymentSettings: PaymentSettings = ps
      ? {
          enabled: !!ps.enabled,
          payment_url: ps.payment_url ? String(ps.payment_url) : "",
          billing_contact_email: ps.billing_contact_email ? String(ps.billing_contact_email) : "",
          billing_contact_phone: ps.billing_contact_phone ? String(ps.billing_contact_phone) : "",
          memo_instructions: ps.memo_instructions ? String(ps.memo_instructions) : "",
          refund_policy: ps.refund_policy ? String(ps.refund_policy) : "No Refunds",
          payment_notes: ps.payment_notes ? String(ps.payment_notes) : "",
          due_by: ps.due_by ? String(ps.due_by) : "",
          deposit_type: ps.deposit_type ? String(ps.deposit_type) : "none",
          deposit_value:
            ps.deposit_value === null || ps.deposit_value === undefined
              ? null
              : ps.deposit_value,
          methods:
            ps.methods && typeof ps.methods === "object" ? ps.methods : {},
        }
      : base.paymentSettings;

    return {
      ...base,
      eventId,
      boothCategories,
      customRestrictions,
      complianceItems,
      documentRequirements,
      paymentSettings,
      updatedAt: req.updated_at ? String(req.updated_at) : new Date().toISOString(),
    };
  }

  // LocalStorage / already camelCase
  return {
    ...base,
    ...src,
    eventId,
    boothCategories: Array.isArray((src as any).boothCategories)
      ? (src as any).boothCategories
      : base.boothCategories,
    customRestrictions: Array.isArray((src as any).customRestrictions)
      ? (src as any).customRestrictions
      : base.customRestrictions,
    complianceItems: Array.isArray((src as any).complianceItems)
      ? (src as any).complianceItems
      : base.complianceItems,
    documentRequirements: Array.isArray((src as any).documentRequirements)
      ? (src as any).documentRequirements
      : base.documentRequirements,
    paymentSettings: (src as any).paymentSettings
      ? { ...base.paymentSettings, ...(src as any).paymentSettings }
      : base.paymentSettings,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Normalize payload for API:
 * - snake_case keys (FastAPI/Pydantic-friendly)
 * - ids -> int
 */
function normalizeForApi(m: RequirementsModel) {
  return {
    version: 2,
    requirements: {
      event_id: Number(m.eventId),

      booth_categories: (m.boothCategories || []).map((c) => {
        const basePrice = Number(c.basePrice) || 0;
        const addl = Number(c.additionalPerFt) || 0;
        const corner = Number(c.cornerPremium) || 0;
        const fire = Number(c.fireMarshalFee) || 0;

        return {
          id: stableIntId(String(c.id)),
          name: String(c.name || ""),
          base_size: String(c.baseSize || ""),

          base_price: basePrice,
          additional_per_ft: addl,
          corner_premium: corner,
          fire_marshal_fee: fire,
          electrical_note: String(c.electricalNote || ""),

          base_price_cents: dollarsToCents(basePrice),
          additional_per_ft_cents: dollarsToCents(addl),
          corner_premium_cents: dollarsToCents(corner),
          fire_marshal_fee_cents: dollarsToCents(fire),
        };
      }),

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
        enabled: !!m.paymentSettings?.enabled,
        payment_url: String((m.paymentSettings as any)?.payment_url || ""),
        billing_contact_email: String((m.paymentSettings as any)?.billing_contact_email || ""),
        billing_contact_phone: String((m.paymentSettings as any)?.billing_contact_phone || ""),
        memo_instructions: String((m.paymentSettings as any)?.memo_instructions || ""),
        refund_policy: String((m.paymentSettings as any)?.refund_policy || "No Refunds"),
        payment_notes: String((m.paymentSettings as any)?.payment_notes || ""),
        due_by: String((m.paymentSettings as any)?.due_by || ""),
        deposit_type: String((m.paymentSettings as any)?.deposit_type || "none"),
        deposit_value: (m.paymentSettings as any)?.deposit_value ?? null,
        methods:
          (m.paymentSettings as any)?.methods && typeof (m.paymentSettings as any).methods === "object"
            ? (m.paymentSettings as any).methods
            : {},
      },

      updated_at: new Date().toISOString(),
    },
  };
}

/* ---------------- Templates (each template differs) ---------------- */

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: "food_festival",
    name: "Food Festival",
    subtitle: "Food trucks + strict safety/compliance",
    boothDefaults: [
      {
        id: uid("cat"),
        name: "Food Truck",
        baseSize: "Truck",
        basePrice: 500,
        additionalPerFt: 25,
        cornerPremium: 100,
        fireMarshalFee: 0,
        electricalNote: "Generator required unless power add-on approved",
      },
    ],
    restrictionQuickAdds: [
      "No outside food or beverage sales",
      "No alcohol sales",
      "No use of event branding or logos on merchandise",
      "No weapons or replicas",
      "No fireworks or pyrotechnics",
    ],
    complianceQuickAdds: [
      "Ground cover required (food vendors)",
      "Grease must be disposed of in designated containers only",
      "All banners and signage must be flame-retardant certified",
      "Noise levels must comply with event regulations",
      "Vendors must provide their own power source",
      "Setup must be completed by designated time",
      "Breakdown must not begin before event end time",
    ],
    documentQuickAdds: [
      "Health Permit",
      "Fire Safety Documentation",
      "Menu/Product List",
      "Tax Certificate",
      "Food Handler Certifications",
      "Liquor License",
      "Health & Safety Compliance Certificate",
    ],
    restrictionsDefaults: ["No outside food or beverage sales", "No alcohol sales"],
    complianceDefaults: [
      { text: "All trash must be bagged and disposed of properly", required: true },
      { text: "Fire extinguisher must be present and accessible", required: true },
    ],
    documentsDefaults: [
      { name: "General Liability Insurance", required: true, dueBy: "14 days before event" },
      { name: "Business License", required: true, dueBy: "" },
    ],
    paymentDefaults: {
      enabled: true,
      payment_url: "",
      billing_contact_email: "",
      billing_contact_phone: "",
      memo_instructions: "Include your company name + booth number.",
      refund_policy: "No Refunds",
      payment_notes: "",
      due_by: "",
      deposit_type: "none",
      deposit_value: null,
      methods: {},
    },
  },
  {
    id: "artisan_market",
    name: "Artisan Market",
    subtitle: "Craft vendors + light compliance",
    boothDefaults: [
      {
        id: uid("cat"),
        name: "Standard Booth",
        baseSize: "10x10",
        basePrice: 250,
        additionalPerFt: 10,
        cornerPremium: 50,
        fireMarshalFee: 0,
        electricalNote: "Optional power add-on available",
      },
    ],
    restrictionQuickAdds: [
      "No counterfeit or trademark-infringing goods",
      "No weapons or replicas",
      "No fireworks or pyrotechnics",
      "No amplified sound without approval",
    ],
    complianceQuickAdds: [
      "Setup must be completed by designated time",
      "Keep booth area clean and clear of trip hazards",
      "No open flames without approval",
    ],
    documentQuickAdds: [
      "Business License",
      "Tax Certificate",
      "Certificate of Insurance",
    ],
    restrictionsDefaults: ["No counterfeit or trademark-infringing goods"],
    complianceDefaults: [
      { text: "Keep booth area clean and clear of trip hazards", required: true },
    ],
    documentsDefaults: [
      { name: "Business License", required: true, dueBy: "" },
    ],
    paymentDefaults: {
      enabled: true,
      payment_url: "",
      billing_contact_email: "",
      billing_contact_phone: "",
      memo_instructions: "Include your company name + booth number.",
      refund_policy: "No Refunds",
      payment_notes: "",
      due_by: "",
      deposit_type: "none",
      deposit_value: null,
      methods: {},
    },
  },
  {
    id: "tech_trade_show",
    name: "Tech Trade Show",
    subtitle: "Higher pricing + formal paperwork",
    boothDefaults: [
      {
        id: uid("cat"),
        name: "Standard Booth",
        baseSize: "10x10",
        basePrice: 1500,
        additionalPerFt: 0,
        cornerPremium: 200,
        fireMarshalFee: 0,
        electricalNote: "Power drops coordinated with venue",
      },
      {
        id: uid("cat"),
        name: "Premium Booth",
        baseSize: "10x20",
        basePrice: 3000,
        additionalPerFt: 0,
        cornerPremium: 300,
        fireMarshalFee: 0,
        electricalNote: "Dedicated circuit available by request",
      },
    ],
    restrictionQuickAdds: [
      "No unauthorized solicitation",
      "No unauthorized recordings",
      "No event branding on merchandise",
    ],
    complianceQuickAdds: [
      "Setup by 7am",
      "Breakdown not before close",
      "Product demos tested 24hrs prior",
      "WiFi coordination required for streaming demos",
    ],
    documentQuickAdds: [
      "Certificate of Insurance",
      "W-9 Tax Form",
      "Product Spec Sheet",
    ],
    restrictionsDefaults: ["No unauthorized solicitation"],
    complianceDefaults: [
      { text: "Product demos tested 24hrs prior", required: true },
      { text: "Setup by 7am", required: true },
    ],
    documentsDefaults: [
      { name: "Certificate of Insurance", required: true, dueBy: "30 days before" },
      { name: "W-9 Tax Form", required: true, dueBy: "" },
    ],
    paymentDefaults: {
      enabled: true,
      payment_url: "",
      billing_contact_email: "",
      billing_contact_phone: "",
      memo_instructions: "Include your company name + booth number.",
      refund_policy: "No Refunds",
      payment_notes: "",
      due_by: "",
      deposit_type: "none",
      deposit_value: null,
      methods: {},
    },
  },
];

/* ---------------- UI helpers ---------------- */

const inputCls =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-300";

const chipCls =
  "rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100";

const sectionCard =
  "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";

const addBtnGreen =
  "inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700";

const saveBtnBlue =
  "inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700";

const subtleBtn =
  "rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50";

function IconBadge({ emoji }: { emoji: string }) {
  return (
    <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-xl">
      {emoji}
    </div>
  );
}

function SectionHeader({
  emoji,
  title,
  subtitle,
  right,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start">
        <IconBadge emoji={emoji} />
        <div>
          <div className="text-xl font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">
            {subtitle}
          </div>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

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

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [savedOk, setSavedOk] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    EVENT_TEMPLATES[0]?.id || "food_festival"
  );

  const [customRestrictionText, setCustomRestrictionText] = useState("");
  const [customComplianceText, setCustomComplianceText] = useState("");
  const [customDocName, setCustomDocName] = useState("");

  function bump(m: RequirementsModel): RequirementsModel {
    return { ...m, updatedAt: new Date().toISOString() };
  }

  function applyTemplate(templateId: string) {
    if (!eid) return;

    const tpl = EVENT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;

    const next: RequirementsModel = bump({
      version: "event_requirements_v2",
      eventId: eid,

      boothCategories: tpl.boothDefaults.map((b) => ({ ...b, id: uid("cat") })),

      customRestrictions: tpl.restrictionsDefaults.map((text) => ({
        id: uid("r"),
        text,
      })),

      complianceItems: tpl.complianceDefaults.map((c) => ({
        id: uid("c"),
        text: c.text,
        required: !!c.required,
      })),

      documentRequirements: tpl.documentsDefaults.map((d) => ({
        id: uid("d"),
        name: d.name,
        required: !!d.required,
        dueBy: d.dueBy || "",
      })),

      paymentSettings: { ...tpl.paymentDefaults },
      updatedAt: new Date().toISOString(),
    });

    setModel(next);
    setToast(`Template loaded: ${tpl.name}`);
    setError(null);

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

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
          const normalized = apiToOrganizerShape(res.data);
          const m = toRequirementsModel(eid, normalized as any);

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

      // 3) If still nothing, initialize with default template
      if (!cancelled) {
        setLoading(false);
        if (!model) {
          applyTemplate(selectedTemplateId);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid, eventId]);

  // If user changes the template selector, load it immediately
  useEffect(() => {
    if (!eid) return;
    if (!model) return;
    // do not auto-wipe if user has data; this is a destructive action
    // so we only auto-apply if the current model is effectively empty
    const isEmpty =
      (model.boothCategories?.length || 0) === 0 &&
      (model.customRestrictions?.length || 0) === 0 &&
      (model.complianceItems?.length || 0) === 0 &&
      (model.documentRequirements?.length || 0) === 0;

    if (isEmpty) applyTemplate(selectedTemplateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

  async function onSave(): Promise<boolean> {
    if (!model || !eid) {
      setError("Cannot save: missing eventId/model.");
      setToast(null);
      return false;
    }

    setSaving(true);
    setError(null);
    setToast(null);
    setSavedOk(false);

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
        const res = await saveJson(attempt.method, attempt.path, payload, {
          accessToken,
        });

        if (res.ok) {
          setSaving(false);
          setToast("Configuration saved ✅");
          setSavedOk(true);
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
        setError(e?.message || "Save failed (network error)");
      }
    }

    setSaving(false);
    return false;
  }

  /* ---------------- Mutators ---------------- */

  function setBoothCategory(id: string, patch: Partial<BoothCategory>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: model.boothCategories.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      })
    );
  }

  function addBoothCategory() {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: [
          ...model.boothCategories,
          {
            id: uid("cat"),
            name: "New Category",
            baseSize: "10x10",
            basePrice: 0,
            additionalPerFt: 0,
            cornerPremium: 0,
            fireMarshalFee: 0,
            electricalNote: "",
          },
        ],
      })
    );
  }

  function removeBoothCategory(id: string) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: model.boothCategories.filter((c) => c.id !== id),
      })
    );
  }

  function addRestriction(text: string) {
    if (!model) return;
    const clean = String(text || "").trim();
    if (!clean) return;
    if (model.customRestrictions.some((r) => r.text.trim().toLowerCase() === clean.toLowerCase())) return;

    setModel(
      bump({
        ...model,
        customRestrictions: [...model.customRestrictions, { id: uid("r"), text: clean }],
      })
    );
  }

  function removeRestriction(id: string) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        customRestrictions: model.customRestrictions.filter((r) => r.id !== id),
      })
    );
  }

  function addCompliance(text: string, required = true) {
    if (!model) return;
    const clean = String(text || "").trim();
    if (!clean) return;
    if (model.complianceItems.some((c) => c.text.trim().toLowerCase() === clean.toLowerCase())) return;

    setModel(
      bump({
        ...model,
        complianceItems: [
          ...model.complianceItems,
          { id: uid("c"), text: clean, required: !!required },
        ],
      })
    );
  }

  function toggleComplianceRequired(id: string, required: boolean) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        complianceItems: model.complianceItems.map((c) =>
          c.id === id ? { ...c, required } : c
        ),
      })
    );
  }

  function removeCompliance(id: string) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        complianceItems: model.complianceItems.filter((c) => c.id !== id),
      })
    );
  }

  function addDocument(name: string, required = true) {
    if (!model) return;
    const clean = String(name || "").trim();
    if (!clean) return;
    if (model.documentRequirements.some((d) => d.name.trim().toLowerCase() === clean.toLowerCase())) return;

    setModel(
      bump({
        ...model,
        documentRequirements: [
          ...model.documentRequirements,
          { id: uid("d"), name: clean, required: !!required, dueBy: "" },
        ],
      })
    );
  }

  function toggleDocRequired(id: string, required: boolean) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        documentRequirements: model.documentRequirements.map((d) =>
          d.id === id ? { ...d, required } : d
        ),
      })
    );
  }

  function setDocDueBy(id: string, dueBy: string) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        documentRequirements: model.documentRequirements.map((d) =>
          d.id === id ? { ...d, dueBy } : d
        ),
      })
    );
  }

  function removeDoc(id: string) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        documentRequirements: model.documentRequirements.filter((d) => d.id !== id),
      })
    );
  }

  /* ---------------- Render ---------------- */

  const tpl = EVENT_TEMPLATES.find((t) => t.id === selectedTemplateId) || EVENT_TEMPLATES[0];

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">
          Loading configuration…
        </div>
      </div>
    );
  }

  if (!model || !eid) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">
          Event Setup & Vendor Requirements
        </div>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error || "Unable to load requirements."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            type="button"
            className="text-sm font-black text-slate-700 hover:text-slate-900"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>

          <div className="flex items-center gap-3">
            <span className="text-lg font-black text-slate-900">
              Event Setup & Vendor Requirements
            </span>
          </div>

          <div className="flex items-center gap-3">
          <button
            type="button"
            className={saveBtnBlue}
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Configuration"}
          </button>

          {savedOk ? (
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
              onClick={() => navigate(`/organizer/events/${eid}/layout`)}
            >
              Go to Booth Layout →
            </button>
          ) : null}
        </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Template row */}
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-black text-slate-900">
                Event Template
              </div>
              <div className="mt-1 text-xs font-bold text-slate-600">
                Choose a template. Each template preloads different defaults + quick-add options.
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <select
                className={inputCls}
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                {EVENT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={subtleBtn}
                onClick={() => applyTemplate(selectedTemplateId)}
              >
                Load template
              </button>

              <div className="text-xs font-bold text-slate-600 md:max-w-[340px]">
                <span className="font-black">{tpl.name}:</span> {tpl.subtitle}
              </div>
            </div>
          </div>

          {toast ? (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 md:flex-row md:items-center md:justify-between">
              <div>{toast}</div>
              {savedOk ? (
                <button
                  type="button"
                  className="self-start rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 md:self-auto"
                  onClick={() => navigate(`/organizer/events/${eid}/layout`)}
                >
                  Continue to Layout →
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-800">
              {error}
            </div>
          ) : null}
        </div>

        {/* Booth Categories */}
        <div className={sectionCard}>
          <SectionHeader
            emoji="🎪"
            title="Booth Categories"
            subtitle="Define available booth types and pricing for your event"
            right={
              <button type="button" className={addBtnGreen} onClick={addBoothCategory}>
                + Add Category
              </button>
            }
          />

          <div className="mt-6 grid gap-4">
            {model.boothCategories.map((c) => (
              <div
                key={c.id}
                className="rounded-3xl border border-slate-200 bg-white p-5"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Category Name *
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      value={c.name}
                      onChange={(e) => setBoothCategory(c.id, { name: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Base Size *
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      value={c.baseSize}
                      onChange={(e) => setBoothCategory(c.id, { baseSize: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Base Price *
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      inputMode="decimal"
                      value={String(c.basePrice ?? 0)}
                      onChange={(e) =>
                        setBoothCategory(c.id, {
                          basePrice: clamp(toNumber(e.target.value, 0), 0, 999999),
                        })
                      }
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Additional $/ft
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      inputMode="decimal"
                      value={String(c.additionalPerFt ?? 0)}
                      onChange={(e) =>
                        setBoothCategory(c.id, {
                          additionalPerFt: clamp(toNumber(e.target.value, 0), 0, 999999),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Corner Premium
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      inputMode="decimal"
                      value={String(c.cornerPremium ?? 0)}
                      onChange={(e) =>
                        setBoothCategory(c.id, {
                          cornerPremium: clamp(toNumber(e.target.value, 0), 0, 999999),
                        })
                      }
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Fire Marshal Fee
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      inputMode="decimal"
                      value={String(c.fireMarshalFee ?? 0)}
                      onChange={(e) =>
                        setBoothCategory(c.id, {
                          fireMarshalFee: clamp(toNumber(e.target.value, 0), 0, 999999),
                        })
                      }
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">
                      Electrical Note (optional)
                    </div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      value={c.electricalNote || ""}
                      onChange={(e) => setBoothCategory(c.id, { electricalNote: e.target.value })}
                      placeholder="e.g., Generator required"
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button type="button" className={subtleBtn} onClick={() => removeBoothCategory(c.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {model.boothCategories.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                No booth categories yet.
              </div>
            ) : null}
          </div>
        </div>

        {/* Vendor Restrictions */}
        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="🚫"
            title="Vendor Restrictions"
            subtitle="Define prohibited items and activities for your event"
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tpl.restrictionQuickAdds.map((t) => (
                <button key={t} type="button" className={chipCls} onClick={() => addRestriction(t)}>
                  + {t}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <div className="text-sm font-black text-slate-900">Custom Restrictions</div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  className={inputCls}
                  value={customRestrictionText}
                  onChange={(e) => setCustomRestrictionText(e.target.value)}
                  placeholder="Enter custom restriction…"
                />
                <button
                  type="button"
                  className={addBtnGreen}
                  onClick={() => {
                    addRestriction(customRestrictionText);
                    setCustomRestrictionText("");
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="mt-6 text-sm font-black text-slate-900">
              Active Restrictions ({model.customRestrictions.length})
            </div>

            <div className="mt-3 grid gap-3">
              {model.customRestrictions.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="text-sm font-semibold text-slate-900">{r.text}</div>
                  <button
                    type="button"
                    className="text-xl font-black text-red-500 hover:text-red-600"
                    onClick={() => removeRestriction(r.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Compliance Requirements */}
        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="📋"
            title="Compliance Requirements"
            subtitle="Set operational rules vendors must acknowledge"
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tpl.complianceQuickAdds.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={chipCls}
                  onClick={() => addCompliance(t, true)}
                >
                  + {t}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <div className="text-sm font-black text-slate-900">Custom Compliance Item</div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  className={inputCls}
                  value={customComplianceText}
                  onChange={(e) => setCustomComplianceText(e.target.value)}
                  placeholder="Enter custom compliance requirement…"
                />
                <button
                  type="button"
                  className={addBtnGreen}
                  onClick={() => {
                    addCompliance(customComplianceText, true);
                    setCustomComplianceText("");
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="mt-6 text-sm font-black text-slate-900">
              Active Requirements ({model.complianceItems.length})
            </div>

            <div className="mt-3 grid gap-3">
              {model.complianceItems.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!!c.required}
                      onChange={(e) => toggleComplianceRequired(c.id, e.target.checked)}
                    />
                    <div className="text-sm font-semibold text-slate-900">
                      <span className="mr-2 text-xs font-black text-slate-600">
                        Required
                      </span>
                      {c.text}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-xl font-black text-red-500 hover:text-red-600"
                    onClick={() => removeCompliance(c.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Document Requirements */}
        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="📄"
            title="Document Requirements"
            subtitle="Specify which documents vendors must upload"
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tpl.documentQuickAdds.map((t) => (
                <button key={t} type="button" className={chipCls} onClick={() => addDocument(t, true)}>
                  + {t}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <div className="text-sm font-black text-slate-900">Custom Document</div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  className={inputCls}
                  value={customDocName}
                  onChange={(e) => setCustomDocName(e.target.value)}
                  placeholder="Enter custom document requirement…"
                />
                <button
                  type="button"
                  className={addBtnGreen}
                  onClick={() => {
                    addDocument(customDocName, true);
                    setCustomDocName("");
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="mt-6 text-sm font-black text-slate-900">
              Active Documents ({model.documentRequirements.length})
            </div>

            <div className="mt-3 grid gap-3">
              {model.documentRequirements.map((d) => (
                <div
                  key={d.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!d.required}
                        onChange={(e) => toggleDocRequired(d.id, e.target.checked)}
                      />
                      <div className="text-sm font-semibold text-slate-900">
                        <span className="mr-2 text-xs font-black text-slate-600">
                          Required
                        </span>
                        {d.name}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-xl font-black text-red-500 hover:text-red-600"
                      onClick={() => removeDoc(d.id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-3">
                    <input
                      className={inputCls}
                      value={d.dueBy || ""}
                      onChange={(e) => setDocDueBy(d.id, e.target.value)}
                      placeholder="Optional deadline (e.g., '14 days before event')"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Payment & Refund Rules */}
        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="💳"
            title="Payment Instructions"
            subtitle="Off-platform for now: tell vendors how to pay you after approval."
          />

          <PaymentSettingsSection
            value={model.paymentSettings as any}
            onChange={(next) => setModel(bump({ ...model, paymentSettings: next as any }))}
          />

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-600">
            Vendors will see these instructions after you approve their application.
          </div>
        </div>

        {/* footer spacing */}
        <div className="h-10" />
      </div>
    </div>
  );
}
