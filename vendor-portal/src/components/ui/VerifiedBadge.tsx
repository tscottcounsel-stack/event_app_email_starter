import React from "react";

type VerifiedBadgeProps = {
  label?: string;
  className?: string;
};

export default function VerifiedBadge({ label = "Verified", className = "" }: VerifiedBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700",
        className,
      ].join(" ")}
    >
      <span aria-hidden="true">✓</span>
      {label}
    </span>
  );
}
