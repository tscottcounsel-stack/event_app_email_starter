// src/pages/VendorDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "http://127.0.0.1:8002";

/* ---------------- Types ---------------- */

type VendorApplication = {
  id?: number;
  event_id?: number;

  booth_id?: string | null;

  app_ref?: string | null;
  notes?: string;

  checked?: Record<string, boolean>;
  status?: string; // submitted | approved | rejected | draft | etc

  payment_status?: string; // unpaid | pending | paid | expired
  payment_enabled?: boolean;
  payment_link?: string | null;

  notifications?: Array<{
    id?: string;
    type?: string;
    message?: string;
    created_at?: string;
    read?: boolean;
  }>;

  submitted_at?: string;
  updated_at?: string;

  // If your backend ever adds this, we will use it safely.
  booth_reserved_until?: string | null;
};

type DiagramDoc = {
  booths?: Array<{ id: string; label?: string }>;
  levels?: Array<{
    id: string;
    name?: string;
    booths: Array<{ id: string; label?: string }>;
  }>;
};

type EventGroup = {
  eventId: string;
  apps: VendorApplication[];
  activeApp: VendorApplication;
};

type EventSummary = {
  id?: number | string;
  title?: string;
  start_date?: string;
  end_date?: string;
  venue_name?: string;
  city?: string;
  state?: string;
  heroImageUrl?: string;
};


type VerificationRecord = {
  id?: number;
  email?: string;
  role?: string;
  status?: string;
  fee_amount?: number;
  fee_paid?: boolean;
  payment_status?: string;
  paid_at?: number | null;
  submitted_at?: number | null;
  business_name?: string;
  tax_id_masked?: string;
  notes?: string;
  documents?: Array<{ name?: string; type?: string; url?: string }>;
};

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

/* ---------------- Dates ---------------- */

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatShortDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(start?: string, end?: string) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;

  if (s && !Number.isNaN(s.getTime()) && e && !Number.isNaN(e.getTime())) {
    const sameYear = s.getFullYear() === e.getFullYear();
    const sameMonth = s.getMonth() === e.getMonth();

    const sFmt = s.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });

    const eFmt = e.toLocaleDateString(undefined, {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });

    return `${sFmt} – ${eFmt}`;
  }

  if (s && !Number.isNaN(s.getTime())) return formatShortDate(start);
  return "";
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/* ---------------- Status normalization ---------------- */

function normalizeStatus(s?: string) {
  const v = String(s || "").toLowerCase();
  if (v === "approved") return "approved";
  if (v === "rejected") return "rejected";
  if (v === "submitted") return "submitted";
  if (v === "draft") return "draft";
  return v || "submitted";
}

/* ---------------- Requirements completion ---------------- */

function calcCompletion(app: VendorApplication) {
  const checked = app.checked || {};
  const keys = Object.keys(checked);
  if (keys.length === 0) return { done: 0, total: 0, pct: 100 };
  const done = keys.filter((k) => !!checked[k]).length;
  const total = keys.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  return { done, total, pct };
}

function requirementsComplete(app: VendorApplication) {
  const c = calcCompletion(app);
  // If there are no keys we treat as complete (matches previous behavior).
  if (c.total === 0) return true;
  return c.done >= c.total;
}

/* ---------------- Booth display helpers ---------------- */

function shortBoothId(id?: string | null) {
  const s = String(id || "").trim();
  if (!s) return "";
  const tail = s.split("-").slice(-2).join("-");
  return tail.length > 18 ? tail.slice(-18) : tail;
}

/* ------------------------ Notification read storage ------------------------ */

const LS_VENDOR_NOTIF_READ_KEY = "vendor_notif_read_v1";

function safeJsonParse<T = any>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function loadNotifReadMap(): Record<string, boolean> {
  return (
    safeJsonParse<Record<string, boolean>>(
      localStorage.getItem(LS_VENDOR_NOTIF_READ_KEY)
    ) || {}
  );
}

function saveNotifReadMap(map: Record<string, boolean>) {
  localStorage.setItem(LS_VENDOR_NOTIF_READ_KEY, JSON.stringify(map || {}));
}

function notifIdFor(appId?: number, n?: any) {
  const raw = String(n?.id || "").trim();
  if (raw) return raw;
  const t = String(n?.type || "").trim() || "note";
  return `${t}:${String(appId ?? "")}`;
}

/* ----------------------------- Diagram helpers ---------------------------- */

