import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type Organizer = {
  email: string;
  business_name?: string;
  status?: "verified" | "pending" | "rejected" | string;
  city?: string;
  categories?: string[];
  bio?: string;
  promoted?: boolean;
};

type RatingMap = {
  [email: string]: {
    avg: number;
    count: number;
  };
};

const API_BASE = import.meta.env.VITE_API_BASE;

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
          <Link to="/vendors" className="text-sm font-bold text-slate-600 hover:text-slate-900">
            Vendors
          </Link>
          <Link to="/organizers" className="text-sm font-black text-slate-900">
            Organizers
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

function StarRow({ rating, count }: { rating: number; count: number }) {
  if (!count) {
    return <div className="text-sm font-bold text-slate-400">No reviews yet</div>;
  }

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
      <div className="text-xs font-bold text-slate-500">({count})</div>
    </div>
  );
}

export default function PublicOrganizersPage() {
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [ratings, setRatings] = useState<RatingMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<"recommended" | "rating_high" | "name_az">("recommended");

  useEffect(() => {
    void fetchOrganizers();
  }, []);

  const fetchOrganizers = async () => {
    try {
      const res = await fetch(`${API_BASE}/verification/public`);
      if (!res.ok) {
        throw new Error(`Failed to fetch organizers: ${res.status}`);
      }

      const data = await res.json();
      const list: Organizer[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : [];

      const normalized = list.map((org, index) => ({
        ...org,
        promoted: org.promoted ?? index < 2,
        bio:
          org.bio ??
          "Public organizer profile with verification status and trust signals for vendors browsing events.",
      }));

      setOrganizers(normalized);
      void fetchRatings(normalized.map((o) => o.email));
    } catch (err) {
      console.error("Failed to fetch organizers", err);
      setOrganizers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchRatings = async (emails: string[]) => {
    const map: RatingMap = {};

    await Promise.all(
      emails.map(async (email) => {
        try {
          const res = await fetch(`${API_BASE}/organizers/public/${email}/reviews`);
          if (!res.ok) {
            map[email] = { avg: 0, count: 0 };
            return;
          }

          const data = await res.json();
          const list = Array.isArray(data) ? data : [];

          if (!list.length) {
            map[email] = { avg: 0, count: 0 };
            return;
          }

          const total = list.reduce((sum: number, review: any) => sum + (Number(review.rating) || 0), 0);
          map[email] = {
            avg: Number((total / list.length).toFixed(1)),
            count: list.length,
          };
        } catch {
          map[email] = { avg: 0, count: 0 };
        }
      })
    );

    setRatings(map);
  };

  const results = useMemo(() => {
    const qq = search.trim().toLowerCase();

    let list = [...organizers].filter((org) => {
      const matchesQ =
        !qq ||
        `${org.business_name || ""} ${org.email || ""} ${org.city || ""} ${(org.categories || []).join(" ")}`
          .toLowerCase()
          .includes(qq);

      const matchesVerified = verifiedOnly ? org.status === "verified" : true;

      return matchesQ && matchesVerified;
    });

    list = [...list].sort((a, b) => {
      if (sort === "name_az") {
        return (a.business_name || a.email).localeCompare(b.business_name || b.email);
      }

      if (sort === "rating_high") {
        return (ratings[b.email]?.avg || 0) - (ratings[a.email]?.avg || 0);
      }

      if ((a.promoted ? 1 : 0) !== (b.promoted ? 1 : 0)) {
        return (b.promoted ? 1 : 0) - (a.promoted ? 1 : 0);
      }
      if (a.status === "verified" && b.status !== "verified") return -1;
      if (a.status !== "verified" && b.status === "verified") return 1;
      return (ratings[b.email]?.avg || 0) - (ratings[a.email]?.avg || 0);
    });

    return list;
  }, [organizers, ratings, search, verifiedOnly, sort]);

  const featured = results.filter((org) => org.promoted).slice(0, 2);
  const directory = results.filter((org) => !featured.some((f) => f.email === org.email));

  return (
    <div className="min-h-screen bg-white">
      <TopNav />

      <section className="bg-gradient-to-br from-indigo-100 via-white to-purple-100">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-black leading-tight text-slate-900">Meet Trusted Organizers</h1>
            <p className="mt-4 text-base font-semibold text-slate-600">
              Browse public organizer profiles, spot verified hosts, and compare trust signals before you apply.
            </p>
          </div>

          <div className="mt-10 grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur md:grid-cols-12">
            <div className="md:col-span-6">
              <label className="text-xs font-black text-slate-700">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organizer name or email…"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="md:col-span-3">
              <label className="text-xs font-black text-slate-700">Sort</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "recommended" | "rating_high" | "name_az")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400"
              >
                <option value="recommended">Recommended</option>
                <option value="rating_high">Rating: High → Low</option>
                <option value="name_az">Name: A → Z</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="text-xs font-black text-slate-700">Status</label>
              <label className="mt-2 inline-flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-slate-800">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="h-4 w-4"
                />
                Verified organizers only
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-600">Results</div>
            <div className="text-2xl font-black text-slate-900">{results.length} organizers</div>
          </div>

          <Link
            to="/get-started"
            className="rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3 text-sm font-black text-white"
          >
            Create Your Organizer Profile →
          </Link>
        </div>

        {verifiedOnly ? (
          <div className="mt-4 text-sm font-black text-amber-700">Showing verified organizers only</div>
        ) : null}

        {loading ? (
          <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-500 shadow-sm">
            Loading organizers...
          </div>
        ) : null}

        {!loading && featured.length > 0 ? (
          <>
            <div className="mt-10 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-slate-600">Promoted</div>
                <div className="text-2xl font-black text-slate-900">Featured Organizers</div>
              </div>
              <div className="text-sm font-semibold text-slate-500">Large cards are reserved for promoted companies</div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {featured.map((org) => {
                const rating = ratings[org.email] || { avg: 0, count: 0 };
                return (
                  <div key={org.email} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-6 py-6 text-white">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-2xl font-black">{org.business_name || org.email}</div>
                          <div className="mt-2 text-sm font-semibold text-white/85">{org.email}</div>
                        </div>
                        {org.status === "verified" ? <VerifiedBadge /> : null}
                      </div>
                    </div>

                    <div className="p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="max-w-lg text-sm font-semibold leading-relaxed text-slate-600">
                          {org.bio}
                        </div>
                        <StarRow rating={rating.avg} count={rating.count} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {(org.categories && org.categories.length ? org.categories : ["Event Host", "Public Profile"]).slice(0, 3).map((item) => (
                          <Pill key={item}>{item}</Pill>
                        ))}
                      </div>

                      <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                          to={`/organizers/${org.email}`}
                          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
                        >
                          View Profile
                        </Link>
                        <button
                          type="button"
                          className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-black text-amber-900"
                        >
                          View Badge
                        </button>
                        <button
                          type="button"
                          className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"
                        >
                          View Ratings
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-slate-600">Directory</div>
              <div className="text-2xl font-black text-slate-900">All Organizers</div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            {loading ? null : directory.length === 0 && results.length === 0 ? (
              <div className="p-8 text-sm font-semibold text-slate-500">No organizers matched your filters.</div>
            ) : directory.length === 0 ? (
              <div className="p-8 text-sm font-semibold text-slate-500">No additional organizers outside the featured section.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {directory.map((org) => {
                  const rating = ratings[org.email] || { avg: 0, count: 0 };
                  return (
                    <div key={org.email} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-lg font-black text-slate-900">{org.business_name || org.email}</div>
                          {org.status === "verified" ? <VerifiedBadge /> : null}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">{org.email}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(org.categories && org.categories.length ? org.categories : ["Organizer"]).slice(0, 2).map((item) => (
                            <Pill key={item}>{item}</Pill>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col items-start gap-3 md:items-end">
                        <StarRow rating={rating.avg} count={rating.count} />
                        <div className="flex flex-wrap gap-3">
                          <Link
                            to={`/organizers/${org.email}`}
                            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-900 hover:bg-slate-50"
                          >
                            View Profile
                          </Link>
                          <button
                            type="button"
                            className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-900"
                          >
                            View Badge
                          </button>
                          <button
                            type="button"
                            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white"
                          >
                            View Ratings
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-14 rounded-[34px] bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 p-10 text-white">
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <div className="text-3xl font-black">Build trust before the first application.</div>
              <div className="mt-2 text-sm font-semibold text-white/85">
                Public profiles, verification, and ratings help vendors choose stronger organizer relationships faster.
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





