import { PropsWithChildren } from "react";

export default function Card({ children }: PropsWithChildren) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm
                    border-gray-200 dark:border-gray-800 dark:bg-gray-900">
      {children}
    </div>
  );
}
