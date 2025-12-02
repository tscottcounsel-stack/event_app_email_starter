import { Link, useNavigate } from "react-router-dom";
import DarkModeToggle from "./DarkModeToggle";
import { isAuthed, clearToken } from "@/lib/auth";
import { useSyncExternalStore } from "react";

// tiny store to re-render when token changes
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function getSnap() { return isAuthed(); }

export default function Navbar() {
  const authed = useSyncExternalStore(subscribe, getSnap, getSnap);
  const nav = useNavigate();

  function logout() {
    clearToken();
    // also notify same tab
    window.dispatchEvent(new StorageEvent("storage"));
    nav("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur border-gray-200 dark:border-gray-800 dark:bg-gray-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-semibold">Vendor Portal</Link>

        <nav className="flex items-center gap-3">
          <Link className="text-sm hover:underline" to="/vendor">Vendor</Link>
          <Link className="text-sm hover:underline" to="/organizer">Organizer</Link>
          {!authed ? (
            <Link className="text-sm hover:underline" to="/login">Login</Link>
          ) : (
            <button onClick={logout} className="text-sm rounded-lg border px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
              Logout
            </button>
          )}
          <DarkModeToggle />
        </nav>
      </div>
    </header>
  );
}
