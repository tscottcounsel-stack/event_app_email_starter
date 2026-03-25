import React, { useCallback, useEffect, useMemo, useState } from "react";
import { buildAuthHeaders } from "../auth/authHeaders";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || "https://event-app-api-production-ccce.up.railway.app";

type PaymentItem = {
  id?: number | string;
  vendor_name?: string | null;
  vendor_email?: string | null;
  organizer_name?: string | null;
  organizer_id?: number | string | null;
  organizer_email?: string | null;
  event_title?: string | null;
  event_id?: number | string | null;
  booth_id?: string | number | null;
  booth_label?: string | null;
  amount?: number | string | null;
  platform_fee?: number | string | null;
  organizer_payout?: number | string | null;
  status?: string | null;
  payout_status?: string | null;
  payout_method?: string | null;
  payout_notes?: string | null;
  paid_at?: string | null;
  payout_sent_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  application_id?: number | string | null;
  payout_batch_id?: number | string | null;
  [key: string]: any;
};

type PayoutHistoryItem = {
  id?: number | string;
  organizer_name?: string | null;
  organizer_id?: number | string | null;
  organizer_email?: string | null;
  amount?: number | string | null;
  payment_ids?: Array<number | string>;
  payment_count?: number | string | null;
  method?: string | null;
  notes?: string | null;
  created_at?: string | null;
  created_by?: string | null;
};

type PaymentsResponse = {
  summary?: {
    payment_count?: number;
    gross_sales?: number;
    platform_revenue?: number;
    organizer_payouts_owed?: number;
    organizer_payouts_paid?: number;
    payout_status_counts?: {
      unpaid?: number;
      scheduled?: number;
      paid?: number;
    };
  };
  payments?: PaymentItem[] | Record<string, PaymentItem>;
};

type PayoutHistoryResponse = {
  payouts?: PayoutHistoryItem[] | Record<string, PayoutHistoryItem>;
};

function toList<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value) as T[];
  return [];
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(toNumber(value));
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function cardStyle(background = "#ffffff"): React.CSSProperties {
  return {
    background,
    border: "1px solid #d9e2f1",
    borderRadius: 20,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  };
}

function buttonStyle(kind: "primary" | "secondary" | "ghost" | "success" | "danger"): React.CSSProperties {
  if (kind === "primary") {
    return {
      border: "none",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "linear-gradient(135deg, #312e81 0%, #6d28d9 100%)",
      color: "#ffffff",
    };
  }
  if (kind === "success") {
    return {
      border: "none",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "linear-gradient(135deg, #047857 0%, #10b981 100%)",
      color: "#ffffff",
    };
  }
  if (kind === "danger") {
    return {
      border: "none",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "#991b1b",
      color: "#ffffff",
    };
  }
  if (kind === "secondary") {
    return {
      border: "1px solid #cbd5e1",
      borderRadius: 12,
      padding: "10px 14px",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      background: "#ffffff",
      color: "#0f172a",
    };
  }
  return {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "8px 12px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    background: "#f8fafc",
    color: "#334155",
  };
}

function statusPill(
  text: string,
  tone: "warning" | "success" | "neutral" | "danger"
): React.CSSProperties {
  const map = {
    warning: {
      background: "#fff7ed",
      color: "#9a3412",
      border: "1px solid #fdba74",
    },
    success: {
      background: "#ecfdf5",
      color: "#166534",
      border: "1px solid #86efac",
    },
    neutral: {
      background: "#f8fafc",
      color: "#334155",
      border: "1px solid #cbd5e1",
    },
    danger: {
      background: "#fef2f2",
      color: "#991b1b",
      border: "1px solid #fca5a5",
    },
  } as const;

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 88,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    textTransform: "uppercase",
    ...map[tone],
  };
}

function derivePaymentTone(
  status?: string | null
): "warning" | "success" | "neutral" | "danger" {
  const s = String(status || "").trim().toLowerCase();
  if (s === "paid" || s === "completed" || s === "succeeded") return "success";
  if (s === "pending" || s === "processing" || s === "awaiting_payment") return "warning";
  if (s === "failed" || s === "canceled" || s === "cancelled" || s === "refunded") return "danger";
  return "neutral";
}

function derivePayoutTone(
  status?: string | null
): "warning" | "success" | "neutral" | "danger" {
  const s = String(status || "").trim().toLowerCase();
  if (s === "paid") return "success";
  if (s === "scheduled") return "neutral";
  if (s === "unpaid" || s === "pending" || s === "") return "warning";
  if (s === "failed" || s === "canceled" || s === "cancelled") return "danger";
  return "neutral";
}

