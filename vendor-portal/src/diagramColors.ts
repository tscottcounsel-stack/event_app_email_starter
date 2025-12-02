// src/diagramColors.ts

// Shared status type used by the diagram components
export type SlotStatus =
  | "available"
  | "mine"        // assigned to THIS vendor
  | "pending"     // pending for this vendor
  | "taken"       // assigned to another vendor (vendor view only)
  | "rejected";

// Vendor view colors
export function getVendorSlotColor(status: SlotStatus): string {
  switch (status) {
    case "mine":
      // Assigned to you (blue)
      return "border-sky-600 bg-sky-500/90 text-white";
    case "pending":
      // Your pending app (gold)
      return "border-amber-500 bg-amber-300 text-amber-900";
    case "taken":
      // Somebody else’s assigned slot (red-ish)
      return "border-rose-500 bg-rose-400 text-white";
    case "rejected":
      // Not in play / rejected, dimmed
      return "border-slate-400 bg-slate-200 text-slate-600";
    case "available":
    default:
      // Available (green)
      return "border-emerald-600 bg-emerald-500/90 text-white";
  }
}

// Organizer-specific status type (simpler)
export type OrganizerSlotStatus =
  | "available"
  | "assigned"
  | "pending"
  | "rejected";

// Organizer view colors
export function getOrganizerSlotColor(status: OrganizerSlotStatus): string {
  switch (status) {
    case "assigned":
      // Assigned to a vendor (blue)
      return "border-sky-600 bg-sky-500/90 text-white";
    case "pending":
      // Has pending application(s) (gold)
      return "border-amber-500 bg-amber-300 text-amber-900";
    case "rejected":
      // Explicitly rejected / blocked
      return "border-slate-400 bg-slate-200 text-slate-600";
    case "available":
    default:
      // Open / available
      return "border-emerald-600 bg-emerald-500/90 text-white";
  }
}
