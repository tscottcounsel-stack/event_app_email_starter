import React from "react";
import { Link } from "react-router-dom";

export default function PublicHomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3 font-black text-lg">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
            VendorConnect
          </Link>

          <div className="hidden gap-8 font-semibold text-slate-600 md:flex">
            <Link to="/" className="hover:text-slate-900">
              Features
            </Link>
            <Link to="/" className="hover:text-slate-900">
              How It Works
            </Link>
            <Link to="/events" className="hover:text-slate-900">
  Events
</Link>
<Link to="/vendors" className="hover:text-slate-900">
  Vendors
</Link>
<Link to="/organizers" className="hover:text-slate-900">
  Organizers
</Link>
<Link to="/venues" className="hover:text-slate-900">
  Find Venues
</Link>
<Link to="/pricing" className="hover:text-slate-900">
  Pricing
</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-xl border border-slate-300 px-4 py-2 font-bold hover:bg-slate-100"
            >
              Sign In
            </Link>

            <Link
              to="/get-started"
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 font-bold text-white"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-100 via-white to-purple-100">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-24 md:grid-cols-2">
          <div>
            <div className="mb-6 inline-flex rounded-full bg-indigo-100 px-4 py-2 text-sm font-bold text-indigo-700">
              Verified Vendors & Organizers Only
            </div>

            <h1 className="text-6xl font-black leading-tight">
              Connect With
              <span className="block bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Verified Vendors
              </span>
              You Can Trust
            </h1>

            <p className="mt-6 max-w-xl text-lg font-semibold text-slate-600">
              The premium marketplace where verified event organizers meet pre-screened vendors.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/events"
                className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-4 font-extrabold text-white"
              >
                Find Events →
              </Link>

              {/* Public CTA should not jump into protected /vendor/dashboard */}
              <Link
                to="/get-started"
                className="rounded-2xl bg-emerald-600 px-8 py-4 font-extrabold text-white"
              >
                Become a Vendor →
              </Link>
            </div>
          </div>

          <div className="relative">
            <img
              src="https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=1400&q=80"
              className="rounded-3xl shadow-2xl"
              alt="Event audience"
            />

            <div className="absolute -right-6 top-8 rounded-2xl bg-white p-4 shadow-xl">
              <div className="text-2xl font-black">5,000+</div>
              <div className="text-sm font-bold text-slate-500">Active Vendors</div>
            </div>
          </div>
        </div>
      </section>

      {/* VENUE SEARCH */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex rounded-full border border-indigo-200 px-4 py-2 text-sm font-bold text-indigo-700">
              Find Perfect Venues
            </div>

            <h2 className="text-4xl font-black">Search Event Venues In Your Area</h2>

            <p className="mt-4 font-semibold text-slate-600">
              Browse verified venues by capacity, amenities, and pricing.
            </p>

            <div className="mt-6 flex flex-wrap gap-4">
              <Link
                to="/venues"
                className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 font-bold text-white"
              >
                Search Venues →
              </Link>

              <Link
                to="/events"
                className="rounded-2xl bg-emerald-600 px-6 py-3 font-bold text-white"
              >
                Browse Events
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {[
              ["800+", "Venues Listed"],
              ["50+", "Cities Covered"],
              ["4.8", "Avg Rating"],
              ["24/7", "Support"],
            ].map(([num, label]) => (
              <div key={label} className="rounded-3xl bg-white p-6 shadow-md">
                <div className="text-3xl font-black">{num}</div>
                <div className="font-semibold text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-5xl font-black">How It Works</h2>
          <p className="mt-4 font-semibold text-slate-500">Get started in 3 simple steps</p>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              ["Get Verified", "Complete verification for quality & trust."],
              ["Connect & Book", "Browse events and apply for booths."],
              ["Event Success", "Manage bookings and payments easily."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-3xl border bg-white p-8 shadow-sm">
                <h3 className="text-xl font-black">{title}</h3>
                <p className="mt-4 font-semibold text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES BAND */}
      <section className="bg-gradient-to-r from-indigo-900 to-purple-800 py-24 text-white">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-5xl font-black">Powerful Features</h2>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              "Verified Partners Only",
              "Trusted Community",
              "Interactive Booth Maps",
              "Performance Tracking",
              "Quality Assurance",
              "Secure Transactions",
            ].map((f) => (
              <div key={f} className="rounded-3xl bg-white/10 p-6">
                <div className="font-black">{f}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 py-24 text-center text-white">
        <h2 className="text-5xl font-black">Ready to Transform Your Events?</h2>

        <div className="mt-8 flex flex-wrap justify-center gap-4 px-6">
          <Link
            to="/get-started"
            className="rounded-2xl bg-white px-8 py-4 font-black text-indigo-700"
          >
            Get Started Free →
          </Link>

          <Link to="/events" className="rounded-2xl border border-white px-8 py-4 font-black">
            Browse Events
          </Link>

          <Link to="/venues" className="rounded-2xl border border-white px-8 py-4 font-black">
            Find Venues
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gradient-to-r from-slate-900 to-indigo-950 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-4">
          <div>
            <div className="text-2xl font-black">VendorConnect</div>
            <p className="mt-4 text-sm text-slate-400">
              Connecting events with perfect vendors worldwide.
            </p>
          </div>

          <div>
            <div className="font-bold">Platform</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/events" className="hover:text-white">
                  Find Events
                </Link>
              </li>
              <li>
                <Link to="/get-started" className="hover:text-white">
                  Become a Vendor
                </Link>
              </li>
              <li>
                <Link to="/get-started" className="hover:text-white">
                  Host an Event
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-bold">Company</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/pricing" className="hover:text-white">
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/venues" className="hover:text-white">
                  Find Venues
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-white">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="font-bold">Legal</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">
              <li>Privacy Policy</li>
              <li>Terms</li>
              <li>Security</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 text-center text-sm text-slate-500">© 2026 VendorConnect</div>
      </footer>
    </div>
  );
}



