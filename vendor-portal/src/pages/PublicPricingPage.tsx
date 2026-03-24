import React from "react";
import { Link } from "react-router-dom";

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        <nav className="hidden gap-8 md:flex">
          <Link to="/events" className="text-sm font-bold text-slate-600">Events</Link>
          <Link to="/vendors" className="text-sm font-bold text-slate-600">Vendors</Link>
          <Link to="/pricing" className="text-sm font-black text-slate-900">Pricing</Link>
        </nav>

        <div className="flex gap-3">
          <Link to="/login" className="rounded-xl border px-4 py-2 font-black">Sign In</Link>
          <Link to="/get-started" className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 font-black text-white">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function PriceCard({
  name,
  price,
  highlight,
  features,
  cta,
}: any) {
  return (
    <div className={`rounded-3xl border p-8 shadow-sm ${highlight ? "border-indigo-500 bg-indigo-50" : "bg-white"}`}>
      <div className="text-xl font-black">{name}</div>

      <div className="mt-4 text-4xl font-black">
        ${price}
        <span className="text-sm font-semibold text-slate-500"> / mo</span>
      </div>

      <ul className="mt-6 space-y-3">
        {features.map((f: string) => (
          <li key={f} className="text-sm font-semibold text-slate-600">✓ {f}</li>
        ))}
      </ul>

      <Link
        to="/get-started"
        className={`mt-8 block rounded-2xl px-6 py-3 text-center font-black ${
          highlight
            ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white"
            : "border"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}

export default function PublicPricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      {/* HERO */}
      <section className="bg-gradient-to-br from-indigo-100 via-white to-purple-100 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-6xl font-black">Simple, Transparent Pricing</h1>
          <p className="mt-6 text-lg font-semibold text-slate-600">
            Pay for performance. Upgrade as your event or vendor presence grows.
          </p>
        </div>
      </section>

      {/* PRICING CARDS */}
      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-20 md:grid-cols-3">

        <PriceCard
          name="Starter"
          price="0"
          features={[
            "Browse Events",
            "Basic Vendor Profile",
            "Apply to Events",
            "Community Support",
          ]}
          cta="Start Free"
        />

        <PriceCard
          name="Pro Vendor"
          price="29"
          highlight
          features={[
            "Priority Application Visibility",
            "Verified Badge",
            "Advanced Analytics",
            "Organizer Messaging",
            "Featured Listing Boost",
          ]}
          cta="Upgrade to Pro"
        />

        <PriceCard
          name="Enterprise / Organizer"
          price="99"
          features={[
            "Unlimited Events",
            "Advanced Map + Booth Tools",
            "Vendor Match AI",
            "Application Automation",
            "Priority Support",
          ]}
          cta="Contact Sales"
        />

      </section>

      {/* CTA BAND */}
      <section className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 py-20 text-center text-white">
        <h2 className="text-4xl font-black">Start Free. Upgrade When You’re Ready.</h2>

        <div className="mt-8 flex justify-center gap-4">
          <Link to="/get-started" className="rounded-2xl bg-white px-8 py-4 font-black text-indigo-700">
            Get Started Free →
          </Link>

          <Link to="/events" className="rounded-2xl border border-white px-8 py-4 font-black">
            Browse Events
          </Link>
        </div>
      </section>
    </div>
  );
}
