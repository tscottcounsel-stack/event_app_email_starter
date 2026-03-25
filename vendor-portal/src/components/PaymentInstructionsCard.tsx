import React, { useMemo, useState } from "react";

type PaymentInstructions = {
  title?: string;
  subtitle?: string;
  paypal?: string;
  zelle?: string;
  venmo?: string;
  cashapp?: string;
  memo?: string;
  refundPolicy?: string;
};

type PaymentStatus =
  | "awaiting_payment"
  | "pending_verification"
  | "paid"
  | "failed"
  | "unknown"
  | string;

type Props = {
  instructions: PaymentInstructions;
  onPayOrganizer?: () => void;
  paymentStatus?: PaymentStatus;
  showPaymentStatus?: boolean;
  showISentPayment?: boolean;
  onISentPayment?: () => void;
  iSentPaymentDisabled?: boolean;
};

type PaymentMethodKey = "paypal" | "zelle" | "venmo" | "cashapp";

type PaymentMethodItem = {
  key: PaymentMethodKey;
  label: string;
  value: string;
  displayValue: string;
  href: string | null;
};

function shortBoothLabel(value?: string) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (!s.includes("_")) return s;
  const tail = s.split("_").pop() || "";
  return tail ? `BOOTH-${tail.slice(0, 4).toUpperCase()}` : s;
}

