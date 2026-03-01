// src/pages/VendorEventRequirementsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  vendorGetOrCreateDraftApplication,
  vendorGetApplication,
  vendorSaveProgress,
  type UploadedDocMeta,
} from "../components/api/applications";

/* ---------------- Types ---------------- */

type RequirementField = {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  description?: string;
};

type ComplianceItem = {
  id: string;
  text: string;
  required?: boolean;
};

type DocumentRequirement = {
  id: string;
  name: string;
  required?: boolean;
  dueBy?: string;
};

type BoothCategory = {
  id: string;
  name: string;
  baseSize?: string; // e.g. "10x10"
  basePrice?: number; // dollars (normalized)
  additionalPerFt?: number; // dollars (normalized)
  cornerPremium?: number; // dollars (normalized)
  fireMarshalFee?: number; // dollars (normalized)
  electricalNote?: string;
};

type PaymentSettings = Record<string, any>;

type LoadedRequirements = {
  templateKey?: string;

  boothCategories: BoothCategory[];
  restrictions: string[];
  compliance: ComplianceItem[];
  documents: DocumentRequirement[];
  fields: RequirementField[];
  paymentSettings?: PaymentSettings;

  raw: any;
  source: "api" | "localStorage";
  sourceKey?: string;
};

type UploadMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type VendorReqProgress = {
  eventId: string;
  appId?: string;
  checked: Record<string, boolean>;
  uploads: Record<string, UploadMeta[]>;
  updatedAt: string;
};

/* ---------------- Config ---------------- */

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

const LS_LEGACY_REQUIREMENTS_KEY = "event_requirements_v1_2";
const LS_VENDOR_PROGRESS_KEY = "vendor_requirements_progress_v1";

/* ---------------- Helpers ---------------- */

function normalizeId(v: unknown) {
  return String(v ?? "").trim();
}

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function money(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? `$${v}` : "—";
}

