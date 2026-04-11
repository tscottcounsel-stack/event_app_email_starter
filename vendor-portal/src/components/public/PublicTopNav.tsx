import { Link } from "react-router-dom";
import VendCoreLogo from "../ui/VendCoreLogo";

type Props = {
  current?: string;
};

export default function PublicTopNav({ current }: Props) {
  const linkClass = (name: string) =>
    `transition font-semibold ${
      current === name ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
    }`;

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">

        {/* LOGO */}
        <Link to="/" className="flex items-center">
          <VendCoreLogo size={120} />
        </Link>

        {/* NAV LINKS */}
        <div className="hidden gap-8 md:flex">
          <Link to="/events" className={linkClass("events")}>Events</Link>
          <Link to="/vendors" className={linkClass("vendors")}>Vendors</Link>
          <Link to="/organizers" className={linkClass("organizers")}>Organizers</Link>
          <Link to="/venues" className={linkClass("venues")}>Venues</Link>
          <Link to="/pricing" className={linkClass("pricing")}>Pricing</Link>
        </div>

        {/* ACTIONS */}
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-xl border border-slate-300 px-4 py-2 font-bold hover:bg-slate-100"
          >
            Sign In
          </Link>

          <Link
            to="/get-started"
            className="rounded-xl bg-brand-600 px-5 py-2 font-bold text-white hover:bg-brand-700"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}