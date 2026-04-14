type Props = {
  size?: number;
  className?: string;
};

export default function VendCoreLogo({ size = 220, className = "" }: Props) {
  return (
    <div
      style={{ width: size }}
      className={`flex items-center justify-center overflow-hidden ${className}`}
    >
      <img
        src="/logo/vendcore-logo.png"
        alt="VendCore"
        className="block h-auto w-full object-contain"
      />
    </div>
  );
}
