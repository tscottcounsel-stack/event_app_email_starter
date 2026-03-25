import React from "react";
import { cn } from "../lib/utils";

type Status = "draft" | "published" | "pending" | "approved" | "rejected" | string;

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = String(status || "").toLowerCase();

  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    published: "bg-emerald-100 text-emerald-700",
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    booked: "bg-blue-100 text-blue-700",
    available: "bg-emerald-100 text-emerald-700",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        map[s] || "bg-gray-100 text-gray-700",
        className
      )}
    >
      {status}
    </span>
  );
}