function getVendorLabel(payment: PaymentItem): string {
  return payment.vendor_name || payment.vendor_email || "Unknown vendor";
}

function getOrganizerLabel(payment: PaymentItem): string {
  return payment.organizer_name || payment.organizer_email || "Unknown organizer";
}

function getEventLabel(payment: PaymentItem): string {
  return payment.event_title || "Untitled event";
}

function getBoothLabel(payment: PaymentItem): string {
  return payment.booth_label ||
    (payment.booth_id !== undefined &&
    payment.booth_id !== null &&
    payment.booth_id !== ""
      ? `Booth ${payment.booth_id}`
      : "—");
}

function normalizePayoutStatus(payment: PaymentItem): string {
  const raw = String(payment.payout_status || "").trim().toLowerCase();
  if (raw) return raw;
  const payStatus = String(payment.status || "").trim().toLowerCase();
  if (payStatus === "paid" || payStatus === "completed" || payStatus === "succeeded") {
    return "unpaid";
  }
  return "pending";
}

function isVendorPaymentSuccessful(payment: PaymentItem): boolean {
  const s = String(payment.status || "").trim().toLowerCase();
  return s === "paid" || s === "completed" || s === "succeeded";
}

type OrganizerGroup = {
  key: string;
  organizer_name: string;
  organizer_email?: string | null;
  organizer_id?: string | number | null;
  payments: PaymentItem[];
  gross: number;
  fees: number;
  owed: number;
  paid: number;
  dueCount: number;
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [payouts, setPayouts] = useState<PayoutHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<
    "all" | "paid" | "pending" | "failed" | "payout_due" | "payout_paid"
  >("all");
  const [markingId, setMarkingId] = useState<string | number | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [selectedOrganizerKey, setSelectedOrganizerKey] = useState<string | null>(null);
  const [payoutMethod, setPayoutMethod] = useState("manual");
  const [payoutNotes, setPayoutNotes] = useState("");

  const loadPayments = useCallback(async (soft = false) => {
    try {
      if (soft) setRefreshing(true);
      else setLoading(true);
      setError("");

      const [paymentsRes, payoutsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/payments`, { headers: buildAuthHeaders() }),
        fetch(`${API_BASE}/admin/payouts`, { headers: buildAuthHeaders() }),
      ]);

      const paymentsData: PaymentsResponse = await paymentsRes.json().catch(() => ({}));
      const payoutsData: PayoutHistoryResponse = await payoutsRes.json().catch(() => ({}));

      if (!paymentsRes.ok) {
        throw new Error(
          (paymentsData as any)?.detail ||
            (paymentsData as any)?.message ||
            "Failed to load payments."
        );
      }
      if (!payoutsRes.ok) {
        throw new Error(
          (payoutsData as any)?.detail ||
            (payoutsData as any)?.message ||
            "Failed to load payout history."
        );
      }

      setPayments(
        toList<PaymentItem>((paymentsData as any)?.payments).filter(
          (item) => item && typeof item === "object"
        )
      );
      setPayouts(
        toList<PayoutHistoryItem>((payoutsData as any)?.payouts).filter(
          (item) => item && typeof item === "object"
        )
      );
    } catch (err: any) {
      setError(err?.message || "Failed to load payments.");
      setPayments([]);
      setPayouts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPayments(false);
  }, [loadPayments]);

  const markPayoutPaid = useCallback(
    async (paymentId: string | number | undefined) => {
      if (paymentId === undefined || paymentId === null || paymentId === "") return;

      try {
        setMarkingId(paymentId);
        setError("");

        const res = await fetch(
          `${API_BASE}/admin/payments/${paymentId}/mark-payout-paid`,
          {
            method: "PUT",
            headers: buildAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ method: "manual", notes: "Marked as paid from admin payments page" }),
          }
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            data?.detail || data?.message || "Failed to mark payout as paid."
          );
        }

        await loadPayments(true);
      } catch (err: any) {
        setError(err?.message || "Failed to mark payout as paid.");
      } finally {
        setMarkingId(null);
      }
    },
    [loadPayments]
  );

  const sendOrganizerPayout = useCallback(async (group: OrganizerGroup) => {
    try {
      setSendingKey(group.key);
      setError("");

      const payload: Record<string, any> = {
        method: payoutMethod || "manual",
        notes: payoutNotes || "",
      };

      if (group.organizer_id !== undefined && group.organizer_id !== null && group.organizer_id !== "") {
        payload.organizer_id = group.organizer_id;
      } else if (group.organizer_email) {
        payload.organizer_email = group.organizer_email;
      } else {
        throw new Error("Organizer identifier missing.");
      }

      const res = await fetch(`${API_BASE}/admin/payouts/send`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || "Failed to send payout.");
      }

      setSelectedOrganizerKey(null);
      setPayoutNotes("");
      setPayoutMethod("manual");
      await loadPayments(true);
    } catch (err: any) {
      setError(err?.message || "Failed to send payout.");
    } finally {
      setSendingKey(null);
    }
  }, [loadPayments, payoutMethod, payoutNotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return payments.filter((payment) => {
      const paymentStatus = String(payment.status || "").trim().toLowerCase();
      const payoutStatus = normalizePayoutStatus(payment);

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "failed"
          ? ["failed", "canceled", "cancelled", "refunded"].includes(paymentStatus)
          : filter === "pending"
          ? ["pending", "processing", "awaiting_payment"].includes(paymentStatus)
          : filter === "paid"
          ? paymentStatus === "paid" || paymentStatus === "completed" || paymentStatus === "succeeded"
          : filter === "payout_due"
          ? isVendorPaymentSuccessful(payment) && payoutStatus !== "paid"
          : filter === "payout_paid"
          ? payoutStatus === "paid"
          : true;

      const haystack = [
        getVendorLabel(payment),
        payment.vendor_email,
        getOrganizerLabel(payment),
        payment.organizer_email,
        getEventLabel(payment),
        getBoothLabel(payment),
        payment.status,
        payment.payout_status,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery = !q || haystack.includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [payments, filter, query]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, payment) => {
        const amount = toNumber(payment.amount);
        const fee = toNumber(payment.platform_fee);
        const organizerPayout = toNumber(payment.organizer_payout);
        const payoutStatus = normalizePayoutStatus(payment);

        if (isVendorPaymentSuccessful(payment)) {
          acc.gross += amount;
          acc.fees += fee;
          acc.payouts += organizerPayout;
          acc.count += 1;
        }
        if (payoutStatus === "paid") acc.paidOut += organizerPayout;
        else if (isVendorPaymentSuccessful(payment)) acc.owed += organizerPayout;

        return acc;
      },
      { gross: 0, fees: 0, payouts: 0, count: 0, paidOut: 0, owed: 0 }
    );
  }, [filtered]);

  const organizerGroups = useMemo<OrganizerGroup[]>(() => {
    const map = new Map<string, OrganizerGroup>();

    for (const payment of filtered) {
      const key =
        String(payment.organizer_id ?? "").trim() ||
        String(payment.organizer_email ?? "").trim().toLowerCase() ||
        getOrganizerLabel(payment);

      const current = map.get(key) || {
        key,
        organizer_name: getOrganizerLabel(payment),
        organizer_email: payment.organizer_email || null,
        organizer_id: payment.organizer_id ?? null,
        payments: [],
        gross: 0,
        fees: 0,
        owed: 0,
        paid: 0,
        dueCount: 0,
      };

      current.payments.push(payment);

      if (isVendorPaymentSuccessful(payment)) {
        current.gross += toNumber(payment.amount);
        current.fees += toNumber(payment.platform_fee);
      }

      const payout = toNumber(payment.organizer_payout);
      if (normalizePayoutStatus(payment) === "paid") current.paid += payout;
      else if (isVendorPaymentSuccessful(payment)) {
        current.owed += payout;
        current.dueCount += 1;
      }

      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => b.owed - a.owed || b.gross - a.gross);
  }, [filtered]);

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", display: "grid", gap: 20 }}>
        <div style={{ ...cardStyle("linear-gradient(135deg, #0f172a 0%, #312e81 52%, #581c87 100%)"), padding: 28, color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: "#c4b5fd" }}>
                Admin finance center
              </div>
              <h1 style={{ margin: "8px 0 12px", fontSize: 40, lineHeight: 1.05, fontWeight: 900 }}>
                Payments, payouts, and organizer balances
              </h1>
              <p style={{ margin: 0, maxWidth: 860, color: "#ddd6fe", fontSize: 16, lineHeight: 1.6, fontWeight: 600 }}>
                Review successful vendor payments, pay organizers individually, and keep a clean payout history.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={buttonStyle("secondary")} onClick={() => loadPayments(true)} disabled={refreshing}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ ...cardStyle("#fff7ed"), padding: 16, color: "#9a3412", fontWeight: 800 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16 }}>
          {[
            ["Successful Payments", summary.count, "Paid booth purchases"],
            ["Gross Sales", formatCurrency(summary.gross), "Total vendor payments"],
            ["Platform Fees", formatCurrency(summary.fees), "Marketplace revenue retained"],
            ["Paid Out", formatCurrency(summary.paidOut), "Organizer payouts completed"],
            ["Payout Owed", formatCurrency(summary.owed), "Outstanding organizer balances"],
          ].map(([label, value, helper]) => (
            <div key={String(label)} style={{ ...cardStyle(), padding: 22 }}>
              <div style={{ color: "#64748b", fontWeight: 900, textTransform: "uppercase", fontSize: 12, letterSpacing: 1 }}>
                {label}
              </div>
              <div style={{ marginTop: 10, fontSize: 28, fontWeight: 900, color: "#0f172a" }}>{value}</div>
              <div style={{ marginTop: 8, color: "#475569", fontSize: 14, fontWeight: 700 }}>{helper}</div>
            </div>
          ))}
        </div>

        <div style={{ ...cardStyle(), padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>Per-organizer payout queue</div>
              <div style={{ marginTop: 6, fontSize: 14, color: "#64748b", fontWeight: 700 }}>
                Pay each organizer separately so your audit trail matches how money actually leaves the business.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vendor, organizer, event..."
                style={{
                  minWidth: 260,
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                style={{
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#0f172a",
                  background: "#fff",
                }}
              >
                <option value="all">All</option>
                <option value="paid">Vendor Paid</option>
                <option value="pending">Vendor Pending</option>
                <option value="failed">Vendor Failed</option>
                <option value="payout_due">Payout Due</option>
                <option value="payout_paid">Payout Paid</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            {organizerGroups.map((group) => (
              <div key={group.key} style={{ ...cardStyle("#ffffff"), padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>{group.organizer_name}</div>
                    <div style={{ marginTop: 6, color: "#64748b", fontSize: 14, fontWeight: 700 }}>
                      {group.organizer_email || "No organizer email on file"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ minWidth: 110 }}>
                      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>Gross</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{formatCurrency(group.gross)}</div>
                    </div>
                    <div style={{ minWidth: 110 }}>
                      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>Fees</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{formatCurrency(group.fees)}</div>
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>Owed</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: group.owed > 0 ? "#9a3412" : "#0f172a" }}>
                        {formatCurrency(group.owed)}
                      </div>
                    </div>
                    <button
                      style={buttonStyle("success")}
                      disabled={group.owed <= 0 || sendingKey === group.key}
                      onClick={() => setSelectedOrganizerKey(selectedOrganizerKey === group.key ? null : group.key)}
                    >
                      {sendingKey === group.key ? "Sending..." : group.owed > 0 ? "Send Payout" : "Nothing Due"}
                    </button>
                  </div>
                </div>

                {selectedOrganizerKey === group.key ? (
                  <div style={{ marginTop: 16, padding: 16, borderRadius: 16, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12, alignItems: "end" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", textTransform: "uppercase" }}>Method</div>
                        <select
                          value={payoutMethod}
                          onChange={(e) => setPayoutMethod(e.target.value)}
                          style={{ width: "100%", marginTop: 6, borderRadius: 12, border: "1px solid #cbd5e1", padding: "10px 12px", fontWeight: 700 }}
                        >
                          <option value="manual">Manual</option>
                          <option value="ach">ACH</option>
                          <option value="zelle">Zelle</option>
                          <option value="check">Check</option>
                          <option value="cash">Cash</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#475569", textTransform: "uppercase" }}>Notes</div>
                        <input
                          value={payoutNotes}
                          onChange={(e) => setPayoutNotes(e.target.value)}
                          placeholder="Example: Sent via Zelle to organizer on file"
                          style={{ width: "100%", marginTop: 6, borderRadius: 12, border: "1px solid #cbd5e1", padding: "10px 12px", fontWeight: 700 }}
                        />
                      </div>
                      <button
                        style={buttonStyle("primary")}
                        disabled={sendingKey === group.key || group.owed <= 0}
                        onClick={() => sendOrganizerPayout(group)}
                      >
                        Confirm {formatCurrency(group.owed)}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 16, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#64748b", fontSize: 12, textTransform: "uppercase" }}>
                        <th style={{ padding: "10px 8px" }}>Vendor</th>
                        <th style={{ padding: "10px 8px" }}>Event</th>
                        <th style={{ padding: "10px 8px" }}>Booth</th>
                        <th style={{ padding: "10px 8px" }}>Amount</th>
                        <th style={{ padding: "10px 8px" }}>Fee</th>
                        <th style={{ padding: "10px 8px" }}>Organizer Payout</th>
                        <th style={{ padding: "10px 8px" }}>Vendor Status</th>
                        <th style={{ padding: "10px 8px" }}>Payout Status</th>
                        <th style={{ padding: "10px 8px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.payments.map((payment) => {
                        const payoutStatus = normalizePayoutStatus(payment);
                        return (
                          <tr key={String(payment.id)} style={{ borderTop: "1px solid #eef2f7" }}>
                            <td style={{ padding: "14px 8px", fontWeight: 800, color: "#0f172a" }}>
                              <div>{getVendorLabel(payment)}</div>
                              <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>{payment.vendor_email || "—"}</div>
                            </td>
                            <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>{getEventLabel(payment)}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>{getBoothLabel(payment)}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 900, color: "#0f172a" }}>{formatCurrency(payment.amount)}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 900, color: "#0f172a" }}>{formatCurrency(payment.platform_fee)}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 900, color: "#0f172a" }}>{formatCurrency(payment.organizer_payout)}</td>
                            <td style={{ padding: "14px 8px" }}>
                              <span style={statusPill(String(payment.status || "unknown"), derivePaymentTone(payment.status))}>
                                {String(payment.status || "unknown")}
                              </span>
                            </td>
                            <td style={{ padding: "14px 8px" }}>
                              <span style={statusPill(payoutStatus, derivePayoutTone(payoutStatus))}>
                                {payoutStatus}
                              </span>
                              <div style={{ marginTop: 6, color: "#64748b", fontSize: 12, fontWeight: 700 }}>
                                {formatDateTime(payment.payout_sent_at)}
                              </div>
                            </td>
                            <td style={{ padding: "14px 8px" }}>
                              {isVendorPaymentSuccessful(payment) && payoutStatus !== "paid" ? (
                                <button
                                  style={buttonStyle("ghost")}
                                  onClick={() => markPayoutPaid(payment.id)}
                                  disabled={markingId === payment.id}
                                >
                                  {markingId === payment.id ? "Saving..." : "Mark Paid"}
                                </button>
                              ) : (
                                <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 700 }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {organizerGroups.length === 0 ? (
              <div style={{ padding: 20, color: "#64748b", fontWeight: 800 }}>
                No payments match the current filters.
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ ...cardStyle(), padding: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>Payout history</div>
          <div style={{ marginTop: 6, color: "#64748b", fontSize: 14, fontWeight: 700 }}>
            Every organizer payout is logged so you can audit what was sent, when, and for whom.
          </div>

          <div style={{ marginTop: 18, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b", fontSize: 12, textTransform: "uppercase" }}>
                  <th style={{ padding: "10px 8px" }}>Date</th>
                  <th style={{ padding: "10px 8px" }}>Organizer</th>
                  <th style={{ padding: "10px 8px" }}>Amount</th>
                  <th style={{ padding: "10px 8px" }}>Payments Included</th>
                  <th style={{ padding: "10px 8px" }}>Method</th>
                  <th style={{ padding: "10px 8px" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((item) => (
                  <tr key={String(item.id)} style={{ borderTop: "1px solid #eef2f7" }}>
                    <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>
                      {formatDateTime(item.created_at)}
                    </td>
                    <td style={{ padding: "14px 8px", fontWeight: 800, color: "#0f172a" }}>
                      <div>{item.organizer_name || item.organizer_email || "Unknown organizer"}</div>
                      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>{item.organizer_email || "—"}</div>
                    </td>
                    <td style={{ padding: "14px 8px", fontWeight: 900, color: "#0f172a" }}>
                      {formatCurrency(item.amount)}
                    </td>
                    <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>
                      {toNumber(item.payment_count || item.payment_ids?.length || 0)} payments
                    </td>
                    <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>
                      {item.method || "manual"}
                    </td>
                    <td style={{ padding: "14px 8px", fontWeight: 700, color: "#0f172a" }}>
                      {item.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payouts.length === 0 ? (
              <div style={{ padding: "16px 8px", color: "#64748b", fontWeight: 800 }}>
                No payout history yet.
              </div>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div style={{ ...cardStyle(), padding: 18, color: "#334155", fontWeight: 800 }}>
            Loading payment operations...
          </div>
        ) : null}
      </div>
    </div>
  );
}