function extractBoothLabelIndex(payload: any): Record<string, string> {
  const j = payload?.diagram ?? payload ?? {};
  const doc = j as DiagramDoc;
  const idx: Record<string, string> = {};

  if (Array.isArray(doc.levels) && doc.levels.length > 0) {
    for (const lvl of doc.levels) {
      for (const b of lvl.booths || []) {
        if (b?.id) idx[String(b.id)] = String(b.label || b.id);
      }
    }
  } else if (Array.isArray(doc.booths)) {
    for (const b of doc.booths) {
      if (b?.id) idx[String(b.id)] = String(b.label || b.id);
    }
  }
  return idx;
}

/* ----------------------------- Control center ----------------------------- */

function appSortKey(a: VendorApplication) {
  const t =
    new Date(a.updated_at || a.submitted_at || "").getTime() ||
    (a.id ? Number(a.id) : 0);
  return t || 0;
}

function pickActiveApp(apps: VendorApplication[]) {
  const sorted = apps
    .slice()
    .sort((x, y) => {
      const tx = appSortKey(x);
      const ty = appSortKey(y);
      if (ty !== tx) return ty - tx;
      return (Number(y.id || 0) || 0) - (Number(x.id || 0) || 0);
    });

  // Prefer non-rejected if there are multiple (keeps dashboard usable)
  const nonRejected = sorted.find((a) => normalizeStatus(a.status) !== "rejected");
  return nonRejected || sorted[0];
}

function isPaymentAvailable(app: VendorApplication) {
  if (typeof app.payment_enabled === "boolean") return app.payment_enabled;
  if (typeof app.payment_link === "string" && app.payment_link.trim()) return true;
  // fallback: assume available if approved (MVP)
  return true;
}

function isPaid(app: VendorApplication) {
  const ps = String(app.payment_status || "").toLowerCase();
  return ps === "paid";
}

function hasBoothSelected(app: VendorApplication) {
  const boothId = String(app.booth_id || "").trim();
  return !!boothId;
}

function msUntilHoldExpires(app: VendorApplication, nowMs: number) {
  const raw = String((app as any).booth_reserved_until || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return t - nowMs;
}

/* ------------------------------ UI helpers ------------------------------ */


function GoldVerifiedBadge(props: { large?: boolean; className?: string }) {
  const cls = props.large
    ? "px-4 py-2 text-sm"
    : "px-3 py-1.5 text-xs";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border-2 border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-200 font-black text-amber-900 shadow-[0_3px_10px_rgba(245,158,11,0.18)]",
        cls,
        props.className
      )}
    >
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white shadow-sm">
        ✓
      </span>
      Verified Vendor
    </span>
  );
}

function Badge(props: {
  tone: "emerald" | "rose" | "slate" | "amber" | "violet";
  children: any;
}) {
  const cls =
    props.tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : props.tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : props.tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : props.tone === "violet"
      ? "border-violet-200 bg-violet-50 text-violet-900"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={cx("rounded-full border px-3 py-1 text-xs font-extrabold", cls)}>
      {props.children}
    </span>
  );
}

function BtnClass(variant: "primary" | "secondary" | "outline" | "success") {
  const base =
    "rounded-full px-4 py-2 text-sm font-extrabold transition inline-flex items-center justify-center";
  if (variant === "primary") return cx(base, "bg-violet-600 text-white hover:bg-violet-700");
  if (variant === "secondary") return cx(base, "bg-slate-900 text-white hover:bg-slate-800");
  if (variant === "success") return cx(base, "bg-emerald-700 text-white hover:bg-emerald-800");
  return cx(base, "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50");
}

function HeroStat(props: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/15 p-4 backdrop-blur-md">
<div className="text-xs uppercase tracking-wide text-purple-200">
{props.label}</div>
      <div className="mt-1 text-4xl font-extrabold tracking-tight text-white">{props.value}</div>    </div>
  );
}

/* ------------------------------ Sections ------------------------------ */

type ActionKind =
  | "continue_application"
  | "complete_requirements"
  | "select_booth"
  | "pay_now";

type ActionItem = {
  kind: ActionKind;
  group: EventGroup;
  app: VendorApplication;
  event: EventSummary | undefined;
  boothLabel: string;
  holdMs: number | null;
};

function sectionTitle(kind: ActionKind) {
  switch (kind) {
    case "continue_application":
      return "Continue Application";
    case "complete_requirements":
      return "Complete Requirements";
    case "select_booth":
      return "Select Booth";
    case "pay_now":
      return "Pay Now";
    default:
      return "Action Needed";
  }
}

function sectionHint(kind: ActionKind) {
  switch (kind) {
    case "continue_application":
      return "Finish and submit your application.";
    case "complete_requirements":
      return "Upload any missing requirement documents.";
    case "select_booth":
      return "Choose a booth to reserve your spot.";
    case "pay_now":
      return "Complete payment to confirm your reservation.";
    default:
      return "";
  }
}

