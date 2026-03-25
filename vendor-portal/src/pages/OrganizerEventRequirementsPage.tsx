
// src/pages/OrganizerEventRequirementsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import PaymentSettingsSection, {
  type PaymentSettings as OffPlatformPaymentSettings,
} from "../components/PaymentSettingsSection";

type BoothCategory = {
  id: string;
  name: string;
  baseSize: string;
  basePrice: number;
  additionalPerFt?: number;
  cornerPremium?: number;
  fireMarshalFee?: number;
  electricalNote?: string;
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
  dueBy?: string;
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
  category: string;
  boothDefaults: BoothCategory[];
  restrictionQuickAdds: string[];
  complianceQuickAdds: string[];
  documentQuickAdds: string[];
  restrictionsDefaults: string[];
  complianceDefaults: Array<{ text: string; required: boolean }>;
  documentsDefaults: Array<{ name: string; required: boolean; dueBy?: string }>;
  paymentDefaults: PaymentSettings;
};

type SavedRequirementTemplate = {
  id: string;
  name: string;
  category?: string;
  payload: RequirementsModel;
  updatedAt?: string;
};

const API_BASE =
  import.meta.env.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

const LS_EVENT_REQ_PREFIX = "organizer:event";

const API = {
  organizerGet: (eventId: number) => `/organizer/events/${eventId}/requirements`,
  organizerPut: (eventId: number) => `/organizer/events/${eventId}/requirements`,
  organizerPost: (eventId: number) => `/organizer/events/${eventId}/requirements`,
  publicGet: (eventId: number) => `/events/${eventId}/requirements`,

  templateList: "/organizer/requirement-templates",
  templateCreate: "/organizer/requirement-templates",
  templateUpdate: (templateId: string) => `/organizer/requirement-templates/${templateId}`,
  templateDelete: (templateId: string) => `/organizer/requirement-templates/${templateId}`,
  templateRead: (templateId: string) => `/organizer/requirement-templates/${templateId}`,
};

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

function fetchHeaders(accessToken?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function saveHeaders(accessToken?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function fetchJson(path: string, opts: { accessToken?: string } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: fetchHeaders(opts.accessToken),
  });
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  return { ok: res.ok, status: res.status, data };
}

