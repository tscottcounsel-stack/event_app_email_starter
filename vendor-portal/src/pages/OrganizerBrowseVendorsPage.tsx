// src/pages/OrganizerBrowseVendorsPage.tsx
//
// Organizer-facing vendor directory
// Route: /organizer/vendors
// Data source: GET /public/vendors
//
// Organizers can:
// - Browse vendors
// - Filter by name/story/city
// - Click to view vendor public profile
// - See a placeholder "Invite to event" CTA (backend to be wired later)

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

const OrganizerBrowseVendorsPage: React.FC = () => {
  const [vendors, setVendors] = useState<PublicVendor[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");

  const navigate = useNavigate();

  const loadVendors = async (currentSearch: string, currentCity: string) => {
    try {
      setState("loading");
      setError(null);

      const params = new URLSearchParams();
      if (currentSearch.trim()) {
        params.set("q", currentSearch.trim());
      }
      if (currentCity.trim()) {
        params.set("city", currentCity.trim());
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
      console.error("Failed to load vendors for organizer view", err);
      setError(err?.message ?? "Failed to load vendors");
      setState("error");
    }
  };

  useEffect(() => {
    // initial load
    loadVendors("", "");
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadVendors(search, cityFilter);
  };

  const handleRefresh = () => {
    loadVendors(search, cityFilter);
  };

  const handleViewVendor = (profileId: number) => {
    // Reuse the public vendor detail view
    navigate(`/public/vendors/${profileId}`);
  };

  const handleInviteClick = (vendor: PublicVendor) => {
    // For now, just show a friendly placeholder.
    // Later we can open a modal or side panel to select an event and send a real invite.
    const message = `Invite flow is coming soon.\n\n` +
      `In the meantime, you can contact this vendor directly:\n\n` +
      `Name: ${vendor.business_name || "Vendor"}\n` +
      (vendor.public_email ? `Email: ${vendor.public_email}\n` : "") +
      (vendor.phone ? `Phone: ${vendor.phone}\n` : "") +
      (vendor.website ? `Website: ${vendor.website}\n` : "");
    // Simple browser alert to keep it lightweight
    window.alert(message);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Vendor directory (organizer view)
            </h1>
            <p className="text-sm text-slate-300">
              Browse vendors, learn their stories, and start planning who you
              want at your next event.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 shadow-sm hover:bg-slate-700"
          >
            Refresh list
          </button>
        </div>

        {/* Filters */}
        <form
          onSubmit={handleSearchSubmit}
          className="mb-6 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            placeholder="Search by name, category, or story..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            type="text"
            placeholder="Filter by city..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:max-w-xs"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-600"
          >
            Apply
          </button>
        </form>

        {/* Status */}
        {state === "loading" && (
          <div className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300 shadow-sm">
            Loading vendors…
          </div>
        )}

        {state === "error" && (
          <div className="rounded-xl bg-red-950/60 p-4 text-sm text-red-200 shadow-sm">
            <p className="font-semibold">Error loading vendors</p>
            <p className="mt-1 text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {state === "loaded" && vendors.length === 0 && (
          <div className="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-300 shadow-sm">
            No vendors found yet. Once vendors build their profiles, you&apos;ll
            be able to browse and invite them from here.
          </div>
        )}

        {/* Vendor grid */}
        {state === "loaded" && vendors.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => {
              const initials = (v.business_name || "??")
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <article
                  key={v.profile_id}
                  className="flex flex-col rounded-2xl bg-slate-900 p-4 shadow-sm ring-1 ring-slate-800"
                >
                  <div className="mb-3 flex items-center gap-3">
                    {/* Logo / initials */}
                    {v.public_logo_url ? (
                      <div className="h-12 w-12 overflow-hidden rounded-full bg-slate-800">
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                          Logo
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-300">
                        {initials}
                      </div>
                    )}

                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-slate-50">
                        {v.business_name || "Unnamed Vendor"}
                      </h2>
                      <p className="truncate text-xs text-slate-400">
                        {v.city || "City TBD"}
                      </p>
                    </div>
                  </div>

                  {/* Story */}
                  {v.vendor_story && (
                    <p className="mb-3 line-clamp-3 text-xs text-slate-200">
                      {v.vendor_story}
                    </p>
                  )}

                  {/* Categories */}
                  {v.vendor_categories && v.vendor_categories.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {v.vendor_categories.map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-200"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Contact snippet */}
                  <div className="mt-auto space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-300">
                    {v.public_email && (
                      <div className="truncate">
                        <span className="font-medium">Email: </span>
                        <span className="text-indigo-300">
                          {v.public_email}
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

                  {/* Actions */}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => handleViewVendor(v.profile_id)}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 shadow-sm hover:bg-slate-700"
                    >
                      View public profile
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInviteClick(v)}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-600"
                    >
                      Invite to an event (soon)
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizerBrowseVendorsPage;