function actionCtaLabel(kind: ActionKind) {
  switch (kind) {
    case "continue_application":
      return "Continue Application";
    case "complete_requirements":
      return "Complete Requirements";
    case "select_booth":
      return "Select Booth";
    case "pay_now":
      return "Pay Now";
    default:
      return "Continue";
  }
}

export default function VendorDashboard() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [apps, setApps] = useState<VendorApplication[]>([]);
  const [verification, setVerification] = useState<VerificationRecord | null>(null);

  const [notifRead, setNotifRead] = useState<Record<string, boolean>>(() =>
    loadNotifReadMap()
  );

  // Live refresh for hold timers / payment windows
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // eventId -> (boothId -> label)
  const [boothLabelsByEvent, setBoothLabelsByEvent] = useState<
    Record<string, Record<string, string>>
  >({});

  // eventId -> event summary
  const [eventsById, setEventsById] = useState<Record<string, EventSummary>>({});

  function markNotificationRead(nid: string) {
    setNotifRead((prev) => {
      const next = { ...(prev || {}), [nid]: true };
      saveNotifReadMap(next);
      return next;
    });
  }

  async function loadVerification() {
    try {
      const res = await fetch(`${API_BASE}/verification/me`, {
        headers: buildAuthHeaders(),
      });

      if (!res.ok) {
        setVerification(null);
        return;
      }

      const data = await res.json().catch(() => null);
      const record = (data?.verification || data || null) as VerificationRecord | null;
      setVerification(record);
    } catch {
      setVerification(null);
    }
  }

  async function loadApps() {
    setLoading(true);
    setErr(null);

    try {
      const headers = buildAuthHeaders();
      const hasIdentity =
        !!headers.Authorization ||
        !!(headers as any)["x-user-email"] ||
        !!(headers as any)["x-user-id"];

      if (!hasIdentity) {
        setApps([]);
        setErr("Missing login identity. Please log in again.");
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/vendor/applications`, {
        headers: buildAuthHeaders(),
      });

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let msg = text || `Failed to load applications (${res.status})`;
        try {
          const j = JSON.parse(text);
          msg = j?.detail || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const data = JSON.parse(text || "{}");
      const list = Array.isArray(data?.applications) ? data.applications : [];
      setApps(list);
    } catch (e: any) {
      setApps([]);
      setErr(e?.message || "Failed to load applications.");
    } finally {
      setLoading(false);
    }
  }

async function handlePayNow(appId: number) {
  try {
    console.log("handlePayNow start", appId);

    const res = await fetch(`${API_BASE}/vendor/applications/${appId}/pay-now`, {
      method: "POST",
      headers: buildAuthHeaders(),
    });

    console.log("pay-now status", res.status);

    const data = await res.json().catch(() => null);
    console.log("pay-now data", data);

    if (!res.ok) {
      throw new Error(data?.detail || `Payment failed (${res.status})`);
    }

    if (data?.url) {
      console.log("redirecting to", data.url);
      window.location.href = data.url;
      return;
    }

    throw new Error(data?.detail || "No checkout URL returned.");
  } catch (err: any) {
    console.error("handlePayNow error", err);
    alert(err?.message || "Unable to start payment.");
  }
}

  async function loadBoothLabelsForEvents(eventIds: string[]) {
    const unique = Array.from(new Set(eventIds.filter(Boolean)));
    if (unique.length === 0) return;

    const missing = unique.filter((eid) => !boothLabelsByEvent[String(eid)]);
    if (missing.length === 0) return;

    const updates: Record<string, Record<string, string>> = {};

    await Promise.all(
      missing.map(async (eid) => {
        try {
          const url = `${API_BASE}/events/${encodeURIComponent(eid)}/diagram`;
          const res = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          if (!res.ok) {
            updates[eid] = {};
            return;
          }
          const j = await res.json().catch(() => null);
          updates[eid] = extractBoothLabelIndex(j || {});
        } catch {
          updates[eid] = {};
        }
      })
    );

    setBoothLabelsByEvent((prev) => ({ ...prev, ...updates }));
  }

  async function loadEventInfo(eventIds: string[]) {
    const unique = Array.from(new Set(eventIds.filter(Boolean)));
    if (unique.length === 0) return;

    const missing = unique.filter((eid) => !eventsById[String(eid)]);
    if (missing.length === 0) return;

    const updates: Record<string, EventSummary> = {};

    await Promise.all(
      missing.map(async (eid) => {
        try {
          // Best-guess endpoint: /events/:id (public). If your API differs, this still fails safely.
          const url = `${API_BASE}/events/${encodeURIComponent(eid)}`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) return;

          const data = await res.json().catch(() => null);
          if (!data) return;

          const ev = (data as any)?.event ?? data;

          updates[eid] = {
            id: ev?.id ?? eid,
            title: ev?.title,
            start_date: ev?.start_date,
            end_date: ev?.end_date,
            venue_name: ev?.venue_name,
            city: ev?.city,
            state: ev?.state,
            heroImageUrl: ev?.heroImageUrl,
          };
        } catch {
          // ignore
        }
      })
    );

    if (Object.keys(updates).length > 0) {
      setEventsById((prev) => ({ ...prev, ...updates }));
    }
  }

  useEffect(() => {
    loadApps();
    loadVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ids = apps.map((a) => String(a.event_id || "")).filter(Boolean);
    loadBoothLabelsForEvents(ids);
    loadEventInfo(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length]);

  // Group apps by event and pick active one per event
  const groups: EventGroup[] = useMemo(() => {
    const byEvent: Record<string, VendorApplication[]> = {};
    for (const a of apps || []) {
      const eid = String(a.event_id || "");
      if (!eid) continue;
      if (!byEvent[eid]) byEvent[eid] = [];
      byEvent[eid].push(a);
    }

    const out: EventGroup[] = Object.keys(byEvent).map((eventId) => {
      const arr = byEvent[eventId];
      const active = pickActiveApp(arr);
      return { eventId, apps: arr, activeApp: active };
    });

    out.sort((g1, g2) => appSortKey(g2.activeApp) - appSortKey(g1.activeApp));
    return out;
  }, [apps]);

  // Approval notifications: use notifications from ACTIVE app per event (avoids duplicates)
  const unreadApproved = useMemo(() => {
    const out: Array<{ group: EventGroup; notif: any; nid: string }> = [];
    for (const g of groups) {
      const a = g.activeApp;
      const ns = Array.isArray((a as any)?.notifications) ? (a as any).notifications : [];
      for (const n of ns) {
        const type = String(n?.type || "").toLowerCase();
        if (type !== "approved") continue;
        const nid = notifIdFor(a.id, n);
        const alreadyRead = !!notifRead[nid] || !!n?.read;
        if (!alreadyRead) out.push({ group: g, notif: n, nid });
      }
    }

    out.sort((x, y) => {
      const ax = new Date(String(x.notif?.created_at || "")).getTime() || 0;
      const ay = new Date(String(y.notif?.created_at || "")).getTime() || 0;
      return ay - ax;
    });

    return out;
  }, [groups, notifRead]);

  const stats = useMemo(() => {
    const active = groups.length;
    const approved = groups.filter((g) => normalizeStatus(g.activeApp.status) === "approved").length;
    const pendingPay = groups.filter((g) => {
      const a = g.activeApp;
      return (
        normalizeStatus(a.status) === "approved" &&
        hasBoothSelected(a) &&
        isPaymentAvailable(a) &&
        !isPaid(a)
      );
    }).length;
    const drafts = groups.filter((g) => normalizeStatus(g.activeApp.status) === "draft").length;
    return { active, approved, pendingPay, drafts };
  }, [groups]);

  // Build control-center sections (Action Needed, Reserved, Paid)
  const controlCenter = useMemo(() => {
    const actionNeeded: ActionItem[] = [];
    const reserved: ActionItem[] = [];
    const paid: ActionItem[] = [];

    for (const g of groups) {
      const a = g.activeApp;
      const status = normalizeStatus(a.status);

      const eid = String(g.eventId || "");
      const ev = eventsById[eid];

      const boothId = String(a.booth_id || "").trim();
      const boothLabel =
        eid && boothId ? boothLabelsByEvent[eid]?.[boothId] || boothId : "";

      const holdMs = msUntilHoldExpires(a, nowMs);

      const reqComplete = requirementsComplete(a);
      const boothSelected = hasBoothSelected(a);
      const paymentAvail = isPaymentAvailable(a);
      const paidFlag = isPaid(a);

      // Paid / Confirmed
      if (status === "approved" && paidFlag) {
        paid.push({
          kind: "pay_now",
          group: g,
          app: a,
          event: ev,
          boothLabel,
          holdMs,
        });
        continue;
      }

      // Approved + booth selected + not paid -> Reserved / Awaiting payment
      if (status === "approved" && boothSelected && paymentAvail && !paidFlag) {
        reserved.push({
          kind: "pay_now",
          group: g,
          app: a,
          event: ev,
          boothLabel,
          holdMs,
        });
        continue;
      }

      // Action Needed
      if (status === "draft") {
        actionNeeded.push({
          kind: "continue_application",
          group: g,
          app: a,
          event: ev,
          boothLabel,
          holdMs,
        });
        continue;
      }

      if (status !== "approved" && status !== "rejected" && !reqComplete) {
        actionNeeded.push({
          kind: "complete_requirements",
          group: g,
          app: a,
          event: ev,
          boothLabel,
          holdMs,
        });
        continue;
      }

      if (status === "approved" && !boothSelected) {
        actionNeeded.push({
          kind: "select_booth",
          group: g,
          app: a,
          event: ev,
          boothLabel,
          holdMs,
        });
        continue;
      }

      actionNeeded.push({
        kind:
          status === "approved"
            ? "select_booth"
            : status === "rejected"
            ? "continue_application"
            : "complete_requirements",
        group: g,
        app: a,
        event: ev,
        boothLabel,
        holdMs,
      });
    }

    actionNeeded.sort((x, y) => appSortKey(y.app) - appSortKey(x.app));
    reserved.sort((x, y) => appSortKey(y.app) - appSortKey(x.app));
    paid.sort((x, y) => appSortKey(y.app) - appSortKey(x.app));

    return { actionNeeded, reserved, paid };
  }, [groups, eventsById, boothLabelsByEvent, nowMs]);

  const verificationStatus = String(
    verification?.status || ""
  ).trim().toLowerCase();
  const isVendorVerified =
    verificationStatus === "verified" || verificationStatus === "approved";
  const isVendorPending = verificationStatus === "pending";
  const isVendorRejected = verificationStatus === "rejected";


function resolveNumericApplicationId(value: any): string {
  const candidates = [
    value?.id,
    value?.application?.id,
    value?.applicationId,
    value?.appId,
    value,
  ];

  for (const candidate of candidates) {
    const s = String(candidate ?? "").trim();
    if (!s) continue;
    if (s === "[object Object]" || s === "undefined" || s === "null") continue;
    if (/^\d+$/.test(s)) return s;
  }

  return "";
}
 function goToAction(kind: ActionKind, eid: string, appId?: number) {
  const resolvedAppId = resolveNumericApplicationId(appId);
  const safeEid = encodeURIComponent(String(eid || ""));

  if (kind === "continue_application") {
    const qs = resolvedAppId ? `?appId=${encodeURIComponent(resolvedAppId)}` : "";
    nav(`/vendor/events/${safeEid}${qs}`);
    return;
  }

  if (kind === "complete_requirements") {
    const qs = resolvedAppId ? `?appId=${encodeURIComponent(resolvedAppId)}` : "";
    nav(`/vendor/events/${safeEid}/requirements${qs}`);
    return;
  }

  if (kind === "choose_booth") {
    const qs = resolvedAppId ? `?appId=${encodeURIComponent(resolvedAppId)}` : "";
    nav(`/vendor/events/${safeEid}/map${qs}`);
    return;
  }

  if (kind === "complete_payment") {
    const qs = resolvedAppId ? `?appId=${encodeURIComponent(resolvedAppId)}` : "";
    nav(`/vendor/events/${safeEid}/payment${qs}`);
    return;
  }
}

  function EventMiniCard(props: {
    item: ActionItem;
    showHold?: boolean;
    showStatusLine?: boolean;
    ctaKind: ActionKind;
    ctaVariant?: "primary" | "secondary" | "outline" | "success";
    footerSlot?: React.ReactNode;
  }) {
    const { item } = props;
    const eid = String(item.group.eventId || "");
    const a = item.app;
    const ev = item.event;

    const title = ev?.title || `Event #${eid}`;
    const range = formatDateRange(ev?.start_date, ev?.end_date);

    const locationLine =
      ev?.venue_name || ev?.city || ev?.state
        ? [ev?.venue_name, [ev?.city, ev?.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" • ")
        : "";

    const status = normalizeStatus(a.status);
    const completion = calcCompletion(a);

    const boothSelected = hasBoothSelected(a);
    const paymentAvail = isPaymentAvailable(a);
    const paidFlag = isPaid(a);
    const awaitingPayment = status === "approved" && boothSelected && paymentAvail && !paidFlag;

    const holdMs = item.holdMs;
    const holdLine =
      props.showHold && holdMs !== null
        ? holdMs > 0
          ? `Hold expires in: ${formatDuration(holdMs)}`
          : "Hold expired"
        : null;

    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">{title}</div>

            {(range || locationLine) ? (
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {range ? range : ""}
                {range && locationLine ? " • " : ""}
                {locationLine ? locationLine : ""}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isVendorVerified ? <GoldVerifiedBadge /> : null}
              {isVendorPending ? <Badge tone="amber">VERIFICATION PENDING</Badge> : null}
              {isVendorRejected ? <Badge tone="rose">VERIFICATION NEEDS ATTENTION</Badge> : null}
              <Badge tone="slate">
                Booth: {item.boothLabel ? shortBoothId(item.boothLabel) : "—"}
              </Badge>

              {props.showStatusLine ? (
                <>
                  <Badge
                    tone={
                      status === "approved"
                        ? "emerald"
                        : status === "rejected"
                        ? "rose"
                        : status === "draft"
                        ? "slate"
                        : "amber"
                    }
                  >
                    {status.toUpperCase()}
                  </Badge>

                  {awaitingPayment ? <Badge tone="rose">AWAITING PAYMENT</Badge> : null}

                  <Badge tone="slate">Progress: {completion.pct}%</Badge>
                </>
              ) : null}

              {holdLine ? <Badge tone="amber">{holdLine}</Badge> : null}
            </div>

            <div className="mt-2 text-xs font-semibold text-slate-600">
              Updated: {formatDate(a.updated_at || a.submitted_at)}
            </div>

            {props.footerSlot ? <div className="mt-3">{props.footerSlot}</div> : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => goToAction(props.ctaKind, eid, a.id)}
              className={BtnClass(props.ctaVariant || "primary")}
            >
              {actionCtaLabel(props.ctaKind)}
            </button>

            {(() => {
              const safeLinkAppId = resolveNumericApplicationId(a.id);
              const viewQs = safeLinkAppId ? `?appId=${encodeURIComponent(safeLinkAppId)}` : "";

              return (
                <Link
                  to={`/vendor/events/${encodeURIComponent(eid)}${viewQs}`}
                  className={BtnClass("outline")}
                >
                  View event
                </Link>
              );
            })()}
          </div>
        </div>

        <div className="mt-4">
          {a.notes ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              {a.notes}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <section className="w-full bg-gradient-to-r from-purple-900 via-purple-800 to-indigo-900">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="text-white">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-extrabold text-white">
                  VendorConnect • Vendor Portal
                </div>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-white">
                  Vendor Dashboard
                </h1>
                <p className="mt-2 text-sm font-semibold text-purple-100">
                  Your control center — what to do next, per event.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {isVendorVerified ? (
                    <GoldVerifiedBadge
                      large
                      className="border-amber-300/60 from-amber-100 via-yellow-50 to-amber-200 text-amber-950"
                    />
                  ) : null}
                  {isVendorPending ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-2 text-sm font-extrabold text-amber-50">
                      Verification Pending Review
                    </span>
                  ) : null}
                  {isVendorRejected ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-rose-300/40 bg-rose-400/15 px-4 py-2 text-sm font-extrabold text-rose-50">
                      Verification Needs Attention
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => nav("/vendor/events")}
                  className={cx(
                    BtnClass("outline"),
                    "border-white/30 bg-white/10 text-white hover:bg-white/15"
                  )}
                >
                  Browse Events
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadApps();
                    loadVerification();
                  }}
                  className={cx(
                    BtnClass("outline"),
                    "border-white/30 bg-white/10 text-white hover:bg-white/15"
                  )}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-6 h-px w-full bg-white/20" />

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <HeroStat label="Active Events" value={stats.active} />
              <HeroStat label="Approved" value={stats.approved} />
              <HeroStat label="Awaiting Payment" value={stats.pendingPay} />
              <HeroStat label="Drafts" value={stats.drafts} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 pb-10">
        {/* Notifications (Approval) */}
        {unreadApproved.length > 0 ? (
          <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-extrabold text-emerald-900">
                  You&apos;re approved 🎉
                </div>
                <div className="mt-1 text-sm font-semibold text-emerald-800">
                  {unreadApproved.length === 1
                    ? "One event was approved. Choose a booth and complete payment."
                    : `${unreadApproved.length} events were approved. Choose booths and complete payment.`}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const top = unreadApproved[0];
                    const a = top?.group?.activeApp;
                    const eid = top?.group?.eventId;
                    if (!eid || !a?.id) return;

                    markNotificationRead(top.nid);

                    nav(
                      `/vendor/events/${encodeURIComponent(eid)}/map?appId=${encodeURIComponent(
                        String(a.id)
                      )}`
                    );
                  }}
                  className={BtnClass("success")}
                >
                  Continue
                </button>

                <button
                  type="button"
                  onClick={() => {
                    for (const row of unreadApproved) markNotificationRead(row.nid);
                  }}
                  className={BtnClass("outline")}
                >
                  Mark all read
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {unreadApproved.slice(0, 3).map((row) => {
                const a = row.group.activeApp;
                const eid = String(row.group.eventId || "");
                const ev = eventsById[eid];
                const title = ev?.title || `Event #${eid}`;
                const range = formatDateRange(ev?.start_date, ev?.end_date);

                return (
                  <div
                    key={row.nid}
                    className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-slate-900">
                        {title} • Application #{a.id}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-600">
                        {range ? `${range} • ` : ""}
                        {row.notif?.message ||
                          "Approved. Choose a booth and complete payment to lock in your spot."}
                        {row.notif?.created_at ? ` • ${formatDate(row.notif.created_at)}` : ""}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          markNotificationRead(row.nid);
                          nav(
                            `/vendor/events/${encodeURIComponent(
                              String(row.group.eventId)
                            )}/map?appId=${encodeURIComponent(String(a.id || ""))}`
                          );
                        }}
                        className={BtnClass("success")}
                      >
                        Booth Map
                      </button>
                      <button
                        type="button"
                        onClick={() => markNotificationRead(row.nid)}
                        className={BtnClass("outline")}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}

              {unreadApproved.length > 3 ? (
                <div className="text-xs font-semibold text-emerald-900">
                  + {unreadApproved.length - 3} more…
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isVendorVerified ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <GoldVerifiedBadge large />
                  <div className="text-lg font-black text-amber-950">You&apos;re verified</div>
                </div>
                <div className="mt-2 text-sm font-semibold text-amber-900">
                  Organizers can now see your verified vendor status across your dashboard and applications.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs font-extrabold text-amber-900">
                  Priority trust signal
                </span>
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs font-extrabold text-amber-900">
                  Premium vendor badge
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {isVendorPending ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <div className="text-lg font-black text-amber-900">Verification pending</div>
            <div className="mt-1 text-sm font-semibold text-amber-800">
              Your documents are under review. Your badge will appear automatically once approved.
            </div>
          </div>
        ) : null}

        {isVendorRejected ? (
          <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <div className="text-lg font-black text-rose-900">Verification needs attention</div>
            <div className="mt-1 text-sm font-semibold text-rose-800">
              Your last verification attempt was rejected. Update your documents and resubmit to restore the badge.
            </div>
          </div>
        ) : null}

        {/* Status banner */}
        <div className="mt-6">
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
              Loading applications…
            </div>
          ) : err ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 shadow-sm">
              {err}
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
              {groups.length === 1 ? "1 event found." : `${groups.length} events found.`}
              <span className="ml-2 text-xs font-bold text-slate-500">
                (Grouped by event — duplicates hidden)
              </span>
              {isVendorVerified ? <span className="ml-3"><GoldVerifiedBadge /></span> : null}
            </div>
          )}
        </div>

        {/* =========================
            CONTROL CENTER SECTIONS
           ========================= */}

        {/* Section 1: Action Needed */}
        <div className="mt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xl font-black text-slate-900">⚠️ Action Needed</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                Events where you have a next step to keep things moving.
              </div>
            </div>
            <div className="text-xs font-semibold text-slate-500">
              {controlCenter.actionNeeded.length} item
              {controlCenter.actionNeeded.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            {controlCenter.actionNeeded.map((item) => {
              const eid = String(item.group.eventId || "");
              const a = item.app;
              const status = normalizeStatus(a.status);

              const boothSelected = hasBoothSelected(a);
              const paidFlag = isPaid(a);
              const paymentAvail = isPaymentAvailable(a);

              let ctaKind: ActionKind = item.kind;
              if (status === "approved" && boothSelected && paymentAvail && !paidFlag) ctaKind = "pay_now";
              else if (status === "approved" && !boothSelected) ctaKind = "select_booth";
              else if (status === "draft") ctaKind = "continue_application";
              else if (!requirementsComplete(a)) ctaKind = "complete_requirements";

              return (
                <EventMiniCard
                  key={`action_${eid}_${a.id || ""}`}
                  item={item}
                  showHold={ctaKind === "pay_now"}
                  showStatusLine={true}
                  ctaKind={ctaKind}
                  ctaVariant={ctaKind === "pay_now" ? "success" : ctaKind === "select_booth" ? "primary" : "secondary"}
                  footerSlot={
                    <div className="text-sm font-semibold text-slate-700">
                      <span className="font-black">{sectionTitle(ctaKind)}:</span>{" "}
                      {sectionHint(ctaKind)}
                    </div>
                  }
                />
              );
            })}

            {(!loading && !err && controlCenter.actionNeeded.length === 0) ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
                No action needed right now. 🎉
              </div>
            ) : null}
          </div>
        </div>

        {/* Section 2: Approved / Booth Reserved (Awaiting Payment) */}
        <div className="mt-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xl font-black text-slate-900">✅ Approved / Booth Reserved</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                You&apos;re approved and your booth is selected — payment is required to confirm.
              </div>
            </div>
            <div className="text-xs font-semibold text-slate-500">
              {controlCenter.reserved.length} item{controlCenter.reserved.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            {controlCenter.reserved.map((item) => {
              const eid = String(item.group.eventId || "");
              const a = item.app;
              const holdMs = item.holdMs;

              return (
                <div key={`reserved_${eid}_${a.id || ""}`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-lg font-black text-slate-900">
                        {item.event?.title || `Event #${eid}`}
                      </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
  <Badge tone="emerald">APPROVED</Badge>

  <Badge tone="slate">
    Booth: {item.boothLabel ? shortBoothId(item.boothLabel) : "--"}
  </Badge>

  {item.payment_status === "paid" ? (
  <Badge tone="emerald">Paid</Badge>
) : (
  <Badge tone="rose">Status: Awaiting payment</Badge>
)}

  {holdMs !== null ? (
    <Badge tone="amber">
      {holdMs > 0 ? `Hold expires in: ${formatDuration(holdMs)}` : "Hold expired"}
    </Badge>
  ) : null}
</div>

                      <div className="mt-3 text-xs font-semibold text-slate-600">
                        Updated: {formatDate(a.updated_at || a.submitted_at)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
  onClick={() => handlePayNow(a.id)}
  className="rounded-full bg-green-600 px-5 py-2 text-sm font-extrabold text-white shadow-md hover:bg-green-700"
>
  Pay Booth Fee
</button>

                      <Link
                        to={`/vendor/events/${encodeURIComponent(eid)}/map?appId=${encodeURIComponent(
                          String(a.id || "")
                        )}`}
                        className={cx(
                          BtnClass("outline"),
                          "border-violet-200 text-violet-900 hover:bg-violet-50"
                        )}
                      >
                        View Floorplan
                      </Link>
                    </div>
                  </div>

                  {a.notes ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                      {a.notes}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {(!loading && !err && controlCenter.reserved.length === 0) ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
                No reserved booths awaiting payment.
              </div>
            ) : null}
          </div>
        </div>

        {/* Section 3: Confirmed / Paid */}
        <div className="mt-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xl font-black text-slate-900">🎟 Confirmed / Paid</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                You&apos;re confirmed — view the floorplan anytime.
              </div>
            </div>
            <div className="text-xs font-semibold text-slate-500">
              {controlCenter.paid.length} item{controlCenter.paid.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            {controlCenter.paid.map((item) => {
              const eid = String(item.group.eventId || "");
              const a = item.app;

              return (
                <div key={`paid_${eid}_${a.id || ""}`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-lg font-black text-slate-900">
                        {item.event?.title || `Event #${eid}`}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone="emerald">Status: Confirmed</Badge>
                        <Badge tone="slate">Booth: {item.boothLabel ? shortBoothId(item.boothLabel) : "—"}</Badge>
                        <Badge tone="emerald">Payment: Paid</Badge>
                        <Badge tone="violet">Booth locked</Badge>
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-600">
                        Updated: {formatDate(a.updated_at || a.submitted_at)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/vendor/events/${encodeURIComponent(eid)}/map?appId=${encodeURIComponent(
                          String(a.id || "")
                        )}`}
                        className={cx(
                          BtnClass("outline"),
                          "border-violet-200 text-violet-900 hover:bg-violet-50"
                        )}
                      >
                        View Floorplan
                      </Link>

                      <Link
                        to={`/vendor/events/${encodeURIComponent(eid)}?appId=${encodeURIComponent(
                          String(a.id || "")
                        )}`}
                        className={BtnClass("outline")}
                      >
                        View event
                      </Link>
                    </div>
                  </div>

                  {a.notes ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                      {a.notes}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {(!loading && !err && controlCenter.paid.length === 0) ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
                No paid / confirmed events yet.
              </div>
            ) : null}
          </div>
        </div>

        {/* Legacy empty state */}
        {!loading && !err && groups.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
            No applications yet. Click <span className="font-extrabold">Browse Events</span> to apply.
          </div>
        ) : null}
      </div>
    </div>
  );
}
