// src/components/ui/NavButton.tsx
//
// Safe neutral version: always visible text
// Allows tailwind overrides (e.g. text-white on colored buttons)
// No opacity masking of text
// No transparent defaults
//

import React from "react";

type Props = {
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export default function NavButton({
  onClick,
  href,
  disabled,
  title,
  children,
  className = "",
}: Props) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium " +
    "border shadow-sm transition " +
    "hover:shadow disabled:opacity-50 disabled:cursor-not-allowed " +
    "bg-white hover:bg-slate-50 text-slate-800";

  if (href) {
    return (
      <a
        href={href}
        title={title}
        className={`${base} ${className}`}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${className}`}
    >
      {children}
    </button>
  );
}
