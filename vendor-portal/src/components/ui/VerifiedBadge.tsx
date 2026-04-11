type Props = {
  label?: string;
  className?: string;
};

export default function VerifiedBadge({ label = "Verified", className = "" }: Props) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600 ${className}`}
    >
      ✓ {label}
    </div>
  );
}