import React from "react";

type CardProps = {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
};

export function Card({ children, className = "", hover = false }: CardProps) {
  return (
    <div
      className={[
        "bg-white rounded-xl border border-gray-200 shadow-sm",
        hover ? "hover:shadow-md transition-shadow" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={["p-4", className].join(" ")}>{children}</div>;
}
