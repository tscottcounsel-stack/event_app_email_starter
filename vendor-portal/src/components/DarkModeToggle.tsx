import { useEffect, useState } from "react";

export default function DarkModeToggle() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (enabled) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [enabled]);

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      className="rounded-xl border px-3 py-2 text-sm font-medium
                 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700
                 border-gray-200 dark:border-gray-700"
      aria-pressed={enabled}
      title="Toggle dark mode"
    >
      {enabled ? "Dark: ON" : "Dark: OFF"}
    </button>
  );
}