async function saveJson(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body: any,
  opts: { accessToken?: string } = {}
) {
  const init: RequestInit = {
    method,
    headers: saveHeaders(opts.accessToken),
  };

  if (method !== "DELETE") {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  return { ok: res.ok, status: res.status, data };
}

function normalizeIncomingRequirements(src: any) {
  const root =
    src?.requirements && typeof src.requirements === "object"
      ? src.requirements
      : src?.payload && typeof src.payload === "object"
      ? src.payload
      : src;

  if (!root || typeof root !== "object") return {};

  return {
    boothCategories: Array.isArray(root.boothCategories)
      ? root.boothCategories
      : Array.isArray(root.booth_categories)
      ? root.booth_categories
      : [],
    customRestrictions: Array.isArray(root.customRestrictions)
      ? root.customRestrictions
      : Array.isArray(root.custom_restrictions)
      ? root.custom_restrictions
      : [],
    complianceItems: Array.isArray(root.complianceItems)
      ? root.complianceItems
      : Array.isArray(root.compliance_items)
      ? root.compliance_items
      : [],
    documentRequirements: Array.isArray(root.documentRequirements)
      ? root.documentRequirements
      : Array.isArray(root.document_requirements)
      ? root.document_requirements
      : [],
    paymentSettings:
      root.paymentSettings ||
      root.payment_settings ||
      {},
    updatedAt:
      root.updatedAt ||
      root.updated_at ||
      src?.updatedAt ||
      src?.updated_at ||
      undefined,
  };
}

function toRequirementsModel(
  eventId: number,
  src: Partial<RequirementsModel> | null | undefined
): RequirementsModel {
  const incoming = normalizeIncomingRequirements(src);

  const payment = incoming.paymentSettings as any;

  return {
    version: "event_requirements_v2",
    eventId,
    boothCategories: Array.isArray(incoming.boothCategories)
      ? incoming.boothCategories.map((b: any) => ({
          id: String(b?.id || uid("cat")),
          name: String(b?.name || ""),
          baseSize: String(b?.baseSize ?? b?.base_size ?? "10x10"),
          basePrice: Number(b?.basePrice ?? b?.base_price ?? 0) || 0,
          additionalPerFt: Number(b?.additionalPerFt ?? b?.additional_per_ft ?? 0) || 0,
          cornerPremium: Number(b?.cornerPremium ?? b?.corner_premium ?? 0) || 0,
          fireMarshalFee: Number(b?.fireMarshalFee ?? b?.fire_marshal_fee ?? 0) || 0,
          electricalNote: String(b?.electricalNote ?? b?.electrical_note ?? ""),
        }))
      : [],
    customRestrictions: Array.isArray(incoming.customRestrictions)
      ? incoming.customRestrictions.map((r: any) => ({
          id: String(r?.id || uid("r")),
          text: String(r?.text || ""),
        }))
      : [],
    complianceItems: Array.isArray(incoming.complianceItems)
      ? incoming.complianceItems.map((c: any) => ({
          id: String(c?.id || uid("c")),
          text: String(c?.text || ""),
          required: !!c?.required,
        }))
      : [],
    documentRequirements: Array.isArray(incoming.documentRequirements)
      ? incoming.documentRequirements.map((d: any) => ({
          id: String(d?.id || uid("d")),
          name: String(d?.name || ""),
          required: !!d?.required,
          dueBy: String(d?.dueBy ?? d?.due_by ?? ""),
        }))
      : [],
    paymentSettings: {
      enabled: !!payment?.enabled,
      payment_url: String(payment?.payment_url || ""),
      billing_contact_email: String(payment?.billing_contact_email || ""),
      billing_contact_phone: String(payment?.billing_contact_phone || ""),
      memo_instructions: String(payment?.memo_instructions || ""),
      refund_policy: String(payment?.refund_policy || "No Refunds"),
      payment_notes: String(payment?.payment_notes || ""),
      due_by: String(payment?.due_by || ""),
      deposit_type: String(payment?.deposit_type || "none"),
      deposit_value:
        payment?.deposit_value === null || payment?.deposit_value === undefined
          ? null
          : Number(payment.deposit_value) || 0,
      methods:
        payment?.methods && typeof payment.methods === "object"
          ? payment.methods
          : {},
    } as any,
    updatedAt: String(incoming.updatedAt || ""),
  };
}

function normalizeForApi(model: RequirementsModel) {
  return {
    version: 2,
    requirements: {
      booth_categories: model.boothCategories.map((b) => ({
        id: b.id,
        name: b.name,
        base_size: b.baseSize,
        base_price: b.basePrice,
        additional_per_ft: b.additionalPerFt || 0,
        corner_premium: b.cornerPremium || 0,
        fire_marshal_fee: b.fireMarshalFee || 0,
        electrical_note: b.electricalNote || "",
      })),
      custom_restrictions: model.customRestrictions.map((r) => ({
        id: r.id,
        text: r.text,
      })),
      compliance_items: model.complianceItems.map((c) => ({
        id: c.id,
        text: c.text,
        required: !!c.required,
      })),
      document_requirements: model.documentRequirements.map((d) => ({
        id: d.id,
        name: d.name,
        required: !!d.required,
        due_by: d.dueBy || "",
      })),
      payment_settings: {
        ...(model.paymentSettings as any),
      },
      updated_at: new Date().toISOString(),
    },
  };
}

function makeTemplatePayload(model: RequirementsModel) {
  return {
    boothCategories: model.boothCategories.map((b) => ({ ...b, id: uid("cat") })),
    customRestrictions: model.customRestrictions.map((r) => ({ ...r, id: uid("r") })),
    complianceItems: model.complianceItems.map((c) => ({ ...c, id: uid("c") })),
    documentRequirements: model.documentRequirements.map((d) => ({ ...d, id: uid("d") })),
    paymentSettings: { ...(model.paymentSettings as any) },
    updatedAt: new Date().toISOString(),
  };
}

function builtInTemplates(): EventTemplate[] {
  const defaultPayment = {
    enabled: true,
    payment_url: "",
    billing_contact_email: "",
    billing_contact_phone: "",
    memo_instructions: "",
    refund_policy: "No Refunds",
    payment_notes: "",
    due_by: "",
    deposit_type: "none",
    deposit_value: null,
    methods: {},
  } as any;

  return [
    {
      id: "retail_market",
      name: "Retail Vendor Market",
      subtitle: "General retail vendors and maker booths.",
      category: "Marketplace / Retail",
      boothDefaults: [
        { id: uid("cat"), name: "Standard Booth", baseSize: "10x10", basePrice: 175, additionalPerFt: 10, cornerPremium: 35, fireMarshalFee: 0, electricalNote: "" },
        { id: uid("cat"), name: "Premium Corner Booth", baseSize: "10x10", basePrice: 225, additionalPerFt: 10, cornerPremium: 50, fireMarshalFee: 0, electricalNote: "" },
      ],
      restrictionQuickAdds: ["No counterfeit goods", "No weapons or replicas", "No open flames", "No amplified music without approval"],
      complianceQuickAdds: ["Setup must be complete before doors open", "Booth must remain staffed during event hours", "No early breakdown", "All pricing must be clearly posted"],
      documentQuickAdds: ["Business License", "Sales Tax Certificate", "General Liability Insurance"],
      restrictionsDefaults: ["No counterfeit goods", "No weapons or replicas"],
      complianceDefaults: [{ text: "Booth must remain staffed during event hours", required: true }],
      documentsDefaults: [{ name: "Business License", required: true, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "arts_crafts_fair",
      name: "Arts & Crafts Fair",
      subtitle: "Artist-friendly defaults for handmade vendors.",
      category: "Marketplace / Retail",
      boothDefaults: [{ id: uid("cat"), name: "Artist Booth", baseSize: "10x10", basePrice: 150, additionalPerFt: 8, cornerPremium: 25, fireMarshalFee: 0, electricalNote: "" }],
      restrictionQuickAdds: ["No mass-produced imported goods", "No AI-generated prints without disclosure", "No counterfeit artwork"],
      complianceQuickAdds: ["Display materials must be stable and weighted", "No blocking neighboring booths", "Keep aisle clear at all times"],
      documentQuickAdds: ["Business License", "Artist Statement / Product List"],
      restrictionsDefaults: ["No mass-produced imported goods"],
      complianceDefaults: [{ text: "Keep aisle clear at all times", required: true }],
      documentsDefaults: [{ name: "Business License", required: false, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "fashion_popup",
      name: "Fashion / Apparel Pop-Up",
      subtitle: "Boutiques, apparel, and accessories.",
      category: "Marketplace / Retail",
      boothDefaults: [{ id: uid("cat"), name: "Apparel Booth", baseSize: "10x10", basePrice: 225, additionalPerFt: 12, cornerPremium: 40, fireMarshalFee: 0, electricalNote: "Mirror and lighting add-ons may need approval" }],
      restrictionQuickAdds: ["No counterfeit designer items", "No adult merchandise", "No loud music without approval"],
      complianceQuickAdds: ["Fitting areas must be contained within booth", "Racks cannot block egress routes"],
      documentQuickAdds: ["Business License", "Sales Tax Certificate"],
      restrictionsDefaults: ["No counterfeit designer items"],
      complianceDefaults: [{ text: "Racks cannot block egress routes", required: true }],
      documentsDefaults: [{ name: "Sales Tax Certificate", required: true, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "food_vendor_market",
      name: "Food Vendor Market",
      subtitle: "Prepared food and packaged food booths.",
      category: "Food",
      boothDefaults: [{ id: uid("cat"), name: "Food Booth", baseSize: "10x10", basePrice: 300, additionalPerFt: 15, cornerPremium: 45, fireMarshalFee: 0, electricalNote: "Power requests must be approved in advance" }],
      restrictionQuickAdds: ["No alcohol sales without permit", "No open flame without approval", "No outside food vendors inside restricted zones"],
      complianceQuickAdds: ["Fire extinguisher must be present", "Grease disposal required", "Ground cover required"],
      documentQuickAdds: ["Health Permit", "General Liability Insurance", "Menu / Product List", "Food Handler Certifications"],
      restrictionsDefaults: ["No alcohol sales without permit"],
      complianceDefaults: [{ text: "Fire extinguisher must be present", required: true }, { text: "Ground cover required", required: true }],
      documentsDefaults: [{ name: "Health Permit", required: true, dueBy: "14 days before event" }, { name: "General Liability Insurance", required: true, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "food_truck_rally",
      name: "Food Truck Rally",
      subtitle: "Truck-specific spacing, fire, and health docs.",
      category: "Food",
      boothDefaults: [{ id: uid("cat"), name: "Food Truck", baseSize: "20x20", basePrice: 450, additionalPerFt: 20, cornerPremium: 60, fireMarshalFee: 50, electricalNote: "Generator required unless power add-on approved" }],
      restrictionQuickAdds: ["No propane storage outside approved area", "No alcohol sales without permit", "No overnight vehicle parking without approval"],
      complianceQuickAdds: ["Fire extinguisher must be present", "Ground cover required", "Truck must arrive during assigned load-in window"],
      documentQuickAdds: ["Health Permit", "Fire Safety Documentation", "Business Auto Insurance", "Food Handler Certifications"],
      restrictionsDefaults: ["No propane storage outside approved area"],
      complianceDefaults: [{ text: "Truck must arrive during assigned load-in window", required: true }, { text: "Ground cover required", required: true }],
      documentsDefaults: [{ name: "Health Permit", required: true, dueBy: "14 days before event" }, { name: "Fire Safety Documentation", required: true, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "farmers_market",
      name: "Farmers Market",
      subtitle: "Produce, packaged goods, and local vendors.",
      category: "Food",
      boothDefaults: [{ id: uid("cat"), name: "Farm Booth", baseSize: "10x10", basePrice: 95, additionalPerFt: 5, cornerPremium: 20, fireMarshalFee: 0, electricalNote: "" }],
      restrictionQuickAdds: ["No resale produce without disclosure", "No live animals without approval"],
      complianceQuickAdds: ["Scales must be legal-for-trade where applicable", "Products must be clearly labeled", "Booth must be weighted for wind"],
      documentQuickAdds: ["Business License", "Vendor Permit", "Organic Certification"],
      restrictionsDefaults: ["No resale produce without disclosure"],
      complianceDefaults: [{ text: "Products must be clearly labeled", required: true }],
      documentsDefaults: [{ name: "Vendor Permit", required: false, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "tech_startup_expo",
      name: "Tech / Startup Expo",
      subtitle: "Demo-heavy, power-friendly exhibitor setup.",
      category: "Exhibitions",
      boothDefaults: [{ id: uid("cat"), name: "Startup Booth", baseSize: "10x10", basePrice: 350, additionalPerFt: 20, cornerPremium: 60, fireMarshalFee: 0, electricalNote: "List total wattage needs in advance" }],
      restrictionQuickAdds: ["No crypto/financial claims signage without approval", "No unauthorized data collection", "No drones indoors"],
      complianceQuickAdds: ["All extension cords must be taped down", "Audio demos must use headphones unless approved", "Lead collection disclosures must be visible"],
      documentQuickAdds: ["Business License", "Certificate of Insurance", "Power Requirements Form"],
      restrictionsDefaults: ["No unauthorized data collection"],
      complianceDefaults: [{ text: "All extension cords must be taped down", required: true }],
      documentsDefaults: [{ name: "Power Requirements Form", required: false, dueBy: "7 days before event" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "trade_show_b2b",
      name: "Trade Show (B2B)",
      subtitle: "Professional exhibitor layout and documents.",
      category: "Exhibitions",
      boothDefaults: [
        { id: uid("cat"), name: "Standard Booth", baseSize: "10x10", basePrice: 325, additionalPerFt: 18, cornerPremium: 50, fireMarshalFee: 0, electricalNote: "" },
        { id: uid("cat"), name: "Island Booth", baseSize: "20x20", basePrice: 950, additionalPerFt: 22, cornerPremium: 0, fireMarshalFee: 0, electricalNote: "Custom builds must be approved in advance" },
      ],
      restrictionQuickAdds: ["No subletting booths", "No hazardous materials", "No rigging without approval"],
      complianceQuickAdds: ["All displays over height limit require approval", "Move-in and move-out windows must be followed", "All exhibitors must wear badges"],
      documentQuickAdds: ["Certificate of Insurance", "Exhibitor Agreement", "Electrical Order Form"],
      restrictionsDefaults: ["No subletting booths"],
      complianceDefaults: [{ text: "Move-in and move-out windows must be followed", required: true }],
      documentsDefaults: [{ name: "Exhibitor Agreement", required: true, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "sponsor_booths",
      name: "Sponsor Booths",
      subtitle: "Premium sponsor and activation setups.",
      category: "Exhibitions",
      boothDefaults: [{ id: uid("cat"), name: "Sponsor Activation", baseSize: "20x20", basePrice: 1500, additionalPerFt: 30, cornerPremium: 0, fireMarshalFee: 0, electricalNote: "Custom activations require production review" }],
      restrictionQuickAdds: ["No giveaways requiring purchase", "No amplified sound without approval", "No alcohol sampling without permit"],
      complianceQuickAdds: ["Brand assets must match sponsor package", "Activation footprint must stay within assigned zone"],
      documentQuickAdds: ["Sponsor Agreement", "Certificate of Insurance", "Activation Plan"],
      restrictionsDefaults: ["No amplified sound without approval"],
      complianceDefaults: [{ text: "Activation footprint must stay within assigned zone", required: true }],
      documentsDefaults: [{ name: "Activation Plan", required: true, dueBy: "14 days before event" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "community_festival",
      name: "Community Festival",
      subtitle: "Mixed vendors and community organizations.",
      category: "Community",
      boothDefaults: [{ id: uid("cat"), name: "Community Booth", baseSize: "10x10", basePrice: 125, additionalPerFt: 8, cornerPremium: 20, fireMarshalFee: 0, electricalNote: "" }],
      restrictionQuickAdds: ["No political campaigning without approval", "No hate speech or offensive displays", "No unauthorized fundraising"],
      complianceQuickAdds: ["Booth must remain family-friendly", "Staff must follow event conduct rules"],
      documentQuickAdds: ["Business License", "Certificate of Insurance", "Nonprofit Letter"],
      restrictionsDefaults: ["No hate speech or offensive displays"],
      complianceDefaults: [{ text: "Booth must remain family-friendly", required: true }],
      documentsDefaults: [{ name: "Certificate of Insurance", required: false, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "nonprofit_fair",
      name: "Non-Profit Fair",
      subtitle: "Outreach booths and low-friction compliance.",
      category: "Community",
      boothDefaults: [{ id: uid("cat"), name: "Outreach Booth", baseSize: "10x10", basePrice: 50, additionalPerFt: 5, cornerPremium: 10, fireMarshalFee: 0, electricalNote: "" }],
      restrictionQuickAdds: ["No sales not approved by organizer", "No aggressive solicitation"],
      complianceQuickAdds: ["Printed materials must stay inside booth footprint", "Representatives must identify organization clearly"],
      documentQuickAdds: ["501(c)(3) Letter", "Organization Overview"],
      restrictionsDefaults: ["No aggressive solicitation"],
      complianceDefaults: [{ text: "Representatives must identify organization clearly", required: true }],
      documentsDefaults: [{ name: "501(c)(3) Letter", required: false, dueBy: "" }],
      paymentDefaults: defaultPayment,
    },
    {
      id: "kids_family_event",
      name: "Kids / Family Event",
      subtitle: "Family-safe activities and tighter safety defaults.",
      category: "Community",
      boothDefaults: [{ id: uid("cat"), name: "Family Booth", baseSize: "10x10", basePrice: 165, additionalPerFt: 8, cornerPremium: 25, fireMarshalFee: 0, electricalNote: "" }],
      restrictionQuickAdds: ["No mature/adult content", "No unsafe inflatables or moving props", "No sharp demo materials within reach of children"],
      complianceQuickAdds: ["Booth must remain family-friendly", "All staff interacting with children must be supervised", "Trip hazards must be eliminated"],
      documentQuickAdds: ["Certificate of Insurance", "Activity Safety Plan", "Background Check Confirmation"],
      restrictionsDefaults: ["No mature/adult content"],
      complianceDefaults: [{ text: "Trip hazards must be eliminated", required: true }],
      documentsDefaults: [{ name: "Activity Safety Plan", required: true, dueBy: "10 days before event" }],
      paymentDefaults: defaultPayment,
    },
  ];
}

function iconBadge(emoji: string) {
  return (
    <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
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
        {iconBadge(emoji)}
        <div>
          <div className="text-xl font-black text-slate-900">{title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export default function OrganizerEventRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams();
  const { accessToken } = useAuth();

  const eid = useMemo(() => {
    const n = Number(eventId);
    return Number.isFinite(n) ? n : null;
  }, [eventId]);

  const sp = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedTemplateId = sp.get("templateId") || "";
  const requestedTemplateSource = sp.get("templateSource") || "";

  const storageKey = useMemo(() => `${LS_EVENT_REQ_PREFIX}:${eventId}:requirements`, [eventId]);
  const templates = useMemo(() => builtInTemplates(), []);
  const templateAppliedRef = useRef(false);

  const saveBtnBlue =
    "rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
  const subtleBtn =
    "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50";
  const addBtnGreen =
    "rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700";
  const chipCls =
    "rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-100";
  const inputCls =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-200";
  const sectionCard = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [model, setModel] = useState<RequirementsModel | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const [savedTemplates, setSavedTemplates] = useState<SavedRequirementTemplate[]>([]);
  const [selectedBuiltInTemplateId, setSelectedBuiltInTemplateId] = useState<string>(
    templates[0]?.id || "retail_market"
  );
  const [selectedSavedTemplateId, setSelectedSavedTemplateId] = useState<string>("");

  const [customRestrictionText, setCustomRestrictionText] = useState("");
  const [customComplianceText, setCustomComplianceText] = useState("");
  const [customDocName, setCustomDocName] = useState("");

  function bump(m: RequirementsModel): RequirementsModel {
    return { ...m, updatedAt: new Date().toISOString() };
  }

  function emptyModel(eventIdNum: number): RequirementsModel {
    return {
      version: "event_requirements_v2",
      eventId: eventIdNum,
      boothCategories: [],
      customRestrictions: [],
      complianceItems: [],
      documentRequirements: [],
      paymentSettings: {
        enabled: true,
        payment_url: "",
        billing_contact_email: "",
        billing_contact_phone: "",
        memo_instructions: "",
        refund_policy: "No Refunds",
        payment_notes: "",
        due_by: "",
        deposit_type: "none",
        deposit_value: null,
        methods: {},
      } as any,
      updatedAt: new Date().toISOString(),
    };
  }

  function applyBuiltInTemplate(templateId: string) {
    if (!eid) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;

    const next = bump({
      version: "event_requirements_v2",
      eventId: eid,
      boothCategories: tpl.boothDefaults.map((b) => ({ ...b, id: uid("cat") })),
      customRestrictions: tpl.restrictionsDefaults.map((text) => ({ id: uid("r"), text })),
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
      paymentSettings: { ...(tpl.paymentDefaults as any) },
      updatedAt: new Date().toISOString(),
    });

    setModel(next);
    setToast(`Built-in template loaded: ${tpl.name}`);
    setError(null);

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function applySavedTemplate(template: SavedRequirementTemplate) {
    if (!eid) return;

    const next = bump({
      ...toRequirementsModel(eid, template.payload),
      eventId: eid,
    });

    setModel(next);
    setToast(`Saved template loaded: ${template.name}`);
    setError(null);

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  async function loadSavedTemplates() {
    const res = await fetchJson(API.templateList, { accessToken });
    if (!res.ok) return;

    const raw = Array.isArray((res.data as any)?.items)
      ? (res.data as any).items
      : Array.isArray(res.data)
      ? (res.data as any[])
      : [];

    const list: SavedRequirementTemplate[] = raw
      .map((item: any) => ({
        id: String(item?.id ?? ""),
        name: String(item?.name ?? "Saved template"),
        category: item?.category ? String(item.category) : "",
        payload: toRequirementsModel(eid || 0, item?.payload || item?.requirements || item),
        updatedAt: String(item?.updated_at || item?.updatedAt || ""),
      }))
      .filter((item) => item.id);

    setSavedTemplates(list);
    if (!selectedSavedTemplateId && list[0]?.id) {
      setSelectedSavedTemplateId(list[0].id);
    }
  }

  async function maybeApplyRequestedTemplate(currentModel: RequirementsModel | null) {
    if (!eid || templateAppliedRef.current) return;

    const looksEmpty =
      !currentModel ||
      ((currentModel.boothCategories?.length || 0) === 0 &&
        (currentModel.customRestrictions?.length || 0) === 0 &&
        (currentModel.complianceItems?.length || 0) === 0 &&
        (currentModel.documentRequirements?.length || 0) === 0);

    if (!looksEmpty) return;

    if (requestedTemplateSource === "saved" && requestedTemplateId) {
      const res = await fetchJson(API.templateRead(requestedTemplateId), { accessToken });
      if (res.ok && res.data) {
        const template: SavedRequirementTemplate = {
          id: String((res.data as any)?.id || requestedTemplateId),
          name: String((res.data as any)?.name || "Saved template"),
          category: String((res.data as any)?.category || ""),
          payload: toRequirementsModel(eid, (res.data as any)?.payload || (res.data as any)?.requirements || res.data),
          updatedAt: String((res.data as any)?.updated_at || ""),
        };
        applySavedTemplate(template);
        templateAppliedRef.current = true;
        return;
      }
    }

    if (requestedTemplateSource === "builtin" && requestedTemplateId) {
      setSelectedBuiltInTemplateId(requestedTemplateId);
      applyBuiltInTemplate(requestedTemplateId);
      templateAppliedRef.current = true;
      return;
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

      let nextModel: RequirementsModel | null = null;

      try {
        const local = localStorage.getItem(storageKey);
        if (local) {
          nextModel = toRequirementsModel(eid, JSON.parse(local));
        }
      } catch {
        // ignore
      }

      const tries = [API.organizerGet(eid), API.publicGet(eid)];
      for (const path of tries) {
        const res = await fetchJson(path, { accessToken });
        if (res.ok && res.data) {
          nextModel = toRequirementsModel(eid, res.data);
          break;
        }
      }

      if (!nextModel) {
        nextModel = emptyModel(eid);
      }

      if (!cancelled) {
        setModel(nextModel);
        try {
          localStorage.setItem(storageKey, JSON.stringify(nextModel));
        } catch {
          // ignore
        }
        await loadSavedTemplates().catch(() => {});
        await maybeApplyRequestedTemplate(nextModel);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [eid, eventId]);

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
        const res = await saveJson(attempt.method, attempt.path, payload, { accessToken });
        if (res.ok) {
          setSaving(false);
          setToast("Configuration saved ✅");
          setSavedOk(true);
          return true;
        }
      } catch {
        // ignore and try next
      }
    }

    setSaving(false);
    setError("Could not save requirements to the backend. Check the organizer requirements endpoint.");
    return false;
  }

  async function saveAsTemplate() {
    if (!model || !eid) return;

    const name = window.prompt("Template name");
    if (!name || !name.trim()) return;

    const category = window.prompt("Template category (optional)", "") || "";

    setTemplateSaving(true);
    setError(null);
    setToast(null);

    const body = {
      name: name.trim(),
      category: category.trim(),
      payload: makeTemplatePayload(model),
    };

    const res = await saveJson("POST", API.templateCreate, body, { accessToken });
    setTemplateSaving(false);

    if (!res.ok) {
      setError("Could not save template to backend. Make sure /organizer/requirement-templates exists.");
      return;
    }

    setToast(`Template saved: ${name.trim()}`);
    await loadSavedTemplates().catch(() => {});
  }

  async function updateCurrentTemplate() {
    const active = savedTemplates.find((t) => t.id === selectedSavedTemplateId);
    if (!active || !model) return;

    setTemplateSaving(true);
    setError(null);
    setToast(null);

    const body = {
      name: active.name,
      category: active.category || "",
      payload: makeTemplatePayload(model),
    };

    const res = await saveJson("PUT", API.templateUpdate(active.id), body, { accessToken });
    setTemplateSaving(false);

    if (!res.ok) {
      setError("Could not update the saved template on the backend.");
      return;
    }

    setToast(`Template updated: ${active.name}`);
    await loadSavedTemplates().catch(() => {});
  }

  async function deleteSelectedTemplate() {
    const active = savedTemplates.find((t) => t.id === selectedSavedTemplateId);
    if (!active) return;
    const ok = window.confirm(`Delete template "${active.name}"?`);
    if (!ok) return;

    setTemplateSaving(true);
    setError(null);
    setToast(null);

    const res = await saveJson("DELETE", API.templateDelete(active.id), null, { accessToken });
    setTemplateSaving(false);

    if (!res.ok) {
      setError("Could not delete template from the backend.");
      return;
    }

    setToast(`Template deleted: ${active.name}`);
    setSelectedSavedTemplateId("");
    await loadSavedTemplates().catch(() => {});
  }

  function setBoothCategory(id: string, patch: Partial<BoothCategory>) {
    if (!model) return;
    setModel(
      bump({
        ...model,
        boothCategories: model.boothCategories.map((b) => (b.id === id ? { ...b, ...patch } : b)),
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
            name: "",
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
    setModel(bump({ ...model, boothCategories: model.boothCategories.filter((b) => b.id !== id) }));
  }

  function addRestriction(text: string) {
    if (!model) return;
    const value = text.trim();
    if (!value) return;
    setModel(
      bump({
        ...model,
        customRestrictions: [...model.customRestrictions, { id: uid("r"), text: value }],
      })
    );
  }

  function removeRestriction(id: string) {
    if (!model) return;
    setModel(bump({ ...model, customRestrictions: model.customRestrictions.filter((r) => r.id !== id) }));
  }

  function addCompliance(text: string, required: boolean) {
    if (!model) return;
    const value = text.trim();
    if (!value) return;
    setModel(
      bump({
        ...model,
        complianceItems: [
          ...model.complianceItems,
          { id: uid("c"), text: value, required: !!required },
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
    setModel(bump({ ...model, complianceItems: model.complianceItems.filter((c) => c.id !== id) }));
  }

  function addDocument(name: string, required: boolean) {
    if (!model) return;
    const value = name.trim();
    if (!value) return;
    setModel(
      bump({
        ...model,
        documentRequirements: [
          ...model.documentRequirements,
          { id: uid("d"), name: value, required: !!required, dueBy: "" },
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
    setModel(bump({ ...model, documentRequirements: model.documentRequirements.filter((d) => d.id !== id) }));
  }

  const selectedBuiltInTemplate =
    templates.find((t) => t.id === selectedBuiltInTemplateId) || templates[0];
  const selectedSavedTemplate = savedTemplates.find((t) => t.id === selectedSavedTemplateId) || null;

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Loading configuration…</div>
      </div>
    );
  }

  if (!model || !eid) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xl font-black text-slate-900">Event Setup & Vendor Requirements</div>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error || "Unable to load requirements."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
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
            <button type="button" className={saveBtnBlue} onClick={onSave} disabled={saving}>
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
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="xl:max-w-xl">
              <div className="text-sm font-black text-slate-900">Requirement Templates</div>
              <div className="mt-1 text-xs font-bold text-slate-600">
                Save this event’s requirements to your backend, reuse them in future events, and choose from expanded built-in presets.
              </div>
            </div>

            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
              Backend mode
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">Built-in Templates</div>
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Expanded defaults beyond Tech / Food / Art.
              </div>

              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <select
                  className={inputCls}
                  value={selectedBuiltInTemplateId}
                  onChange={(e) => setSelectedBuiltInTemplateId(e.target.value)}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} — {tpl.category}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className={subtleBtn}
                  onClick={() => applyBuiltInTemplate(selectedBuiltInTemplateId)}
                >
                  Load built-in
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700">
                <span className="font-black">{selectedBuiltInTemplate?.name}:</span>{" "}
                {selectedBuiltInTemplate?.subtitle}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">Saved Organizer Templates</div>
              <div className="mt-1 text-xs font-semibold text-slate-600">
                Persist these in your backend so they work across devices.
              </div>

              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <select
                  className={inputCls}
                  value={selectedSavedTemplateId}
                  onChange={(e) => setSelectedSavedTemplateId(e.target.value)}
                >
                  {savedTemplates.length === 0 ? (
                    <option value="">No saved templates yet</option>
                  ) : null}
                  {savedTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}{tpl.category ? ` — ${tpl.category}` : ""}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className={subtleBtn}
                  disabled={!selectedSavedTemplate}
                  onClick={() => selectedSavedTemplate && applySavedTemplate(selectedSavedTemplate)}
                >
                  Load saved
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={addBtnGreen}
                  onClick={saveAsTemplate}
                  disabled={templateSaving}
                >
                  {templateSaving ? "Saving…" : "Save As Template"}
                </button>

                <button
                  type="button"
                  className={subtleBtn}
                  onClick={updateCurrentTemplate}
                  disabled={!selectedSavedTemplate || templateSaving}
                >
                  Update Selected
                </button>

                <button
                  type="button"
                  className={subtleBtn}
                  onClick={deleteSelectedTemplate}
                  disabled={!selectedSavedTemplate || templateSaving}
                >
                  Delete Selected
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-700">
                {selectedSavedTemplate ? (
                  <>
                    <span className="font-black">{selectedSavedTemplate.name}</span>
                    {selectedSavedTemplate.category ? ` — ${selectedSavedTemplate.category}` : ""}
                  </>
                ) : (
                  "Saved templates load from GET /organizer/requirement-templates"
                )}
              </div>
            </div>
          </div>

          {toast ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">
              {toast}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-800">
              {error}
            </div>
          ) : null}
        </div>

        <div className={sectionCard}>
          <SectionHeader
            emoji="🎪"
            title="Booth Categories"
            subtitle="Define available booth types and pricing for your event."
            right={
              <button type="button" className={addBtnGreen} onClick={addBoothCategory}>
                + Add Category
              </button>
            }
          />

          <div className="mt-6 grid gap-4">
            {model.boothCategories.map((c) => (
              <div key={c.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs font-black text-slate-700">Category Name *</div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      value={c.name}
                      onChange={(e) => setBoothCategory(c.id, { name: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">Base Size *</div>
                    <input
                      className={`mt-2 ${inputCls}`}
                      value={c.baseSize}
                      onChange={(e) => setBoothCategory(c.id, { baseSize: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-black text-slate-700">Base Price *</div>
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
                    <div className="text-xs font-black text-slate-700">Additional $/ft</div>
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
                    <div className="text-xs font-black text-slate-700">Corner Premium</div>
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
                    <div className="text-xs font-black text-slate-700">Fire Marshal Fee</div>
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
                    <div className="text-xs font-black text-slate-700">Electrical Note</div>
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

        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="🚫"
            title="Vendor Restrictions"
            subtitle="Define prohibited items and activities for your event."
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedBuiltInTemplate?.restrictionQuickAdds.map((t) => (
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

        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="📋"
            title="Compliance Requirements"
            subtitle="Set operational rules vendors must acknowledge."
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedBuiltInTemplate?.complianceQuickAdds.map((t) => (
                <button key={t} type="button" className={chipCls} onClick={() => addCompliance(t, true)}>
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
                      <span className="mr-2 text-xs font-black text-slate-600">Required</span>
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

        <div className={`${sectionCard} mt-8`}>
          <SectionHeader
            emoji="📄"
            title="Document Requirements"
            subtitle="Specify which documents vendors must upload."
          />

          <div className="mt-6">
            <div className="text-sm font-black text-slate-900">Quick Add Templates</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedBuiltInTemplate?.documentQuickAdds.map((t) => (
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
                <div key={d.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!d.required}
                        onChange={(e) => toggleDocRequired(d.id, e.target.checked)}
                      />
                      <div className="text-sm font-semibold text-slate-900">
                        <span className="mr-2 text-xs font-black text-slate-600">Required</span>
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

        <div className="h-10" />
      </div>
    </div>
  );
}





