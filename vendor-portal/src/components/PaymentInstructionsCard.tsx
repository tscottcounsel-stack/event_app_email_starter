// src/components/PaymentInstructionsCard.tsx
import React from "react";
import { CopyPill } from "./CopyPill";

type PaymentInstructions = {
  title?: string;
  subtitle?: string;

  paypal?: string;
  zelle?: string;

  memo?: string;
  refundPolicy?: string;
};

export function PaymentInstructionsCard(props: {
  instructions: PaymentInstructions;
  onPayOrganizer?: () => void;
}) {
  const i = props.instructions || {};
  const paypal = String(i.paypal || "").trim();
  const zelle = String(i.zelle || "").trim();
  const memo = String(i.memo || "").trim();
  const refundPolicy = String(i.refundPolicy || "").trim();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-slate-900">{i.title || "Payment instructions"}</div>
          {i.subtitle ? <div className="mt-1 text-sm text-slate-600">{i.subtitle}</div> : null}
        </div>

        {props.onPayOrganizer ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onPayOrganizer?.();
            }}
            className="rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-xs font-bold text-white hover:opacity-95"
          >
            Pay organizer
          </button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2" id="payment-methods">
        {/* Methods */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-900">Accepted methods</div>

          <div className="mt-3 space-y-3">
            {paypal ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">PayPal</div>
                  <div className="break-words text-xs text-slate-600">{paypal}</div>
                </div>
                <CopyPill value={paypal} />
              </div>
            ) : null}

            {zelle ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Zelle</div>
                  <div className="break-words text-xs text-slate-600">{zelle}</div>
                </div>
                <CopyPill value={zelle} />
              </div>
            ) : null}

            {!paypal && !zelle ? (
              <div className="text-xs text-slate-600">No payment methods provided yet.</div>
            ) : null}
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-900">Notes</div>

          {memo ? (
            <div className="mt-3">
              <div className="text-xs font-semibold text-slate-700">Memo / reference</div>
              <div className="mt-1 flex items-start justify-between gap-3">
                {/* IMPORTANT: no truncate — allow full sentence to wrap */}
                <div className="min-w-0 break-words text-xs text-slate-600">{memo}</div>
                <CopyPill value={memo} />
              </div>
            </div>
          ) : null}

          {refundPolicy ? (
            <div className="mt-3 text-xs text-slate-700">
              <span className="font-semibold">Refund policy:</span> {refundPolicy}
            </div>
          ) : null}

          {!memo && !refundPolicy ? (
            <div className="mt-3 text-xs text-slate-600">No additional notes provided.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default PaymentInstructionsCard;