function extractAppRef(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";

  const appRefMatch = s.match(/\bAPP[-\s]?(\d+)\b/i);
  if (appRefMatch?.[1]) return `APP-${appRefMatch[1]}`;

  const appIdMatch = s.match(/application\s*id\s*\(?\s*(\d+)\s*\)?/i);
  if (appIdMatch?.[1]) return `APP-${appIdMatch[1]}`;

  const bareIdMatch = s.match(/\b(?:application|app)\s*#?\s*(\d+)\b/i);
  if (bareIdMatch?.[1]) return `APP-${bareIdMatch[1]}`;

  return "";
}

function extractBoothRef(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";

  const boothDoubleWordMatch = s.match(/\bbooth\s+booth\s*[:#-]?\s*(\d+|[A-Za-z][A-Za-z0-9-]*)\b/i);
  if (boothDoubleWordMatch?.[1]) {
    return `Booth ${boothDoubleWordMatch[1]}`;
  }

  const boothLabelMatch = s.match(/\bbooth\s*[:#-]?\s*(\d+|[A-Za-z][A-Za-z0-9-]*)\b/i);
  if (boothLabelMatch?.[1]) {
    return `Booth ${boothLabelMatch[1]}`;
  }

  const boothIdMatch = s.match(/\bbooth[_-][A-Za-z0-9_-]+\b/i);
  if (boothIdMatch?.[0]) {
    return shortBoothLabel(boothIdMatch[0]);
  }

  return "";
}

function buildMemo(raw: string) {
  const rawMemo = String(raw || "").trim();
  const appRef = extractAppRef(rawMemo);
  const boothRef = extractBoothRef(rawMemo).trim();

  if (appRef && boothRef) return `${appRef} • ${boothRef}`;
  if (appRef) return appRef;
  if (boothRef) return boothRef;
  return rawMemo || "Use your application ID as the payment reference.";
}

function cleanMethodValue(methodName: string, raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const escapedName = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^${escapedName}\\s*[—:-]\\s*`, "i");
  return value.replace(prefix, "").trim();
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^www\./i.test(value);
}

function normalizeExternalUrl(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

function buildMethodHref(key: PaymentMethodKey, value: string) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;

  const directUrl = normalizeExternalUrl(cleaned);
  if (directUrl) return directUrl;

  if (key === "paypal") {
    const paypalHandle = cleaned.match(/^@?([A-Za-z0-9._-]+)$/)?.[1];
    if (paypalHandle) return `https://paypal.me/${paypalHandle}`;
  }

  if (key === "venmo") {
    const venmoHandle = cleaned.match(/^@?([A-Za-z0-9._-]+)$/)?.[1];
    if (venmoHandle) return `https://venmo.com/${venmoHandle}`;
  }

  if (key === "cashapp") {
    const cashTag = cleaned.match(/^\$?([A-Za-z0-9._-]+)$/)?.[1];
    if (cashTag) return `https://cash.app/$${cashTag}`;
  }

  return null;
}

function renderMethodValue(methodName: string, raw: string) {
  const cleaned = cleanMethodValue(methodName, raw);
  if (!cleaned) return "Enabled";
  return cleaned;
}

function getMethodItems(i: PaymentInstructions): PaymentMethodItem[] {
  const entries: Array<{ key: PaymentMethodKey; label: string; raw?: string }> = [
    { key: "paypal", label: "PayPal", raw: i.paypal },
    { key: "zelle", label: "Zelle", raw: i.zelle },
    { key: "venmo", label: "Venmo", raw: i.venmo },
    { key: "cashapp", label: "Cash App", raw: i.cashapp },
  ];

  return entries
    .map(({ key, label, raw }) => {
      const value = String(raw || "").trim();
      if (!value) return null;
      const displayValue = renderMethodValue(label, value);
      const href = buildMethodHref(key, displayValue);
      return { key, label, value, displayValue, href } satisfies PaymentMethodItem;
    })
    .filter(Boolean) as PaymentMethodItem[];
}

function getPrimaryPaymentLink(methods: PaymentMethodItem[]) {
  return methods.find((method) => method.href)?.href || null;
}

function normalizePaymentStatus(status?: PaymentStatus) {
  const s = String(status || "").trim().toLowerCase();
  if (["awaiting_payment", "awaiting payment", "unpaid", "pending_payment", "pending payment"].includes(s)) {
    return "awaiting_payment";
  }
  if (["pending_verification", "pending verification", "verification_pending", "payment_sent"].includes(s)) {
    return "pending_verification";
  }
  if (["paid", "complete", "completed"].includes(s)) {
    return "paid";
  }
  if (["failed", "payment_failed", "payment failed", "declined"].includes(s)) {
    return "failed";
  }
  return "unknown";
}

function getPaymentStatusMeta(status?: PaymentStatus) {
  switch (normalizePaymentStatus(status)) {
    case "awaiting_payment":
      return {
        label: "Awaiting Payment",
        chipClass: "border-amber-200 bg-amber-50 text-amber-800",
        helpText: "Your booth is approved. Send payment using one of the organizer's accepted methods.",
        reservationText: "Your booth remains reserved while payment is being completed.",
      };
    case "pending_verification":
      return {
        label: "Pending Verification",
        chipClass: "border-sky-200 bg-sky-50 text-sky-800",
        helpText: "Your payment has been marked as sent and is awaiting organizer verification.",
        reservationText: "Your booth remains reserved while payment is being verified.",
      };
    case "paid":
      return {
        label: "Paid",
        chipClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
        helpText: "Payment has been received and recorded for this application.",
        reservationText: "Your booth is reserved and payment has been confirmed.",
      };
    case "failed":
      return {
        label: "Payment Failed",
        chipClass: "border-rose-200 bg-rose-50 text-rose-800",
        helpText: "The organizer has not confirmed this payment yet. Please try again or contact the organizer.",
        reservationText: "Your booth may still be reserved temporarily, but payment still needs attention.",
      };
    default:
      return {
        label: "Payment Status Unknown",
        chipClass: "border-slate-200 bg-slate-50 text-slate-700",
        helpText: "Payment instructions are available below.",
        reservationText: "Your booth reservation status will update here as payment moves forward.",
      };
  }
}

export function PaymentInstructionsCard(props: Props) {
  const i = props.instructions || {};
  const methods = getMethodItems(i);
  const memo = buildMemo(String(i.memo || "").trim());
  const refundPolicy = String(i.refundPolicy || "").trim();
  const paymentLink = getPrimaryPaymentLink(methods);
  const showPaymentStatus = props.showPaymentStatus !== false;
  const showISentPayment = Boolean(props.showISentPayment);
  const normalizedPropStatus = normalizePaymentStatus(props.paymentStatus || "awaiting_payment");
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [sentMessageVisible, setSentMessageVisible] = useState(false);

  const effectiveStatus = useMemo(() => {
    if (localStatus) return localStatus;
    return normalizedPropStatus;
  }, [localStatus, normalizedPropStatus]);

  const statusMeta = getPaymentStatusMeta(effectiveStatus);
  const isPaid = normalizePaymentStatus(effectiveStatus) === "paid";
  const isPendingVerification = normalizePaymentStatus(effectiveStatus) === "pending_verification";
  const canMarkSent = showISentPayment && !isPaid && !isPendingVerification;
  const iSentDisabled = Boolean(props.iSentPaymentDisabled) || !canMarkSent;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  }

  function handlePayOrganizer() {
    if (props.onPayOrganizer) {
      props.onPayOrganizer();
      return;
    }

    if (paymentLink) {
      window.open(paymentLink, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert(
      "Payment instructions are listed below. Please use one of the accepted methods provided by the organizer.",
    );
  }

  function handleISentPayment() {
    if (iSentDisabled) return;

    setLocalStatus("pending_verification");
    setSentMessageVisible(true);

    if (props.onISentPayment) {
      props.onISentPayment();
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-lg font-semibold text-slate-900">{i.title || "Payment instructions"}</div>

            {showPaymentStatus ? (
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.chipClass}`}
              >
                {statusMeta.label}
              </span>
            ) : null}
          </div>

          {i.subtitle ? (
            <div className="mt-3 text-sm leading-6 text-slate-600">{i.subtitle}</div>
          ) : (
            <div className="mt-3 text-sm leading-6 text-slate-600">
              Payment is handled directly with the organizer.
            </div>
          )}

          {showPaymentStatus ? (
            <>
              <div className="mt-2 text-sm leading-6 text-slate-600">{statusMeta.helpText}</div>
              <div className="mt-2 text-xs leading-5 text-slate-500">{statusMeta.reservationText}</div>
              {sentMessageVisible ? (
                <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
                  Payment marked as sent. The organizer can now verify it.
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <button
            type="button"
            onClick={handlePayOrganizer}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
          >
            Pay organizer
          </button>

          {showISentPayment ? (
            <button
              type="button"
              onClick={handleISentPayment}
              disabled={iSentDisabled}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPaid ? "Payment confirmed" : isPendingVerification ? "Payment marked as sent" : "I sent payment"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Accepted methods</div>

        <div className="mt-3 space-y-3">
          {methods.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              No payment methods provided yet.
            </div>
          ) : null}

          {methods.map((method) => (
            <div
              key={method.key}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs text-slate-900">
                  <span className="font-medium">{method.label}</span>
                  <span className="text-slate-500"> — </span>
                  {method.href ? (
                    <a
                      href={method.href}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-slate-900 underline underline-offset-2 hover:text-indigo-700"
                    >
                      {looksLikeUrl(method.displayValue)
                        ? method.displayValue.replace(/^https?:\/\//i, "")
                        : method.displayValue}
                    </a>
                  ) : (
                    <span className="break-words">{method.displayValue}</span>
                  )}
                </div>

                {method.href ? (
                  <button
                    type="button"
                    onClick={() => window.open(method.href as string, "_blank", "noopener,noreferrer")}
                    className="shrink-0 self-start rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {memo ? (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Memo / reference
          </div>

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 break-words text-xs leading-relaxed text-slate-600">{memo}</div>

              <button
                type="button"
                onClick={() => copy(memo)}
                className="shrink-0 self-start rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {refundPolicy ? (
        <div className="mt-4 text-xs text-slate-600">Refund policy: {refundPolicy}</div>
      ) : null}
    </div>
  );
}



