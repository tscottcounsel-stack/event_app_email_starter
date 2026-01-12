// src/pages/PublicVendorsPage.tsx
//
// Public / featured vendor directory
// - Calls GET /public/vendors
// - Cards are clickable and go to /public/vendors/:profileId

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../api";

type PublicVendor = {
  profile_id: number;
  user_id: number;
  business_name: string | null;
  public_email: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  vendor_story: string | null;
  public_logo_url: string | null;
  checklist_tags: string[];
  vendor_categories: string[];
};

type FetchState = "idle" | "loading" | "loaded" | "error";

const PublicVendorsPage: React.FC = () => {
  const [vendors, setVendors] = useState<PublicVendor[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");

  const navigate = useNavigate();

  const loadVendors = async (searchTerm: string, cityTerm: string) => {
    try {
      setState("loading");
      setError(null);

      const params = new URLSearchParams();
      if (searchTerm.trim()) {
        params.set("q", searchTerm.trim());
      }
      if (cityTerm.trim()) {
        params.set("city", cityTerm.trim());
      }

      const url =
        params.toString().length > 0
          ? `${API_BASE}/public/vendors?${params.toString()}`
          : `${API_BASE}/public/vendors`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed: ${res.status} ${text}`);
      }

      const data: PublicVendor[] = await res.json();
      setVendors(data);
      setState("loaded");
    } catch (err: any) {
      console.error("Failed to load public vendors", err);
      setError(err?.message ?? "Failed to load vendors");
      setState("error");
    }
  };

  useEffect(() => {
    loadVendors("", "");
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadVendors(search, cityFilter);
  };

  const handleRefresh = () => {
    loadVendors(search, cityFilter);
  };

  const handleCardClick = (profileId: number) => {
    navigate(`/public/vendors/${profileId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Featured Vendors
            </h1>
            <p className="text-sm text-slate-600">
              Public directory view powered by vendor profiles.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {/* Filters */}
        <form
          onSubmit={handleSearchSubmit}
          className="mb-6 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            placeholder="Search by name, story, or city..."
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            type="text"
            placeholder="Filter by city..."
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:max-w-xs"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Apply
          </button>
        </form>

        {/* Status */}
        {state === "loading" && (
          <div className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm">
            Loading featured vendors…
          </div>
        )}

        {state === "error" && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 shadow-sm">
            <p className="font-semibold">Error loading vendors</p>
            <p className="mt-1 text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {state === "loaded" && vendors.length === 0 && (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            No vendors found yet. Once vendors create their profiles, they&apos;ll
            appear here as featured vendors.
          </div>
        )}

        {/* Vendor grid */}
        {state === "loaded" && vendors.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <article
                key={v.profile_id}
                onClick={() => handleCardClick(v.profile_id)}
                className="flex cursor-pointer flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-3 flex items-center gap-3">
                  {/* Logo / initials */}
                  {v.public_logo_url ? (
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-slate-100">
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        Logo
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                      {(v.business_name || "??")
                        .split(/\s+/)
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      {v.business_name || "Unnamed Vendor"}
                    </h2>
                    <p className="truncate text-xs text-slate-500">
                      {v.city || "City TBD"}
                    </p>
                  </div>
                </div>

                {/* Story */}
                {v.vendor_story && (
                  <p className="mb-3 line-clamp-3 text-xs text-slate-700">
                    {v.vendor_story}
                  </p>
                )}

                {/* Categories */}
                {v.vendor_categories && v.vendor_categories.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {v.vendor_categories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                {/* Bottom meta */}
                <div className="mt-auto pt-3 text-xs text-slate-600">
                  {v.public_email && (
                    <div className="truncate">
                      <span className="font-medium">Email: </span>
                      <span className="text-indigo-600 underline-offset-2">
                        {v.public_email}
                      </span>
                    </div>
                  )}
                  {v.website && (
                    <div className="truncate">
                      <span className="font-medium">Website: </span>
                      <span className="text-indigo-600 underline-offset-2">
                        {v.website}
                      </span>
                    </div>
                  )}
                  {v.phone && (
                    <div className="truncate">
                      <span className="font-medium">Phone: </span>
                      <span>{v.phone}</span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicVendorsPage;
