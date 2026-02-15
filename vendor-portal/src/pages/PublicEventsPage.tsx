import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

type PublicEvent = {
  id: string;
  name: string;
  city: string;
  state: string;
  dateRange: string;
  venue: string;
  categories: string[];
  boothsFrom: number;
  image: string;
  verifiedOnly?: boolean;
};

const SAMPLE_EVENTS: PublicEvent[] = [
  {
    id: "e-101",
    name: "Test Conference Expo",
    city: "Atlanta",
    state: "GA",
    dateRange: "Apr 18–20",
    venue: "Downtown Convention Center",
    categories: ["Technology", "Services", "Retail"],
    boothsFrom: 500,
    verifiedOnly: true,
    image:
      "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "e-102",
    name: "Spring Food Fest",
    city: "Austin",
    state: "TX",
    dateRange: "May 4–5",
    venue: "Riverside Park",
    categories: ["Food & Beverage", "Entertainment"],
    boothsFrom: 250,
    verifiedOnly: true,
    image:
      "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "e-103",
    name: "Makers Market Weekend",
    city: "Portland",
    state: "OR",
    dateRange: "Jun 1–2",
    venue: "Waterfront Pavilion",
    categories: ["Art & Crafts", "Home Decor", "Retail"],
    boothsFrom: 150,
    verifiedOnly: true,
    image:
      "https://images.unsplash.com/photo-1515165562835-c4c0b9d3b4b1?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "e-104",
    name: "Wellness & Fitness Summit",
    city: "Miami",
    state: "FL",
    dateRange: "Jun 14–16",
    venue: "Bayfront Expo Hall",
    categories: ["Wellness", "Services", "Retail"],
    boothsFrom: 400,
    verifiedOnly: true,
    image:
      "https://images.unsplash.com/photo-1554284126-aa88f22d8b74?auto=format&fit=crop&w=1400&q=80",
  },
];

const ALL_CATEGORIES = [
  "Food & Beverage",
  "Technology",
  "Art & Crafts",
  "Retail",
  "Entertainment",
  "Services",
  "Wellness",
  "Non-Profit",
];

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
      {children}
    </span>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link to="/#features" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Features
          </Link>
          <Link to="/#how" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            How It Works
          </Link>
          <Link to="/events" className="text-sm font-black text-slate-900">
            Events
          </Link>
          <Link to="/vendors" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Vendors
          </Link>
          <Link to="/pricing" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-100"
          >
            Sign In
          </Link>
          <Link
            to="/get-started"
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 text-sm font-black text-white"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function PublicEventsPage() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [sort, setSort] = useState<"recommended" | "price_low" | "price_high">("recommended");

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const cc = city.trim().toLowerCase();

    let list = SAMPLE_EVENTS.filter((e) => {
      const matchesQ =
        !qq ||
        e.name.toLowerCase().includes(qq) ||
        e.venue.toLowerCase().includes(qq) ||
        `${e.city}, ${e.state}`.toLowerCase().includes(qq);

      const matchesCity = !cc || e.city.toLowerCase().includes(cc) || e.state.toLowerCase().includes(cc);

      const matchesCat = category === "All" ? true : e.categories.includes(category);

      return matchesQ && matchesCity && matchesCat;
    });

    if (sort === "price_low") list = [...list].sort((a, b) => a.boothsFrom - b.boothsFrom);
    if (sort === "price_high") list = [...list].sort((a, b) => b.boothsFrom - a.boothsFrom);

    return list;
  }, [q, city, category, sort]);

  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      <section className="bg-gradient-to-br from-indigo-100 via-white to-purple-100">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-black leading-tight text-slate-900">Browse Verified Events</h1>
            <p className="mt-4 text-base font-semibold text-slate-600">
              Find upcoming events and apply for booths. Verified partners only — less noise, better bookings.
            </p>
          </div>

          {/* Filters */}
          <div className="mt-10 grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="text-xs font-black text-slate-700">Search</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search events, venues, city…"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="md:col-span-3">
              <label className="text-xs font-black text-slate-700">City / State</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Atlanta, GA"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-black text-slate-700">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              >
                <option value="All">All</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-black text-slate-700">Sort</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              >
                <option value="recommended">Recommended</option>
                <option value="price_low">Booths: Low → High</option>
                <option value="price_high">Booths: High → Low</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-600">Results</div>
            <div className="text-2xl font-black text-slate-900">{results.length} events</div>
          </div>

          <Link
            to="/get-started"
            className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-black text-white"
          >
            Get Verified → Apply Faster
          </Link>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {results.map((e) => (
            <div key={e.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative h-48 w-full">
                <img src={e.image} alt={e.name} className="h-full w-full object-cover" />
                {e.verifiedOnly ? (
                  <div className="absolute left-4 top-4 rounded-full bg-white/90 px-4 py-2 text-xs font-black text-indigo-700">
                    Verified Only
                  </div>
                ) : null}
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-black text-slate-900">{e.name}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      {e.city}, {e.state} • {e.dateRange}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-600">{e.venue}</div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                    <div className="text-xs font-black text-slate-500">Booths from</div>
                    <div className="text-xl font-black text-slate-900">${e.boothsFrom}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {e.categories.slice(0, 3).map((c) => (
                    <Pill key={c}>{c}</Pill>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    to="/get-started"
                    className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"
                  >
                    Apply for a Booth →
                  </Link>

                  <Link
                    to="/login"
                    className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
                  >
                    Organizer Details
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA band */}
        <div className="mt-14 rounded-[34px] bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 p-10 text-white">
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <div className="text-3xl font-black">Get verified once. Book faster forever.</div>
              <div className="mt-2 text-sm font-semibold text-white/85">
                Verified vendors stand out to organizers and unlock premium booth opportunities.
              </div>
            </div>

            <div className="flex flex-wrap gap-3 md:justify-end">
              <Link
                to="/get-started"
                className="rounded-2xl bg-white px-7 py-3 text-sm font-black text-indigo-700"
              >
                Get Started Free →
              </Link>
              <Link
                to="/pricing"
                className="rounded-2xl border border-white/40 bg-white/10 px-7 py-3 text-sm font-black text-white"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
