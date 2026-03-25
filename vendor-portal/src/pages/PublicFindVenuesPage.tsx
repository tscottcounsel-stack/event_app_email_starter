import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type Venue = {
  id: string;
  name: string;
  city: string;
  state: string;
  capacity: number;
  priceTier: "$" | "$$" | "$$$" | "$$$$";
  rating: number;
  reviewCount: number;
  featured?: boolean;
  amenities: string[];
  imageUrl: string;
};

const seedVenues: Venue[] = [
  {
    id: "v1",
    name: "Downtown Convention Center",
    city: "San Francisco",
    state: "CA",
    capacity: 5000,
    priceTier: "$$$$",
    rating: 4.7,
    reviewCount: 312,
    featured: true,
    amenities: ["WiFi", "Parking", "Catering", "A/V Equipment"],
    imageUrl: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v2",
    name: "Riverside Pavilion",
    city: "Austin",
    state: "TX",
    capacity: 1200,
    priceTier: "$$",
    rating: 4.6,
    reviewCount: 189,
    featured: true,
    amenities: ["WiFi", "Parking", "Catering"],
    imageUrl: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v3",
    name: "Grand Plaza Hotel & Conference Center",
    city: "Miami",
    state: "FL",
    capacity: 2500,
    priceTier: "$$$",
    rating: 4.4,
    reviewCount: 289,
    amenities: ["WiFi", "Parking", "Catering", "A/V Equipment"],
    imageUrl: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v4",
    name: "Sunset Garden Park",
    city: "Portland",
    state: "OR",
    capacity: 3000,
    priceTier: "$",
    rating: 4.5,
    reviewCount: 203,
    featured: true,
    amenities: ["Parking", "Catering"],
    imageUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v5",
    name: "The Loft Event Space",
    city: "Brooklyn",
    state: "NY",
    capacity: 800,
    priceTier: "$$",
    rating: 4.9,
    reviewCount: 167,
    amenities: ["WiFi", "A/V Equipment"],
    imageUrl: "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v6",
    name: "Harborview Restaurant & Events",
    city: "Seattle",
    state: "WA",
    capacity: 400,
    priceTier: "$$$",
    rating: 4.4,
    reviewCount: 289,
    amenities: ["WiFi", "Catering"],
    imageUrl: "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1400&q=80",
  },
];

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600" />
          <span className="text-lg font-black text-slate-900">VendorConnect</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link to="/events" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Events
          </Link>
          <Link to="/venues" className="text-sm font-bold text-slate-900">
            Find Venues
          </Link>
          <Link to="/pricing" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black hover:bg-slate-100"
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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">
      {children}
    </span>
  );
}

export default function PublicFindVenuesPage() {
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");

  const venues = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const ll = loc.trim().toLowerCase();

    return seedVenues.filter((v) => {
      const matchesQ =
        !qq ||
        v.name.toLowerCase().includes(qq) ||
        v.amenities.some((a) => a.toLowerCase().includes(qq));

      const matchesLoc =
        !ll ||
        `${v.city}, ${v.state}`.toLowerCase().includes(ll) ||
        v.city.toLowerCase().includes(ll) ||
        v.state.toLowerCase().includes(ll);

      return matchesQ && matchesLoc;
    });
  }, [q, loc]);

  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            <span aria-hidden>←</span> Back
          </button>

          <div className="hidden items-center gap-3 md:flex">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              title="Grid view"
            >
              ▦
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              title="List view"
            >
              ≣
            </button>
          </div>
        </div>

        <div className="mt-6">
          <h1 className="text-4xl font-black text-slate-900">Find Event Venues</h1>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Discover the perfect space for your event
          </p>
        </div>

        {/* Search Row */}
        <div className="mt-8 grid gap-4 md:grid-cols-12 md:items-center">
          <div className="md:col-span-5">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span className="text-slate-400">🔎</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search venues by name..."
                className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="md:col-span-4">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <span className="text-slate-400">📍</span>
              <input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="City, State, or ZIP Code..."
                className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
            >
              <span aria-hidden>⏷</span> Filters
            </button>
          </div>
        </div>

        {/* Count */}
        <div className="mt-10 text-3xl font-black text-slate-900">
          {venues.length} Venues Found
        </div>

        {/* Grid */}
        <div className="mt-6 grid gap-8 md:grid-cols-3">
          {venues.map((v) => (
            <div
              key={v.id}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="relative">
                <img
                  src={v.imageUrl}
                  alt={v.name}
                  className="h-48 w-full object-cover"
                  loading="lazy"
                />

                <div className="absolute left-4 top-4">
                  <span className="inline-flex items-center rounded-full bg-white/95 px-3 py-1 text-xs font-black text-slate-800 shadow">
                    {v.priceTier}
                  </span>
                </div>

                {v.featured ? (
                  <div className="absolute right-4 top-4">
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-black text-white shadow">
                      ★ Featured
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="p-6">
                <div className="text-xl font-black text-slate-900">{v.name}</div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden>📍</span> {v.city}, {v.state}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden>👥</span> {v.capacity.toLocaleString()}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <span className="text-amber-500" aria-hidden>
                    ★★★★★
                  </span>
                  <span>{v.rating.toFixed(1)}</span>
                  <span className="font-semibold text-slate-500">({v.reviewCount})</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {v.amenities.slice(0, 3).map((a) => (
                    <Pill key={a}>{a}</Pill>
                  ))}
                  {v.amenities.length > 3 ? <Pill>+{v.amenities.length - 3} more</Pill> : null}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                  >
                    📞 Call
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                  >
                    ✉️ Email
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center text-sm font-semibold text-slate-500">
          Showing {venues.length} of {seedVenues.length} demo venues.
        </div>
      </div>
    </div>
  );
}



