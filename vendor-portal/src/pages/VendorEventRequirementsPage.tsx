// src/pages/VendorEventRequirementsPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  vendorGetOrCreateDraftApplication,
  vendorGetApplication,
  vendorSaveProgress,
  type UploadedDocMeta,
} from "../components/api/applications";
import { PaymentInstructionsCard } from "../components/PaymentInstructionsCard";

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

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

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

/** Robust eventId resolver:
 * - supports routes using :eventId OR :id OR other common names
 * - falls back to parsing /vendor/events/:id/requirements from pathname
 */
function resolveEventId(params: any, pathname: string): string {
  const direct =
    normalizeId(params?.eventId) ||
    normalizeId(params?.id) ||
    normalizeId(params?.eventID) ||
    normalizeId(params?.event_id) ||
    normalizeId(params?.event);

  if (direct) return direct;

  // pathname fallback: /vendor/events/3/requirements
  const parts = String(pathname || "")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .filter(Boolean);

  const idx = parts.findIndex((p) => p === "events");
  if (idx >= 0 && parts[idx + 1]) {
    return normalizeId(parts[idx + 1]);
  }

  return "";
}

/** Robust appId resolver:
 * - supports ?appId=, ?applicationId=, and legacy typo ?appld=
 */
function resolveAppId(search: string): string {
  const sp = new URLSearchParams(search || "");
  return normalizeId(sp.get("appId") || sp.get("applicationId") || sp.get("appld") || "");
}

/**
 * Payment settings can come in different shapes depending on old/new UI/API.
 * We normalize best-effort for display.
 */
function normalizePaymentSettings(ps?: any) {
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

  const billingEmail = String(
    obj.billing_contact_email ?? obj.billingContactEmail ?? obj.billingEmail ?? ""
  ).trim();
  const billingPhone = String(
    obj.billing_contact_phone ?? obj.billingContactPhone ?? obj.billingPhone ?? ""
  ).trim();

  const refundPolicy = String(obj.refund_policy ?? obj.refundPolicy ?? "").trim();
  const notes = String(obj.payment_notes ?? obj.paymentNotes ?? obj.notes ?? "").trim();

  // Legacy fallbacks
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

  const legacyNotes = String(obj.paymentNotes ?? obj.payment_notes ?? obj.notes ?? obj.note ?? "").trim();

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
  const candidates = [`${API_BASE}/events/${encodeURIComponent(eventId)}/requirements`];

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

  for (const k of Object.keys(src)) {
    if (k.startsWith("compliance:")) {
      const nk = k.replace("compliance:", "");
      if (nk && out[nk] == null) out[nk] = src[k];
      delete out[k];
    }
  }

  return out;
}

function loadVendorProgress(eventId: string, appId?: string | null): VendorReqProgress | null {
  const all = safeJsonParse<Record<string, VendorReqProgress>>(
    localStorage.getItem(LS_VENDOR_PROGRESS_KEY)
  );
  if (!all) return null;

  const key = `${normalizeId(eventId)}:${normalizeId(appId || "")}`;
  const found = all[key];
  if (!found) return null;

  if (normalizeId(found.eventId) !== normalizeId(eventId)) return null;
  if (normalizeId(found.appId || "") !== normalizeId(appId || "")) return null;

  return {
    eventId: normalizeId(found.eventId),
    appId: found.appId ? normalizeId(found.appId) : undefined,
    checked: migrateCheckedKeys(found.checked),
    uploads: found.uploads || {},
    updatedAt: found.updatedAt || new Date().toISOString(),
  };
}

function saveVendorProgress(eventId: string, appId: string | null | undefined, progress: VendorReqProgress) {
  const all =
    safeJsonParse<Record<string, VendorReqProgress>>(
      localStorage.getItem(LS_VENDOR_PROGRESS_KEY)
    ) || {};
  const key = `${normalizeId(eventId)}:${normalizeId(appId || "")}`;
  all[key] = progress;
  localStorage.setItem(LS_VENDOR_PROGRESS_KEY, JSON.stringify(all));
}

/* ---------------- Page ---------------- */

