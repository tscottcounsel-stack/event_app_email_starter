// src/pages/PublicOrganizersPage.tsx
//
// Public / featured organizer directory
// - Calls GET /public/organizers
// - Cards are clickable and go to /public/organizers/:profileId

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../api";

type PublicOrganizer = {
  profile_id: number;
  user_id: number;
  business_name: string | null;
  public_email: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  organizer_story: string | null;
  public_logo_url: string | null;
  checklist_tags: string[];
  organizer_categories: string[];
};

type FetchState = "idle" | "loading" | "loaded" | "error";

const PublicOrganizersPage: React.FC = () => {
  const [organizers, setOrganizers] = useState<PublicOrganizer[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");

  const navigate = useNavigate();

  const loadOrganizers = async (currentSearch: string, currentCity: string) => {
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
          ? `${API_BASE}/public/organizers?${params.toString()}`
          : `${API_BASE}/public/organizers`;

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

      const data: PublicOrganizer[] = await res.json();
      setOrganizers(data);
      setState("loaded");
    } catch (err: any) {
      console.error("Failed to load public organizers", err);
      setError(err?.message ?? "Failed to load organizers");
      setState("error");
    }
  };

  useEffect(() => {
    // initial load
    loadOrganizers("", "");
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadOrganizers(search, cityFilter);
  };

  const handleRefresh = () => {
    loadOrganizers(search, cityFilter);
  };

  const handleCardClick = (profileId: number) => {
    navigate(`/public/organizers/${profileId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Featured Organizers
            </h1>
            <p className="text-sm text-slate-600">
              Public directory view of event hosts and planners.
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
            Loading featured organizers…
          </div>
        )}

        {state === "error" && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 shadow-sm">
            <p className="font-semibold">Error loading organizers</p>
            <p className="mt-1 text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {state === "loaded" && organizers.length === 0 && (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            No organizers found yet. Once organizers create their profiles,
            they&apos;ll appear here as featured event hosts.
          </div>
        )}

        {/* Organizer grid */}
        {state === "loaded" && organizers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {organizers.map((o) => (
              <article
                key={o.profile_id}
                onClick={() => handleCardClick(o.profile_id)}
                className="flex cursor-pointer flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-3 flex items-center gap-3">
                  {/* Logo / initials */}
                  {o.public_logo_url ? (
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-slate-100">
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        Logo
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                      {(o.business_name || "??")
                        .split(/\s+/)
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      {o.business_name || "Organizer"}
                    </h2>
                    <p className="truncate text-xs text-slate-500">
                      {o.city || "City TBD"}
                    </p>
                  </div>
                </div>

                {/* Story */}
                {o.organizer_story && (
                  <p className="mb-3 line-clamp-3 text-xs text-slate-700">
                    {o.organizer_story}
                  </p>
                )}

                {/* Categories */}
                {o.organizer_categories &&
                  o.organizer_categories.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {o.organizer_categories.map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}

                {/* Bottom meta */}
                <div className="mt-auto pt-3 text-xs text-slate-600">
                  {o.public_email && (
                    <div className="truncate">
                      <span className="font-medium">Email: </span>
                      <span className="text-indigo-600 underline-offset-2">
                        {o.public_email}
                      </span>
                    </div>
                  )}
                  {o.website && (
                    <div className="truncate">
                      <span className="font-medium">Website: </span>
                      <span className="text-indigo-600 underline-offset-2">
                        {o.website}
                      </span>
                    </div>
                  )}
                  {o.phone && (
                    <div className="truncate">
                      <span className="font-medium">Phone: </span>
                      <span>{o.phone}</span>
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

export default PublicOrganizersPage;