function numberOrNull(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolish(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return ["true", "1", "yes", "y", "on"].includes(v.toLowerCase().trim());
  return false;
}

/**
 * Payment settings can come in different shapes depending on old/new UI/API.
 * We normalize best-effort for display.
 */
function normalizePaymentSettings(ps?: any) {
  // Supports both legacy shapes and new structured payment_settings.
  const obj = ps && typeof ps === "object" ? ps : null;
  if (!obj) {
    return {
      has: false,
      paymentUrl: "",
      methods: [] as Array<{ key: string; label: string; contact: string }>,
      memo: "",
      dueBy: "",
      depositType: "none" as "none" | "flat" | "percent",
      depositValue: null as number | null,
      billingEmail: "",
      billingPhone: "",
      refundPolicy: "",
      notes: "",
    };
  }

  // New shape (preferred)
  const enabled = boolish(obj.enabled ?? obj.isEnabled ?? obj.payment_enabled ?? true);

  const paymentUrl = String(obj.payment_url ?? obj.paymentUrl ?? "").trim();

  const methodsObj = (obj.methods && typeof obj.methods === "object" ? obj.methods : null) as
    | Record<string, any>
    | null;

  const labelMap: Record<string, string> = {
    zelle: "Zelle",
    venmo: "Venmo",
    paypal: "PayPal",
    cashapp: "Cash App",
    cash: "Cash",
    check: "Check",
    ach: "Bank Transfer (ACH)",
    wire: "Wire Transfer",
    other: "Other",
  };

  const methods: Array<{ key: string; label: string; contact: string }> = [];
  if (methodsObj) {
    for (const k of Object.keys(methodsObj)) {
      const row = methodsObj[k];
      const isOn = boolish(row?.enabled ?? row?.on ?? row?.active ?? false);
      const contact = String(row?.contact ?? row?.handle ?? row?.email ?? row?.value ?? "").trim();
      if (isOn && contact) {
        methods.push({ key: k, label: labelMap[k] || k, contact });
      }
    }
  }

  const memo = String(obj.memo_instructions ?? obj.memoInstructions ?? obj.memo ?? "").trim();
  const dueBy = String(obj.due_by ?? obj.dueBy ?? "").trim();

  const depositTypeRaw = String(obj.deposit_type ?? obj.depositType ?? "none").toLowerCase().trim();
  const depositType =
    depositTypeRaw === "flat" || depositTypeRaw === "percent" ? (depositTypeRaw as any) : "none";

  const depositValue = numberOrNull(obj.deposit_value ?? obj.depositValue ?? obj.deposit ?? null);

  const billingEmail = String(obj.billing_contact_email ?? obj.billingContactEmail ?? obj.billingEmail ?? "").trim();
  const billingPhone = String(obj.billing_contact_phone ?? obj.billingContactPhone ?? obj.billingPhone ?? "").trim();

  const refundPolicy = String(obj.refund_policy ?? obj.refundPolicy ?? "").trim();
  const notes = String(obj.payment_notes ?? obj.paymentNotes ?? obj.notes ?? "").trim();

  // Legacy fallbacks (older API/UI)
  const legacyRequireDeposit = boolish(
    obj.requireDeposit ??
      obj.require_deposit ??
      obj.depositRequired ??
      obj.deposit_required
  );

  const legacyDepositPercent = numberOrNull(
    obj.depositPercent ??
      obj.deposit_percent ??
      obj.depositPct ??
      obj.deposit_pct ??
      obj.deposit_percentage ??
      obj.depositPercentage
  );

  const legacyRefundPolicy = String(
    obj.refundPolicy ??
      obj.refund_policy ??
      obj.refund ??
      obj.refundType ??
      obj.refund_type ??
      ""
  ).trim();

  const legacyNotes = String(
    obj.paymentNotes ?? obj.payment_notes ?? obj.notes ?? obj.note ?? ""
  ).trim();

  const has =
    enabled &&
    (Boolean(paymentUrl) ||
      methods.length > 0 ||
      Boolean(memo) ||
      Boolean(dueBy) ||
      depositType !== "none" ||
      depositValue !== null ||
      Boolean(billingEmail) ||
      Boolean(billingPhone) ||
      Boolean(refundPolicy) ||
      Boolean(notes) ||
      legacyRequireDeposit ||
      legacyDepositPercent !== null ||
      Boolean(legacyRefundPolicy) ||
      Boolean(legacyNotes));

  // Merge legacy into new if new missing
  const mergedDepositType =
    depositType !== "none"
      ? depositType
      : legacyRequireDeposit || legacyDepositPercent !== null
        ? "percent"
        : "none";

  const mergedDepositValue =
    depositValue !== null ? depositValue : legacyDepositPercent !== null ? legacyDepositPercent : null;

  return {
    has,
    paymentUrl,
    methods,
    memo: memo || legacyNotes,
    dueBy,
    depositType: mergedDepositType,
    depositValue: mergedDepositValue,
    billingEmail,
    billingPhone,
    refundPolicy: refundPolicy || legacyRefundPolicy,
    notes,
  };
}

function Badge({ kind }: { kind: "Required" | "Optional" }) {
  if (kind === "Required") {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
        Required
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      Optional
    </span>
  );
}

/**
 * Accept organizer requirements in either shape:
 * - Newer keys: restrictions/compliance/documents/fields/boothCategories/paymentSettings
 * - Builder keys: customRestrictions/complianceItems/documentRequirements/boothCategories/paymentSettings
 * - API snake_case: custom_restrictions/compliance_items/document_requirements/booth_categories/payment_settings
 * - Wrapped: { requirements: {...} }
 */
function normalizeRequirementsShape(
  raw: any
): Omit<LoadedRequirements, "source" | "sourceKey"> | null {
  if (!raw || typeof raw !== "object") return null;

  const parsed = raw?.requirements ?? raw;

  const templateKey = parsed?.templateKey || parsed?.id || undefined;

  // ✅ booth_categories supports *_cents and electrical_note
  const boothCategories: BoothCategory[] = Array.isArray(parsed?.boothCategories)
    ? parsed.boothCategories
    : Array.isArray(parsed?.booth_categories)
      ? parsed.booth_categories.map((c: any) => {
          const toDollars = (n: any) =>
            typeof n === "number" && Number.isFinite(n) ? n / 100 : undefined;

          const basePrice =
            typeof c?.base_price === "number"
              ? c.base_price
              : typeof c?.basePrice === "number"
                ? c.basePrice
                : typeof c?.base_price_cents === "number"
                  ? toDollars(c.base_price_cents)
                  : typeof c?.basePriceCents === "number"
                    ? toDollars(c.basePriceCents)
                    : undefined;

          const additionalPerFt =
            typeof c?.additional_per_ft === "number"
              ? c.additional_per_ft
              : typeof c?.additionalPerFt === "number"
                ? c.additionalPerFt
                : typeof c?.additional_per_ft_cents === "number"
                  ? toDollars(c.additional_per_ft_cents)
                  : typeof c?.additionalPerFtCents === "number"
                    ? toDollars(c.additionalPerFtCents)
                    : undefined;

          const cornerPremium =
            typeof c?.corner_premium === "number"
              ? c.corner_premium
              : typeof c?.cornerPremium === "number"
                ? c.cornerPremium
                : typeof c?.corner_premium_cents === "number"
                  ? toDollars(c.corner_premium_cents)
                  : typeof c?.cornerPremiumCents === "number"
                    ? toDollars(c.cornerPremiumCents)
                    : undefined;

          const fireMarshalFee =
            typeof c?.fire_marshal_fee === "number"
              ? c.fire_marshal_fee
              : typeof c?.fireMarshalFee === "number"
                ? c.fireMarshalFee
                : typeof c?.fire_marshal_fee_cents === "number"
                  ? toDollars(c.fire_marshal_fee_cents)
                  : typeof c?.fireMarshalFeeCents === "number"
                    ? toDollars(c.fireMarshalFeeCents)
                    : undefined;

          const electricalNote =
            c?.electrical_note != null
              ? String(c.electrical_note)
              : c?.electricalNote != null
                ? String(c.electricalNote)
                : undefined;

          return {
            id: normalizeId(c?.id ?? c?.name),
            name: String(c?.name || "").trim(),
            baseSize: c?.base_size
              ? String(c.base_size)
              : c?.baseSize
                ? String(c.baseSize)
                : undefined,
            basePrice,
            additionalPerFt,
            cornerPremium,
            fireMarshalFee,
            electricalNote,
          };
        })
      : [];

  const restrictions: string[] = Array.isArray(parsed?.restrictions)
    ? parsed.restrictions
    : Array.isArray(parsed?.customRestrictions)
      ? parsed.customRestrictions
          .map((r: any) => (typeof r === "string" ? r : r?.text || r?.label || ""))
          .map((s: any) => String(s || "").trim())
          .filter(Boolean)
      : Array.isArray(parsed?.custom_restrictions)
        ? parsed.custom_restrictions
            .map((r: any) => String(r?.text || r?.label || r || "").trim())
            .filter(Boolean)
        : [];

  const compliance: ComplianceItem[] = Array.isArray(parsed?.compliance)
    ? parsed.compliance
    : Array.isArray(parsed?.complianceItems)
      ? parsed.complianceItems
          .map((c: any) => ({
            id: normalizeId(c?.id || c?.text || c?.label),
            text: String(c?.text || c?.label || "").trim(),
            required: !!c?.required,
          }))
          .filter((c: any) => c.text)
      : Array.isArray(parsed?.compliance_items)
        ? parsed.compliance_items
            .map((c: any) => ({
              id: normalizeId(c?.id || c?.text || c?.label),
              text: String(c?.text || c?.label || "").trim(),
              required: !!c?.required,
            }))
            .filter((c: any) => c.text)
        : [];

  const documents: DocumentRequirement[] = Array.isArray(parsed?.documents)
    ? parsed.documents
    : Array.isArray(parsed?.documentRequirements)
      ? parsed.documentRequirements
          .map((d: any) => ({
            id: normalizeId(d?.id || d?.name),
            name: String(d?.name || "").trim(),
            required: !!d?.required,
            dueBy: d?.dueBy ? String(d.dueBy) : undefined,
          }))
          .filter((d: any) => d.name)
      : Array.isArray(parsed?.document_requirements)
        ? parsed.document_requirements
            .map((d: any) => ({
              id: normalizeId(d?.id || d?.name),
              name: String(d?.name || "").trim(),
              required: !!d?.required,
              dueBy: d?.due_by ? String(d.due_by) : undefined,
            }))
            .filter((d: any) => d.name)
        : [];

  const fields: RequirementField[] = Array.isArray(parsed?.fields)
    ? parsed.fields
        .map((f: any) => ({
          id: normalizeId(f?.id || f?.label),
          label: String(f?.label || "").trim(),
          type: f?.type ? String(f.type) : undefined,
          required: !!f?.required,
          description: f?.description ? String(f.description) : undefined,
        }))
        .filter((f: any) => f.label)
    : [];

  const paymentSettings =
    (parsed?.paymentSettings && typeof parsed.paymentSettings === "object"
      ? parsed.paymentSettings
      : undefined) ??
    (parsed?.payment_settings && typeof parsed.payment_settings === "object"
      ? parsed.payment_settings
      : undefined);

  const hasAny =
    boothCategories.length > 0 ||
    restrictions.length > 0 ||
    compliance.length > 0 ||
    documents.length > 0 ||
    fields.length > 0 ||
    !!paymentSettings;

  if (!hasAny) return null;

  return {
    templateKey,
    boothCategories,
    restrictions,
    compliance,
    documents,
    fields,
    paymentSettings,
    raw,
  };
}

async function loadRequirementsFromApi(eventId: string): Promise<LoadedRequirements | null> {
  const candidates = [
    // ✅ Correct public endpoint (exists)
    `${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      const normalized = normalizeRequirementsShape(data);
      if (!normalized) continue;

      return { ...normalized, source: "api", sourceKey: url };
    } catch {
      // try next
    }
  }

  return null;
}

function loadRequirementsFromLocalStorage(eventId: string): LoadedRequirements | null {
  const id = normalizeId(eventId);
  if (!id) return null;

  const organizerKey = `organizer:event:${id}:requirements`;
  const organizerParsed = safeJsonParse(localStorage.getItem(organizerKey));
  const normalizedOrganizer = normalizeRequirementsShape(organizerParsed);
  if (normalizedOrganizer)
    return { ...normalizedOrganizer, source: "localStorage", sourceKey: organizerKey };

  const legacyParsed = safeJsonParse(localStorage.getItem(LS_LEGACY_REQUIREMENTS_KEY));
  if (legacyParsed) {
    const maybe = (legacyParsed as any)?.[id] ?? legacyParsed;
    const normalizedLegacy = normalizeRequirementsShape(maybe);
    if (normalizedLegacy)
      return { ...normalizedLegacy, source: "localStorage", sourceKey: LS_LEGACY_REQUIREMENTS_KEY };
  }

  return null;
}

function migrateCheckedKeys(checked: Record<string, boolean> | undefined | null) {
  const src = checked && typeof checked === "object" ? checked : {};
  const out: Record<string, boolean> = { ...src };

  // ✅ migrate old compliance:<id> => <id>
  for (const k of Object.keys(src)) {
    if (k.startsWith("compliance:")) {
      const plain = normalizeId(k.slice("compliance:".length));
      if (plain) out[plain] = !!src[k];
      delete out[k];
    }
  }

  return out;
}

function loadVendorProgress(eventId: string, appId?: string): VendorReqProgress | null {
  const all = safeJsonParse<VendorReqProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS_KEY));
  if (!Array.isArray(all)) return null;

  const eId = normalizeId(eventId);
  const aId = normalizeId(appId || "");

  return all.find((p) => normalizeId(p.eventId) === eId && normalizeId(p.appId || "") === aId) ?? null;
}

function saveVendorProgress(progress: VendorReqProgress) {
  const all = safeJsonParse<VendorReqProgress[]>(localStorage.getItem(LS_VENDOR_PROGRESS_KEY));
  const list = Array.isArray(all) ? all : [];

  const eId = normalizeId(progress.eventId);
  const aId = normalizeId(progress.appId || "");

  const next = list.filter((p) => !(normalizeId(p.eventId) === eId && normalizeId(p.appId || "") === aId));
  next.unshift(progress);

  localStorage.setItem(LS_VENDOR_PROGRESS_KEY, JSON.stringify(next));
}

function serverDocumentsToUploads(
  docs: Record<string, UploadedDocMeta[] | null> | null | undefined
): Record<string, UploadMeta[]> {
  const out: Record<string, UploadMeta[]> = {};
  const root = docs || {};
  for (const [docIdRaw, list] of Object.entries(root)) {
    const docId = normalizeId(docIdRaw);
    if (!docId) continue;
    const arr = Array.isArray(list) ? list : [];
    out[docId] = arr.map((u) => ({
      name: u.name,
      size: u.size,
      type: u.type || "application/octet-stream",
      lastModified: u.lastModified,
    }));
  }
  return out;
}

function uploadsToDocumentsPayload(
  uploads: Record<string, UploadMeta[]>
): Record<string, UploadedDocMeta[] | null> {
  const out: Record<string, UploadedDocMeta[] | null> = {};
  for (const [docId, list] of Object.entries(uploads || {})) {
    const key = normalizeId(docId);
    if (!key) continue;

    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) {
      out[key] = null;
      continue;
    }

    out[key] = arr.map((u) => ({
      name: u.name,
      size: u.size,
      type: u.type,
      lastModified: u.lastModified,
    }));
  }
  return out;
}

/* ---------------- Page ---------------- */

export default function VendorEventRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const eventId = useMemo(() => normalizeId((params as any).eventId), [(params as any).eventId]);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // NOTE: This is what routes/pages pass around today (can be empty).
  // Support both ?appId= and legacy typo ?appld=
  const appIdFromUrl = useMemo(
    () => normalizeId(searchParams.get("appId") || searchParams.get("appld") || ""),
    [searchParams]
  );

  // We keep a local stable appId once created so we can persist.
  const [appId, setAppId] = useState<string>(appIdFromUrl);

  // ✅ Show approval/payment state: Pay happens AFTER approval.
  const [appStatus, setAppStatus] = useState<string>("draft");
  const [paymentStatus, setPaymentStatus] = useState<string>("unpaid");
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<LoadedRequirements | null>(null);
  const [error, setError] = useState("");

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [uploads, setUploads] = useState<Record<string, UploadMeta[]>>({});

  // If legacy uploads were stored under filename keys, migrate them to docId keys
  function migrateUploadsKeys(
    docs: DocumentRequirement[],
    current: Record<string, UploadMeta[]>
  ): Record<string, UploadMeta[]> {
    if (!docs || docs.length === 0) return current;

    const next: Record<string, UploadMeta[]> = { ...current };
    let changed = false;

    for (const d of docs) {
      const did = normalizeId((d as any).id || (d as any).name);
      if (!did) continue;

      // already correct
      if (next[did] && next[did].length > 0) continue;

      // Try to find a legacy key by matching file.name to doc name
      const targetName = String((d as any).name || "").trim();

      for (const k of Object.keys(next)) {
        if (k === did) continue;

        const list = next[k] || [];
        if (list.length === 0) continue;

        // Legacy pattern: key is filename or doc name; list holds UploadMeta with name=filename
        const hit = targetName && list.some((u) => String(u?.name || "") === targetName);
        if (hit) {
          next[did] = list;
          delete next[k];
          changed = true;
          break;
        }
      }
    }

    return changed ? next : current;
  }

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Prevent early autosaves from overwriting server docs on initial load
  const [hydrated, setHydrated] = useState(false);
  const [uploadsDirty, setUploadsDirty] = useState(false);

  const lastSavedSignatureRef = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);

  // Keep appId state in sync if URL changes (rare, but safe)
  useEffect(() => {
    setAppId(appIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdFromUrl]);

  // Fetch status/payment whenever appId is stable
  useEffect(() => {
    let alive = true;
    async function loadStatus() {
      if (!appId) return;
      try {
        setStatusErr(null);
        const serverApp = await vendorGetApplication({ applicationId: appId });
        if (!alive) return;
        setAppStatus(String((serverApp as any)?.status || "draft"));
        setPaymentStatus(String((serverApp as any)?.payment_status || "unpaid"));
      } catch (e: any) {
        if (!alive) return;
        setStatusErr(e?.message ? String(e.message) : "Failed to load application status.");
      }
    }
    loadStatus();
    return () => {
      alive = false;
    };
  }, [appId]);

  // Load requirements + ensure appId + restore progress
  useEffect(() => {
    let alive = true;

    async function ensureDraftApplicationIfNeeded(eid: string) {
      if (appIdFromUrl) return appIdFromUrl;

      // Create/get a draft application so progress can persist to backend
      const app = await vendorGetOrCreateDraftApplication({ eventId: eid });
      const createdId = normalizeId((app as any)?.id);

      if (!createdId) throw new Error("Could not create/get a draft application (missing id).");

      // Update state and URL (replace, no history spam)
      if (!alive) return createdId;

      setAppId(createdId);

      const qs = new URLSearchParams(location.search);
      qs.set("appId", createdId);
      navigate(`${location.pathname}?${qs.toString()}`, { replace: true });

      return createdId;
    }

    async function run() {
      setLoading(true);
      setError("");
      setRequirements(null);
      setSaveErr(null);

      if (!eventId) {
        if (!alive) return;
        setError("Missing eventId in route.");
        setLoading(false);
        return;
      }

      try {
        const stableAppId = await ensureDraftApplicationIfNeeded(eventId);
        if (!alive) return;

        const apiReq = await loadRequirementsFromApi(eventId);
        const lsReq = loadRequirementsFromLocalStorage(eventId);
        const finalReq = apiReq ?? lsReq;

        if (!alive) return;

        if (!finalReq) {
          setError("No requirements found for this event. (API returned nothing and localStorage fallback is empty.)");
          setLoading(false);
          return;
        }

        setRequirements(finalReq);

        const prog = loadVendorProgress(eventId, stableAppId || undefined);
        setChecked(migrateCheckedKeys(prog?.checked));
        setUploads(prog?.uploads || {});

        // Hydrate from server application (authoritative) so docs persist across reloads
        try {
          const serverApp = await vendorGetApplication({ applicationId: stableAppId });
          const serverDocs = (serverApp as any)?.documents ?? (serverApp as any)?.docs ?? null;
          const serverChecked = (serverApp as any)?.checked ?? null;

          if (serverChecked && typeof serverChecked === "object") {
            setChecked(migrateCheckedKeys(serverChecked as any));
          }

          if (serverDocs && typeof serverDocs === "object") {
            setUploads(serverDocumentsToUploads(serverDocs as any));
          }

          // capture status/payment if present
          setAppStatus(String((serverApp as any)?.status || "draft"));
          setPaymentStatus(String((serverApp as any)?.payment_status || "unpaid"));
        } catch {
          // ignore hydration failures; local progress still works
        } finally {
          // Mark initial hydration complete so debounced saves can run safely
          if (alive) {
            setHydrated(true);
            setUploadsDirty(false);
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to initialize requirements page.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [eventId, appIdFromUrl, location.pathname, location.search, navigate]);

  // Always persist to localStorage (UX cache)
  useEffect(() => {
    if (!eventId) return;
    if (!requirements) return;

    const progress: VendorReqProgress = {
      eventId,
      appId: appId || undefined,
      checked: migrateCheckedKeys(checked), // ✅ always store in new format
      uploads,
      updatedAt: new Date().toISOString(),
    };

    saveVendorProgress(progress);
  }, [eventId, appId, checked, uploads, requirements]);

  // Persist to backend (debounced) once we have a stable appId
  useEffect(() => {
    if (!eventId) return;
    if (!requirements) return;
    if (!appId) return;
    if (!hydrated) return;

    // Signature helps avoid redundant PUTs
    const signature = JSON.stringify({
      checked: migrateCheckedKeys(checked),
      uploads,
    });

    // No change vs last save attempt
    if (signature === lastSavedSignatureRef.current) return;

    // Debounce writes
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        setSaveErr(null);

        // NOTE: We store arrays of metadata (so multiple files per doc work),
        // backend can store arbitrary JSON.
        // IMPORTANT: only send documents/docs when the user actually changed uploads,
        // to avoid wiping server docs during initial hydration.
        const documentsPayload = uploadsDirty ? uploadsToDocumentsPayload(uploads) : undefined;

        await vendorSaveProgress({
          applicationId: appId,
          body: {
            checked: migrateCheckedKeys(checked),
            ...(documentsPayload ? { documents: documentsPayload as any, docs: documentsPayload as any } : {}),
          },
        });

        // After a successful upload save, we can treat uploads as clean
        if (uploadsDirty) setUploadsDirty(false);

        lastSavedSignatureRef.current = signature;
      } catch (e: any) {
        setSaveErr(e?.message || "Failed to save progress to server.");
      } finally {
        setSaving(false);
      }
    }, 450);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [eventId, requirements, appId, checked, uploads, hydrated, uploadsDirty]);

  const boothCategories = requirements?.boothCategories ?? [];
  const restrictions = requirements?.restrictions ?? [];
  const compliance = requirements?.compliance ?? [];
  const documents = requirements?.documents ?? [];

  // Keep upload keys aligned with document requirement IDs (prevents 2/4 regressions)
  useEffect(() => {
    if (!documents || documents.length === 0) return;
    setUploads((prev) => migrateUploadsKeys(documents, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  const fields = requirements?.fields ?? [];

  const complianceChecked = useMemo(() => {
    return compliance.reduce((acc, c) => {
      const cid = normalizeId(c.id || c.text);
      return acc + (checked[cid] ? 1 : 0);
    }, 0);
  }, [compliance, checked]);

  const docsUploaded = useMemo(() => {
    return documents.reduce((acc, d) => {
      const did = normalizeId(d.id || d.name);
      const list = uploads[did] || [];
      return acc + (list.length > 0 ? 1 : 0);
    }, 0);
  }, [documents, uploads]);

  const payment = useMemo(() => normalizePaymentSettings(requirements?.paymentSettings), [requirements]);

  function toggle(key: string) {
    const k = normalizeId(key);
    setChecked((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function addUploads(docId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const key = normalizeId(docId);

    const nextFiles: UploadMeta[] = Array.from(files).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
      lastModified: f.lastModified,
    }));

    setUploads((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      return { ...prev, [key]: [...existing, ...nextFiles] };
    });
    setUploadsDirty(true);
  }

  function removeUpload(docId: string, idx: number) {
    const key = normalizeId(docId);
    setUploads((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      const next = existing.filter((_, i) => i !== idx);
      return { ...prev, [key]: next };
    });
    setUploadsDirty(true);
  }

  function goBackToDashboard() {
    navigate("/vendor/dashboard");
  }

  function goBackToEvent() {
    navigate(`/vendor/events/${encodeURIComponent(eventId)}${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`);
  }

  function goToLayout() {
    navigate(`/vendor/events/${encodeURIComponent(eventId)}/map${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`);
  }

  function viewMyApplication() {
    if (!appId) return;
    navigate(`/vendor/applications?appId=${encodeURIComponent(appId)}&eventId=${encodeURIComponent(eventId)}`);
  }

  // Pay becomes available after organizer approval.
  // Payment is handled directly between vendor and organizer.
  // We simply surface organizer-provided instructions/links.
  function payNow() {
    const ps = normalizePaymentSettings(requirements?.paymentSettings);
    if (ps.paymentUrl) {
      window.open(ps.paymentUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (ps.billingEmail) {
      const subject = encodeURIComponent(`Payment for Event ${eventId} (Application ${appId || ""})`);
      const body = encodeURIComponent(
        `Hi,\n\nI was approved for Event ${eventId}.\n` +
          (ps.memo ? `Memo / reference: ${ps.memo}\n` : "") +
          `\nThanks!`
      );
      window.location.href = `mailto:${ps.billingEmail}?subject=${subject}&body=${body}`;
      return;
    }
    // No payment link or contact provided
    alert("Payment instructions have not been provided by the organizer yet.");
  }

  const sourceLabel = useMemo(() => {
    if (!requirements) return "—";
    if (requirements.source === "api") return requirements.sourceKey ? `API • ${requirements.sourceKey}` : "API";
    return requirements.sourceKey ? `localStorage • ${requirements.sourceKey}` : "localStorage";
  }, [requirements]);

  const isApproved = String(appStatus || "").toLowerCase() === "approved";
    const paymentInfo = useMemo(
    () => normalizePaymentSettings(requirements?.paymentSettings),
    [requirements?.paymentSettings]
  );

  const paymentSummary = useMemo(() => {
    if (!paymentInfo.has) return "";
    const bits: string[] = [];
    if (paymentInfo.depositType !== "none" && paymentInfo.depositValue !== null) {
      bits.push(
        paymentInfo.depositType === "percent"
          ? `Deposit: ${paymentInfo.depositValue}%`
          : `Deposit: $${paymentInfo.depositValue}`
      );
    }
    if (paymentInfo.dueBy) bits.push(`Due by: ${paymentInfo.dueBy}`);
    return bits.join(" • ");
  }, [paymentInfo]);

const isPaid = String(paymentStatus || "").toLowerCase() === "paid";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm text-slate-500">Vendor Portal</div>
            <h1 className="truncate text-2xl font-semibold text-slate-900">Event Requirements</h1>

            {requirements?.templateKey ? (
              <div className="mt-1 text-sm text-slate-600">
                Template: <span className="font-medium">{requirements.templateKey}</span>
              </div>
            ) : null}

            <div className="mt-1 text-xs text-slate-500">
              EventId: <span className="font-mono">{eventId || "—"}</span>
              {appId ? (
                <>
                  {" "}
                  • AppId: <span className="font-mono">{appId}</span>
                </>
              ) : null}{" "}
              • Source: {sourceLabel}
            </div>

            {/* Status / Payment banner */}
            {appId ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={[
                    "rounded-full border px-2 py-0.5 font-semibold",
                    isApproved
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                  title="Application status"
                >
                  Status: <span className="font-bold">{String(appStatus || "draft")}</span>
                </span>

                <span
                  className={[
                    "rounded-full border px-2 py-0.5 font-semibold",
                    isPaid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-900",
                  ].join(" ")}
                  title="Payment happens after approval"
                >
                  Payment: <span className="font-bold">{isPaid ? "Paid" : "Unpaid"}</span>
                </span>

                {statusErr ? <span className="text-rose-700">{statusErr}</span> : null}

                {!isPaid ? (
                  isApproved ? (
                    <button
                      type="button"
                      onClick={payNow}
                      className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1 text-xs font-bold text-white hover:opacity-95"
                    >
                      Pay now
                    </button>
                  ) : (
                    <span className="text-slate-600">
                      Payment becomes available after organizer approval.
                    </span>
                  )
                ) : null}
              </div>
            ) : null}

            {/* Save status */}
            {requirements ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full border px-2 py-0.5 font-semibold ${
                    saving
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : saveErr
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {saving ? "Saving…" : saveErr ? "Save failed" : "Saved"}
                </span>
                {saveErr ? <span className="text-rose-700">{saveErr}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={goBackToDashboard}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Back to Dashboard
            </button>

            <button
              type="button"
              onClick={goBackToEvent}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            >
              Back to Event
            </button>

            <button
              type="button"
              onClick={goToLayout}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Booth Map
            </button>

            {appId ? (
              <button
                type="button"
                onClick={viewMyApplication}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
              >
                View My Application
              </button>
            ) : null}
          </div>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
              <div className="text-sm text-slate-700">Loading requirements…</div>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-sm font-semibold text-rose-700">Couldn't load requirements</div>
              <div className="mt-1 text-sm text-rose-700">{error}</div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Retry
                </button>

                <button
                  type="button"
                  onClick={goBackToEvent}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Return to Event
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Progress Summary */}
              <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Your progress</div>
                    <div className="mt-1 text-sm text-slate-600">
                      You can prep everything here, but{" "}
                      <span className="font-semibold">submission happens on the Booth Map</span> (Option A).
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      Compliance: {complianceChecked}/{compliance.length}
                    </div>
                    <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      Docs uploaded: {docsUploaded}/{documents.length}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={goToLayout}
                    className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                  >
                    Continue to Booth Map
                  </button>

                  <button
                    type="button"
                    onClick={goBackToEvent}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    Review Event Details
                  </button>
                </div>
              </div>


              {/* Payment Instructions (after approval) */}
              {isApproved && paymentInfo.has ? (
                <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Payment instructions</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Payment is handled directly with the organizer. Use the info below.
                      </div>
                      {paymentSummary ? (
                        <div className="mt-1 text-xs font-semibold text-slate-700">{paymentSummary}</div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {paymentInfo.billingEmail ? (
                        <a
                          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                          href={`mailto:${paymentInfo.billingEmail}`}
                        >
                          Contact organizer
                        </a>
                      ) : null}

                      <button
                        type="button"
                        onClick={payNow}
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-2 text-xs font-bold text-white hover:opacity-95"
                      >
                        Pay organizer
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {paymentInfo.methods.length > 0 ? (
                      <div className="rounded-xl border border-slate-200 p-3">
                        <div className="text-xs font-semibold text-slate-900">Accepted methods</div>
                        <div className="mt-2 space-y-2">
                          {paymentInfo.methods.map((m) => (
                            <div key={m.key} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">{m.label}</div>
                                <div className="truncate text-xs text-slate-600">{m.contact}</div>
                              </div>
                              <button
                                type="button"
                                className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(m.contact);
                                  } catch {
                                    // ignore
                                  }
                                }}
                                title="Copy"
                              >
                                Copy
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-slate-200 p-3">
                      <div className="text-xs font-semibold text-slate-900">Notes</div>

                      {paymentInfo.paymentUrl ? (
                        <div className="mt-2 text-xs text-slate-700">
                          Payment link provided:{" "}
                          <a className="font-semibold text-indigo-700 hover:underline" href={paymentInfo.paymentUrl} target="_blank" rel="noreferrer">
                            Open payment link
                          </a>
                        </div>
                      ) : null}

                      {paymentInfo.memo ? (
                        <div className="mt-2">
                          <div className="text-xs font-semibold text-slate-700">Memo / reference</div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-xs text-slate-600">{paymentInfo.memo}</div>
                            <button
                              type="button"
                              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(paymentInfo.memo);
                                } catch {
                                  // ignore
                                }
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {paymentInfo.refundPolicy ? (
                        <div className="mt-2 text-xs text-slate-700">
                          <span className="font-semibold">Refund policy:</span> {paymentInfo.refundPolicy}
                        </div>
                      ) : null}

                      {paymentInfo.notes ? (
                        <div className="mt-2 text-xs text-slate-700">
                          <span className="font-semibold">Additional notes:</span> {paymentInfo.notes}
                        </div>
                      ) : null}

                      {!paymentInfo.paymentUrl && !paymentInfo.billingEmail && paymentInfo.methods.length === 0 && !paymentInfo.memo && !paymentInfo.refundPolicy && !paymentInfo.notes ? (
                        <div className="mt-2 text-xs text-slate-600">No payment details provided yet.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Booth Categories */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Booth Categories</div>
                    <div className="mt-1 text-sm text-slate-600">Pricing and sizes set by the organizer.</div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {boothCategories.length} categor{boothCategories.length === 1 ? "y" : "ies"}
                  </div>
                </div>

                {boothCategories.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No booth categories were provided for this event.
                  </div>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="bg-slate-50 text-slate-700">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Category</th>
                            <th className="px-4 py-3 font-semibold">Base Size</th>
                            <th className="px-4 py-3 font-semibold">Base Price</th>
                            <th className="px-4 py-3 font-semibold">Add’l / ft</th>
                            <th className="px-4 py-3 font-semibold">Corner</th>
                            <th className="px-4 py-3 font-semibold">Fire Marshal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {boothCategories.map((c) => {
                            const key = normalizeId(c.id || c.name);
                            return (
                              <tr key={key} className="bg-white">
                                <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                                <td className="px-4 py-3 text-slate-700">{c.baseSize || "—"}</td>
                                <td className="px-4 py-3 text-slate-700">{money(c.basePrice)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(c.additionalPerFt)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(c.cornerPremium)}</td>
                                <td className="px-4 py-3 text-slate-700">{money(c.fireMarshalFee)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Restrictions */}
              {restrictions.length > 0 ? (
                <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Restrictions</div>
                  <div className="mt-1 text-sm text-slate-600">Read-only (set by organizer)</div>

                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {restrictions.map((r, idx) => (
                      <li key={`${idx}-${r}`}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Payment Settings */}
              <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Payment Settings</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Deposit rules, late fees, and refund policy set by the organizer.
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    Read-only
                  </div>
                </div>

                {!payment.has ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No payment settings were provided for this event.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Deposit</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {payment.requireDeposit ? "Required" : "Not required"}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Deposit %</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {payment.depositPercent === null ? "—" : `${payment.depositPercent}%`}
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Late fee ($)</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {payment.lateFee === null ? "—" : `$${payment.lateFee}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Refund policy</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{payment.refundPolicy || "—"}</div>

                      {payment.paymentNotes ? (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment notes</div>
                          <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800">
                            {payment.paymentNotes}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              {/* Compliance */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Compliance Confirmations</div>
                    <div className="mt-1 text-sm text-slate-600">Check each item to confirm you meet the requirement.</div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {complianceChecked}/{compliance.length}
                  </div>
                </div>

                {compliance.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No compliance items were found for this event.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {compliance.map((c) => {
                      const cid = normalizeId(c.id || c.text);
                      const isChecked = Boolean(checked[cid]);

                      return (
                        <div key={cid} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={isChecked}
                            onChange={() => toggle(cid)}
                          />

                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{c.text}</div>
                              <Badge kind={c.required ? "Required" : "Optional"} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Document Uploads */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Document Uploads</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Upload documents now, or do it later—your progress is saved.
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {docsUploaded}/{documents.length}
                  </div>
                </div>

                {documents.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No document requirements were found for this event.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {documents.map((d) => {
                      const did = normalizeId(d.id || d.name);
                      const list = uploads[did] || [];

                      return (
                        <div key={did} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold text-slate-900">{d.name}</div>
                                <Badge kind={d.required ? "Required" : "Optional"} />
                                {d.dueBy ? <span className="text-xs text-slate-500">Due: {d.dueBy}</span> : null}
                              </div>
                            </div>

                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                              <input
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => {
                                  addUploads(did, e.target.files);
                                  e.currentTarget.value = "";
                                }}
                              />
                              Upload
                            </label>
                          </div>

                          {list.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {list.map((u, idx) => (
                                <div
                                  key={`${u.name}-${u.lastModified}-${idx}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-900">{u.name}</div>
                                    <div className="text-xs text-slate-500">
                                      {(u.size / 1024).toFixed(1)} KB • {u.type || "file"}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => removeUpload(did, idx)}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-slate-600">No files uploaded yet.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Field confirmations (optional) */}
              {fields.length > 0 ? (
                <div className="mb-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Application Field Checklist</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Optional confirmations for application fields (driven by organizer template).
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                      {fields.length} field{fields.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {fields.map((f) => {
                      const fid = normalizeId(f.id || f.label);
                      const key = `field:${fid}`; // keep fields namespaced
                      const isChecked = Boolean(checked[key]);

                      return (
                        <div key={fid} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={isChecked}
                            onChange={() => toggle(key)}
                          />

                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{f.label}</div>
                              <Badge kind={f.required ? "Required" : "Optional"} />
                            </div>

                            {f.description ? <div className="mt-1 text-sm text-slate-600">{f.description}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goBackToEvent}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Back to Event
                </button>

                <button
                  type="button"
                  onClick={goToLayout}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                >
                  Continue to Booth Map
                </button>

                {!isPaid ? (
                  <button
                    type="button"
                    onClick={payNow}
                    disabled={!isApproved}
                    className={[
                      "rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50",
                      "bg-gradient-to-r from-indigo-600 to-purple-600",
                    ].join(" ")}
                    title={isApproved ? "Proceed to payment" : "Payment is available after approval"}
                  >
                    Pay (after approval)
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