export default function VendorEventRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  // ✅ robust IDs
  const eventId = useMemo(
    () => resolveEventId(params as any, location.pathname),
    [params, location.pathname]
  );

  const appIdFromUrl = useMemo(() => resolveAppId(location.search), [location.search]);

  // ✅ normalize legacy query params (?appld= / ?applicationId=) to ?appId=
  useEffect(() => {
    const sp = new URLSearchParams(location.search || "");
    const legacy = sp.get("appld") || sp.get("applicationId");
    const hasAppId = !!sp.get("appId");

    if (legacy && !hasAppId) {
      sp.set("appId", legacy);
      sp.delete("appld");
      sp.delete("applicationId");
      navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // keep a stable appId once we have it
  const [appId, setAppId] = useState<string>(appIdFromUrl);

  useEffect(() => {
    if (appIdFromUrl && appIdFromUrl !== appId) setAppId(appIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdFromUrl]);

  const [appStatus, setAppStatus] = useState<string>("draft");
  const [paymentStatus, setPaymentStatus] = useState<string>("unpaid");
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState<LoadedRequirements | null>(null);
  const [error, setError] = useState("");

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [uploads, setUploads] = useState<Record<string, UploadMeta[]>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [saveErr, setSaveErr] = useState<string>("");

  const saveTimer = useRef<any>(null);

  // migrate uploads keys helper preserved from your file
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
      if (next[did] && next[did].length > 0) continue;

      const targetName = String((d as any).name || "").trim();
      for (const k of Object.keys(next)) {
        if (k === did) continue;
        const list = next[k] || [];
        if (list.length === 0) continue;

        const hit = targetName && list.some((u) => String(u?.name || "") === targetName);
        if (hit) {
          next[did] = list;
          delete next[k];
          changed = true;
          break;
        }
      }
    }

    if (changed) return next;
    return current;
  }

  const boothCategories = requirements?.boothCategories || [];
  const restrictions = requirements?.restrictions || [];
  const compliance = requirements?.compliance || [];
  const documents = requirements?.documents || [];
  const fields = requirements?.fields || [];

  /* ---------------- Load requirements ---------------- */

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError("");

      if (!eventId) {
        setLoading(false);
        setError("Missing event id. (Route must include /events/:id/...)");
        return;
      }

      const fromApi = await loadRequirementsFromApi(eventId);
      if (!alive) return;

      if (fromApi) {
        setRequirements(fromApi);
        setLoading(false);
        return;
      }

      const fromLs = loadRequirementsFromLocalStorage(eventId);
      if (fromLs) {
        setRequirements(fromLs);
        setLoading(false);
        return;
      }

      setRequirements(null);
      setLoading(false);
      setError("No requirements were found for this event.");
    }

    run();

    return () => {
      alive = false;
    };
  }, [eventId]);

  /* ---------------- Load vendor progress local ---------------- */

  useEffect(() => {
    if (!eventId) return;

    const prog = loadVendorProgress(eventId, appId);
    if (prog) {
      setChecked(prog.checked || {});
      setUploads(prog.uploads || {});
    } else {
      setChecked({});
      setUploads({});
    }
  }, [eventId, appId]);

  /* ---------------- Fetch status/payment ---------------- */

  useEffect(() => {
    let alive = true;

    async function run() {
      setStatusErr(null);

      // ✅ hard-guard: do NOT call backend with undefined ids
      if (!eventId || !appId) return;

      try {
        const serverApp = await vendorGetApplication(eventId, appId);
        if (!alive) return;

        setAppStatus(String((serverApp as any)?.status || "draft"));
        setPaymentStatus(String((serverApp as any)?.payment_status || "unpaid"));
      } catch (e: any) {
        if (!alive) return;
        setStatusErr(e?.message ? String(e.message) : "Failed to fetch application status.");
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [eventId, appId]);

  /* ---------------- Auto-save (best effort) ---------------- */

  useEffect(() => {
    if (!eventId) return;

    // Always persist to localStorage immediately
    const next: VendorReqProgress = {
      eventId: normalizeId(eventId),
      appId: appId || undefined,
      checked,
      uploads,
      updatedAt: new Date().toISOString(),
    };
    saveVendorProgress(eventId, appId, next);

    // If appId missing, don't attempt server save (prevents undefined-id errors)
    if (!appId) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!eventId || !appId) return;

      setSaving(true);
      setSaveErr("");

      try {
        await vendorGetOrCreateDraftApplication(eventId);

        const docsPayload: Record<string, UploadedDocMeta[]> = {};
        for (const docId of Object.keys(uploads || {})) {
          const list = uploads[docId] || [];
          docsPayload[docId] = list.map((m) => ({
            name: m.name,
            size: m.size,
            type: m.type,
            lastModified: m.lastModified,
          }));
        }

        const res = await vendorSaveProgress(eventId, {
          appId,
          checked,
          docs: docsPayload,
        });

        setAppStatus(String((res as any)?.status || appStatus || "draft"));
        setPaymentStatus(String((res as any)?.payment_status || paymentStatus || "unpaid"));

        setSaving(false);
      } catch (e: any) {
        setSaving(false);
        setSaveErr(e?.message ? String(e.message) : "Save failed.");
      }
    }, 700);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, uploads, eventId, appId]);

  /* ---------------- Derived ---------------- */

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

  useEffect(() => {
    if (!documents.length) return;
    setUploads((prev) => migrateUploadsKeys(documents, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.length]);

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
  }

  function removeUpload(docId: string, idx: number) {
    const key = normalizeId(docId);
    setUploads((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : [];
      const next = existing.filter((_, i) => i !== idx);
      return { ...prev, [key]: next };
    });
  }

  function goBackToDashboard() {
    navigate("/vendor/dashboard");
  }

  function goBackToEvent() {
    if (!eventId) return navigate("/vendor/dashboard");
    navigate(
      `/vendor/events/${encodeURIComponent(eventId)}${
        appId ? `?appId=${encodeURIComponent(appId)}` : ""
      }`
    );
  }

  function goToLayout() {
    if (!eventId) return;
    navigate(
      `/vendor/events/${encodeURIComponent(eventId)}/map${
        appId ? `?appId=${encodeURIComponent(appId)}` : ""
      }`
    );
  }

  function viewMyApplication() {
    if (!appId) return;
    navigate(
      `/vendor/applications?appId=${encodeURIComponent(appId)}&eventId=${encodeURIComponent(eventId)}`
    );
  }
  function openMessages(params?: { subject?: string; focus?: string }) {
    if (!eventId) return;

    const subject = params?.subject ? String(params.subject) : "";
    const focus = params?.focus ? String(params.focus) : "";

    // Best-effort organizer contact (MVP): use billingEmail if present.
    // (We can upgrade later to event.organizer_email once you expose it on the API.)
    const organizerEmail = (paymentInfo?.billingEmail || "").trim();

    const sp = new URLSearchParams();
    sp.set("eventId", String(eventId));
    if (appId) sp.set("appId", String(appId));
    if (organizerEmail) sp.set("organizer", organizerEmail);
    if (subject) sp.set("subject", subject);
    if (focus) sp.set("focus", focus);

    navigate(`/vendor/messages?${sp.toString()}`);
  }


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

    // Default: bring the payment card into view
    document.getElementById("payment-instructions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const sourceLabel = useMemo(() => {
    if (!requirements) return "—";
    if (requirements.source === "api")
      return requirements.sourceKey ? `API • ${requirements.sourceKey}` : "API";
    return requirements.sourceKey ? `localStorage • ${requirements.sourceKey}` : "localStorage";
  }, [requirements]);

  const isApproved = String(appStatus || "").toLowerCase() === "approved";
  const isPaid = String(paymentStatus || "").toLowerCase() === "paid";

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

  const canPayNow =
    isApproved &&
    !isPaid &&
    (Boolean(paymentInfo.paymentUrl) || Boolean(paymentInfo.billingEmail) || paymentInfo.methods.length > 0);

  /* ---------------- Render ---------------- */

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">Loading…</div>
            <div className="mt-2 text-sm text-slate-600">
              Fetching requirements for event <span className="font-mono">{eventId || "—"}</span>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <div className="text-sm font-semibold text-rose-800">Unable to load requirements</div>
            <div className="mt-2 text-sm text-rose-700">{error}</div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={goBackToDashboard}
                className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
              >
                Back to Dashboard
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!requirements) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No requirements found</div>
            <div className="mt-2 text-sm text-slate-600">
              Ask the organizer to publish requirements for this event.
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={goBackToDashboard}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              ) : (
                <>
                  {" "}
                  • <span className="font-semibold text-rose-700">Missing appId in URL (?appId=...)</span>
                </>
              )}{" "}
              • Source: {sourceLabel}
            </div>

            {/* Status / Payment banner */}
            {appId ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 font-semibold",
                    isApproved
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700"
                  )}
                  title="Application status"
                >
                  Status: <span className="font-bold">{String(appStatus || "draft")}</span>
                </span>

                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 font-semibold",
                    isPaid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  )}
                  title="Payment happens after approval"
                >
                  Payment: <span className="font-bold">{isPaid ? "Paid" : "Unpaid"}</span>
                </span>

                {statusErr ? <span className="text-rose-700">{statusErr}</span> : null}

                {!isPaid ? (
                  isApproved ? (
                    canPayNow ? (
                      <button
                        type="button"
                        onClick={payNow}
                        className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1 text-xs font-bold text-white hover:opacity-95"
                        title="Open organizer payment instructions"
                      >
                        Pay now
                      </button>
                    ) : (
                      <span className="text-slate-600">
                        Payment instructions have not been provided by the organizer yet.
                      </span>
                    )
                  ) : (
                    <span className="text-slate-600">Payment becomes available after organizer approval.</span>
                  )
                ) : null}

                <span
                  className={cx(
                    "rounded-full border px-2 py-0.5 font-semibold",
                    saving
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : saveErr
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  )}
                >
                  {saving ? "Saving…" : saveErr ? "Save failed" : "Saved"}
                </span>
                {saveErr ? <span className="text-rose-700">{saveErr}</span> : null}
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-600">
                This page needs <span className="font-mono">?appId=</span> in the URL to load your application state.
              </div>
            )}
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
          </div>
        </div>

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column */}
          <div className="lg:col-span-2">
            {/* Overview card */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

                <button
                  type="button"
                  onClick={viewMyApplication}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  View My Application
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openMessages({
                      subject: "Question about requirements / logistics",
                      focus: "requirements",
                    })
                  }
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Message organizer
                </button>
              </div>
            </div>

            {/* Payment Instructions (after approval) */}
            {isApproved ? (
              <div id="payment-instructions" className="mb-6">
                {paymentInfo.has ? (
                  <>
                    {/* Summary header (keeps your existing "paymentSummary" line) */}
                    <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Payment</div>
                          <div className="mt-1 text-sm text-slate-600">
                            Payment is handled directly with the organizer.
                          </div>
                          {paymentSummary ? (
                            <div className="mt-1 text-xs font-semibold text-slate-700">{paymentSummary}</div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              openMessages({
                                subject: "Payment / invoice question",
                                focus: "payment",
                              })
                            }
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                            title={
                              paymentInfo.billingEmail
                                ? `Message organizer (${paymentInfo.billingEmail})`
                                : "Message organizer (email not provided yet)"
                            }
                          >
                            Message organizer
                          </button>

                          {paymentInfo.billingEmail ? (
                            <a
                              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              href={`mailto:${paymentInfo.billingEmail}`}
                              onClick={(e) => e.stopPropagation()}
                              title="Open your email client"
                            >
                              Email organizer
                            </a>
                          ) : null}

                          {canPayNow ? (
                            <button
                              type="button"
                              onClick={payNow}
                              className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-2 text-xs font-bold text-white hover:opacity-95"
                            >
                              Pay organizer
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Main payment instructions card (fixes Copy + truncation) */}
                    <PaymentInstructionsCard
                      instructions={{
                        title: "Payment instructions",
                        subtitle: "Payment is handled directly with the organizer. Use the info below.",
                        paypal: paymentInfo.methods.find((m) => m.key === "paypal")?.contact || "",
                        zelle: paymentInfo.methods.find((m) => m.key === "zelle")?.contact || "",
                        memo:
                          paymentInfo.memo ||
                          "Include your company name and application ID in the memo/reference.",
                        refundPolicy: paymentInfo.refundPolicy || "",
                      }}
                      onPayOrganizer={() => {
                        // Prefer payment link if present, else just scroll the methods section into view.
                        if (paymentInfo.paymentUrl) {
                          window.open(paymentInfo.paymentUrl, "_blank", "noopener,noreferrer");
                          return;
                        }
                        document
                          .getElementById("payment-methods")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />

                    {paymentInfo.paymentUrl ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
                        Payment link provided:{" "}
                        <a
                          className="font-semibold text-indigo-700 hover:underline"
                          href={paymentInfo.paymentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open payment link
                        </a>
                      </div>
                    ) : null}

                    {/* If there are other methods beyond paypal/zelle, list them (still copy-safe inside card? we keep simple display) */}
                    {paymentInfo.methods.filter((m) => m.key !== "paypal" && m.key !== "zelle").length > 0 ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold text-slate-900">Other accepted methods</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {paymentInfo.methods
                            .filter((m) => m.key !== "paypal" && m.key !== "zelle")
                            .map((m) => (
                              <li key={m.key}>
                                <span className="font-semibold">{m.label}:</span>{" "}
                                <span className="break-words">{m.contact}</span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-semibold text-slate-900">Payment instructions</div>
                      <div className="text-sm text-slate-600">
                        Payment instructions have not been provided by the organizer yet.
                      </div>
                      <div className="text-xs text-slate-500">
                        Once the organizer adds a payment link, email, or accepted methods, you’ll be able to pay.
                      </div>
                    </div>
                  </div>
                )}
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

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {boothCategories.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs font-semibold text-slate-700">{c.baseSize || "—"}</div>
                    </div>

                    <div className="mt-2 text-sm text-slate-700">
                      Base: <span className="font-semibold">{money(c.basePrice)}</span>
                    </div>

                    {c.additionalPerFt != null ? (
                      <div className="mt-1 text-xs text-slate-600">
                        Additional / ft: <span className="font-semibold">{money(c.additionalPerFt)}</span>
                      </div>
                    ) : null}

                    {c.cornerPremium != null ? (
                      <div className="mt-1 text-xs text-slate-600">
                        Corner premium: <span className="font-semibold">{money(c.cornerPremium)}</span>
                      </div>
                    ) : null}

                    {c.fireMarshalFee != null ? (
                      <div className="mt-1 text-xs text-slate-600">
                        Fire marshal fee: <span className="font-semibold">{money(c.fireMarshalFee)}</span>
                      </div>
                    ) : null}

                    {c.electricalNote ? (
                      <div className="mt-2 text-xs text-slate-600">
                        <span className="font-semibold">Electrical:</span> {c.electricalNote}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Restrictions */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Restrictions</div>
              <div className="mt-1 text-sm text-slate-600">Organizer rules and limitations for vendors.</div>

              {restrictions.length > 0 ? (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {restrictions.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 text-sm text-slate-600">No restrictions provided.</div>
              )}
            </div>

            {/* Compliance */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Compliance</div>
              <div className="mt-1 text-sm text-slate-600">Mark each item when you’ve reviewed or prepared it.</div>

              {compliance.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {compliance.map((c) => {
                    const id = normalizeId(c.id || c.text);
                    const on = !!checked[id];
                    return (
                      <label
                        key={id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(id)}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{c.text}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            {c.required ? <Badge kind="Required" /> : <Badge kind="Optional" />}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600">No compliance items provided.</div>
              )}
            </div>

            {/* Documents */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Documents</div>
              <div className="mt-1 text-sm text-slate-600">
                Upload placeholders for required documents. (File storage will be added later.)
              </div>

              {documents.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {documents.map((d) => {
                    const id = normalizeId(d.id || d.name);
                    const list = uploads[id] || [];
                    return (
                      <div key={id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">{d.name}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                              {d.required ? <Badge kind="Required" /> : <Badge kind="Optional" />}
                              {d.dueBy ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold">
                                  Due by: {d.dueBy}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                            Add file
                            <input
                              type="file"
                              className="hidden"
                              multiple
                              onChange={(e) => addUploads(id, e.target.files)}
                            />
                          </label>
                        </div>

                        {list.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {list.map((m, i) => (
                              <div
                                key={`${m.name}:${m.lastModified}:${i}`}
                                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-slate-900">{m.name}</div>
                                  <div className="text-[11px] text-slate-600">
                                    {Math.round(m.size / 1024)} KB • {m.type || "file"}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                  onClick={() => removeUpload(id, i)}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-slate-600">No files added yet.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600">No documents required.</div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-1">
            {/* Fields */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Additional fields</div>
              <div className="mt-1 text-sm text-slate-600">These will be collected in a future update.</div>

              {fields.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {fields.map((f) => (
                    <div key={f.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{f.label}</div>
                          {f.description ? <div className="mt-1 text-xs text-slate-600">{f.description}</div> : null}
                        </div>
                        {f.required ? <Badge kind="Required" /> : <Badge kind="Optional" />}
                      </div>

                      <div className="mt-2 text-xs text-slate-600">
                        Type: <span className="font-semibold">{f.type || "text"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600">No extra fields.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
