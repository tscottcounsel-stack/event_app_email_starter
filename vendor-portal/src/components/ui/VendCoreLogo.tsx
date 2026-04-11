import React from "react";

type VendCoreLogoProps = {
  size?: number;
  className?: string;
};

export default function VendCoreLogo({ size = 160, className = "" }: VendCoreLogoProps) {
  return (
    <img
      src="/logo/vendcore-logo.png"
      alt="VendCore"
      style={{ width: size }}
      className={`h-auto object-contain ${className}`.trim()}
    />
  );
}
