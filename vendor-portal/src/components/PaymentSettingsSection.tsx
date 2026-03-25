// src/components/PaymentSettingsSection.tsx
import React, { useMemo } from "react";

export type PaymentMethodKey =
  | "zelle"
  | "venmo"
  | "paypal"
  | "cashapp"
  | "ach"
  | "wire"
  | "check"
  | "cash"
  | "other";

export type PaymentSettings = {
  enabled?: boolean;

  // Optional direct payment link (e.g., Stripe Payment Link, Square, PayPal.me, etc.)
  payment_url?: string;

  // Organizer contact for billing/payment questions
  billing_contact_email?: string;
  billing_contact_phone?: string;

  // Optional metadata / instructions
  memo_instructions?: string;
  refund_policy?: string;
  payment_notes?: string;

  // Optional due date text (kept as string to avoid timezone issues)
  due_by?: string;

  // Optional deposit
  deposit_type?: "none" | "flat" | "percent";
  deposit_value?: number | null;

  // Payment methods the organizer accepts
  methods?: Record<
    PaymentMethodKey,
    {
      enabled?: boolean;
      contact?: string; // handle / email / phone / routing instructions (freeform)
    }
  >;
};

const METHOD_LABELS: Record<PaymentMethodKey, string> = {
  zelle: "Zelle",
  venmo: "Venmo",
  paypal: "PayPal",
  cashapp: "Cash App",
  ach: "Bank Transfer (ACH)",
  wire: "Wire Transfer",
  check: "Check",
  cash: "Cash",
  other: "Other",
};

function coerceBool(v: any) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "1", "yes", "y", "on"].includes(v.toLowerCase().trim());
  return false;
}

export default function PaymentSettingsSection({
  value,
  onChange,
  title = "Payment (optional)",
  help = "Payment is handled directly between the vendor and organizer for now. These details are shown to vendors after approval.",
}: {
  value: PaymentSettings | undefined;
  onChange: (next: PaymentSettings) => void;
  title?: string;
  help?: string;
}) {
  const v: PaymentSettings = value && typeof value === "object" ? value : {};

  const methods = useMemo(() => {
    const m = (v.methods && typeof v.methods === "object" ? v.methods : {}) as PaymentSettings["methods"];
    return (Object.keys(METHOD_LABELS) as PaymentMethodKey[]).map((k) => {
      const row = m?.[k] || {};
      return {
        key: k,
        label: METHOD_LABELS[k],
        enabled: coerceBool(row.enabled),
        contact: String(row.contact || ""),
      };
    });
  }, [v.methods]);

  function patch(p: Partial<PaymentSettings>) {
    onChange({ ...v, ...p });
  }

  function patchMethod(key: PaymentMethodKey, next: { enabled?: boolean; contact?: string }) {
    const prevMethods =
      (v.methods && typeof v.methods === "object" ? v.methods : {}) as NonNullable<PaymentSettings["methods"]>;
    patch({
      methods: {
        ...prevMethods,
        [key]: { ...(prevMethods[key] || {}), ...next },
      },
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-600">{help}</div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-900">Enable payment section</div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={coerceBool(v.enabled ?? true)}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700">Payment link (optional)</label>
            <input
              value={v.payment_url || ""}
              onChange={(e) => patch({ payment_url: e.target.value })}
              placeholder="https://..."
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <div className="mt-1 text-xs text-slate-500">
              Example: a Stripe Payment Link, Square invoice link, PayPal.me link, etc.
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Billing contact email</label>
              <input
                value={v.billing_contact_email || ""}
                onChange={(e) => patch({ billing_contact_email: e.target.value })}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Billing contact phone</label>
              <input
                value={v.billing_contact_phone || ""}
                onChange={(e) => patch({ billing_contact_phone: e.target.value })}
                placeholder="(optional)"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-semibold text-slate-900">Deposit & due date (optional)</div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Deposit type</label>
              <select
                value={v.deposit_type || "none"}
                onChange={(e) => patch({ deposit_type: e.target.value as any })}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="none">None</option>
                <option value="flat">Flat $ amount</option>
                <option value="percent">Percent %</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Deposit value</label>
              <input
                type="number"
                value={v.deposit_value ?? ""}
                onChange={(e) => patch({ deposit_value: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="(optional)"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700">Due by (optional)</label>
            <input
              value={v.due_by || ""}
              onChange={(e) => patch({ due_by: e.target.value })}
              placeholder="e.g., 7 days after approval"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-700">Memo / reference instructions</label>
            <input
              value={v.memo_instructions || ""}
              onChange={(e) => patch({ memo_instructions: e.target.value })}
              placeholder="e.g., Put your company name + booth #"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-3">
        <div className="text-xs font-semibold text-slate-900">Accepted payment methods</div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {(Object.keys(METHOD_LABELS) as PaymentMethodKey[]).map((key) => {
            const row = (v.methods && v.methods[key]) || {};
            const enabled = coerceBool(row.enabled);
            const contact = String(row.contact || "");
            return (
              <div key={key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{METHOD_LABELS[key]}</div>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => patchMethod(key, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                <input
                  value={contact}
                  onChange={(e) => patchMethod(key, { contact: e.target.value })}
                  placeholder="Handle / email / instructions"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-semibold text-slate-900">Refund policy</div>
          <textarea
            value={v.refund_policy || ""}
            onChange={(e) => patch({ refund_policy: e.target.value })}
            placeholder="Optional policy text"
            rows={4}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-semibold text-slate-900">Additional payment notes</div>
          <textarea
            value={v.payment_notes || ""}
            onChange={(e) => patch({ payment_notes: e.target.value })}
            placeholder="Optional notes shown to vendors"
            rows={4}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>
    </div>
  );
}





