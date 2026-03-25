import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

type Vendor = {
  id: string;
  name: string;
  city: string;
  state: string;
  tags: string[];
  blurb: string;
  rating: number;
  verified: boolean;
  image: string;
};

const SAMPLE_VENDORS: Vendor[] = [
  {
    id: "v-201",
    name: "Mike’s Gourmet Food Truck",
    city: "Austin",
    state: "TX",
    tags: ["Food & Beverage", "Mobile Catering"],
    blurb: "Award-winning gourmet street food specializing in fusion cuisine.",
    rating: 4.9,
    verified: true,
    image:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v-202",
    name: "TechGear Solutions",
    city: "San Francisco",
    state: "CA",
    tags: ["Technology & Electronics"],
    blurb: "Innovative tech accessories and smart home devices.",
    rating: 4.7,
    verified: true,
    image:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v-203",
    name: "Crafty Creations",
    city: "Portland",
    state: "OR",
    tags: ["Arts & Crafts", "Home Goods"],
    blurb: "Handmade artisan crafts and home decor. Unique, high-quality products.",
    rating: 4.8,
    verified: true,
    image:
      "https://images.unsplash.com/photo-1520975958225-2db8b2c3a55c?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v-204",
    name: "Wellness Pop-Up Co.",
    city: "Miami",
    state: "FL",
    tags: ["Health & Wellness", "Professional Services"],
    blurb: "Mobile wellness + recovery experiences for festivals, conferences, and expos.",
    rating: 4.6,
    verified: true,
    image:
      "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v-205",
    name: "Retro Retail Finds",
    city: "Nashville",
    state: "TN",
    tags: ["Clothing & Apparel"],
    blurb: "Curated vintage apparel & accessories with a modern boutique setup.",
    rating: 4.5,
    verified: false,
    image:
      "https://images.unsplash.com/photo-1520975693410-001764f1a0d3?auto=format&fit=crop&w=1400&q=80",
  },
  {
    id: "v-206",
    name: "StageSpark Entertainment",
    city: "Los Angeles",
    state: "CA",
    tags: ["Entertainment"],
    blurb: "Live performances, interactive shows, and crowd engagement packages.",
    rating: 4.7,
    verified: true,
    image:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1400&q=80",
  },
];

const ALL_TAGS = [
  "Food & Beverage",
  "Coffee & Beverages",
  "Bakery & Desserts",
  "Mobile Catering",
  "Arts & Crafts",
  "Jewelry",
  "Clothing & Apparel",
  "Beauty & Skincare",
  "Health & Wellness",
  "Home Goods",
  "Technology & Electronics",
  "Entertainment",
  "Professional Services",
  "Education",
  "Non-Profit",
  "Other",
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
          <Link to="/#features" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Features
          </Link>
          <Link to="/#how" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            How It Works
          </Link>
          <Link to="/events" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Events
          </Link>
          <Link to="/vendors" className="text-sm font-black text-slate-900">
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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
      {children}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-gradient-to-r from-amber-200 to-yellow-300 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
      <span>★</span>
      Verified
    </span>
  );
}

function StarRow({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const stars = Array.from({ length: 5 }).map((_, i) => {
    const filled = i < full;
    const isHalf = !filled && half && i === full;
    return (
      <span key={i} className={filled ? "text-amber-500" : isHalf ? "text-amber-400" : "text-slate-300"}>
        ★
      </span>
    );
  });

  return (
    <div className="flex items-center gap-2">
      <div className="text-sm leading-none">{stars}</div>
      <div className="text-sm font-black text-slate-900">{rating.toFixed(1)}</div>
    </div>
  );
}

export default function PublicVendorsPage() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [tag, setTag] = useState<string>("All");
  const [sort, setSort] = useState<"recommended" | "rating_high" | "name_az">("recommended");
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(false);

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const ll = location.trim().toLowerCase();

    let list = SAMPLE_VENDORS.filter((v) => {
      const isVerified = !!v.verified;

      const matchesQ =
        !qq ||
        v.name.toLowerCase().includes(qq) ||
        v.blurb.toLowerCase().includes(qq) ||
        v.tags.some((t) => t.toLowerCase().includes(qq));

      const matchesLoc =
        !ll || `${v.city}, ${v.state}`.toLowerCase().includes(ll) || v.city.toLowerCase().includes(ll);

      const matchesTag = tag === "All" ? true : v.tags.includes(tag);
      const matchesVerified = showVerifiedOnly ? isVerified : true;

      return matchesQ && matchesLoc && matchesTag && matchesVerified;
    });

    list = [...list].sort((a, b) => {
      if (a.verified && !b.verified) return -1;
      if (!a.verified && b.verified) return 1;

      if (sort === "name_az") return a.name.localeCompare(b.name);

      return b.rating - a.rating;
    });

    return list;
  }, [q, location, tag, sort, showVerifiedOnly]);

  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      <section className="bg-gradient-to-br from-indigo-100 via-white to-purple-100">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-black leading-tight text-slate-900">Meet Verified Vendors</h1>
            <p className="mt-4 text-base font-semibold text-slate-600">
              Browse pre-screened businesses ready for your event. Less risk. Better experiences.
            </p>
            <p className="mt-3 text-sm font-bold text-slate-500">
              Vendors now use business categories so organizers can search more precisely by what they actually offer.
            </p>
          </div>

          <div className="mt-10 grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="text-xs font-black text-slate-700">Search</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vendor name, services, tags…"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="md:col-span-3">
              <label className="text-xs font-black text-slate-700">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Atlanta, GA"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-black text-slate-700">Business Category</label>
              <select
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              >
                <option value="All">All</option>
                {ALL_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-black text-slate-700">Sort</label>
              <select
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value as "recommended" | "rating_high" | "name_az")
                }
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              >
                <option value="recommended">Recommended</option>
                <option value="rating_high">Rating: High → Low</option>
                <option value="name_az">Name: A → Z</option>
              </select>
            </div>

            <div className="md:col-span-12">
              <label className="inline-flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-slate-800">
                <input
                  type="checkbox"
                  checked={showVerifiedOnly}
                  onChange={(e) => setShowVerifiedOnly(e.target.checked)}
                  className="h-4 w-4"
                />
                Verified vendors only
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-600">Results</div>
            <div className="text-2xl font-black text-slate-900">{results.length} vendors</div>
          </div>

          <Link
            to="/get-started"
            className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-black text-white"
          >
            Get Verified → Work With Top Organizers
          </Link>
        </div>

        {showVerifiedOnly ? (
          <div className="mt-4 text-sm font-black text-amber-700">Showing verified vendors only</div>
        ) : null}

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {results.map((v) => (
            <div key={v.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative h-44 w-full">
                <img src={v.image} alt={v.name} className="h-full w-full object-cover" />
                {v.verified ? (
                  <div className="absolute left-4 top-4">
                    <VerifiedBadge />
                  </div>
                ) : null}
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-black text-slate-900">{v.name}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      📍 {v.city}, {v.state}
                    </div>
                  </div>
                  <StarRow rating={v.rating} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {v.tags.slice(0, 3).map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>

                <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-600">{v.blurb}</p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    to="/get-started"
                    className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"
                  >
                    Request Booking →
                  </Link>

                  <Link
                    to="/login"
                    className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
                  >
                    View Profile ↗
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-[34px] bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 p-10 text-white">
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <div className="text-3xl font-black">Work with trusted organizers and premium events.</div>
              <div className="mt-2 text-sm font-semibold text-white/85">
                Verification unlocks better placements, faster approvals, and more booth wins.
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



