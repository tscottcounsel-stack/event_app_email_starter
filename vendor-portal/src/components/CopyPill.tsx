// src/components/CopyPill.tsx
import React, { useMemo, useState } from "react";

type CopyPillProps = {
  value: string;
  label?: string;
  className?: string;
  /** Optional: stop parent click handlers (recommended in cards) */
  stopPropagation?: boolean;
};

/**
 * CopyPill
 * - Named export AND default export (prevents "does not provide an export named CopyPill" errors)
 * - Best-effort clipboard copy with fallback for non-secure contexts
 */
export function CopyPill(props: CopyPillProps) {
  const { value, label = "Copy", className, stopPropagation = true } = props;

  const [copied, setCopied] = useState(false);

  const safeValue = useMemo(() => String(value ?? ""), [value]);

  async function doCopy() {
    const text = safeValue;
    if (!text) return;

    // Modern clipboard (requires secure context / user gesture)
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
      return;
    } catch {
      // Fallback below
    }

    // Fallback: temporary textarea (works on http://localhost)
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
        void doCopy();
      }}
      className={
        className ??
        "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
      }
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export default CopyPill;
