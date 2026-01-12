// src/pages/VendorPublicPreviewPage.tsx
//
// Read-only preview of how the vendor profile appears to organizers
// and in public directories. Uses the same /vendor/profile data, but
// rendered as a "public card" instead of a form.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../api";

type VendorProfile = {
  business_name: string | null;
  contact_name: string | null;
  public_email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  about: string | null;
  checklist_tags: string[];
  categories: string[];
};

const VendorPublicPreviewPage: React.FC = () => {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const accessToken =
    typeof window !== "undefined"
      ? localStorage.getItem("access_token")
      : null;

  const authHeaders: HeadersInit = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE}/vendor/profile`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to load profile: ${res.status} ${text}`);
        }

        const data = (await res.json()) as VendorProfile;
        if (!cancelled) {
          setProfile({
            business_name: data.business_name ?? "",
            contact_name: data.contact_name ?? "",
            public_email: data.public_email ?? "",
            phone: data.phone ?? "",
            website: data.website ?? "",
            city: data.city ?? "",
            about: data.about ?? "",
            checklist_tags: data.checklist_tags || [],
            categories: data.categories || [],
          });
        }
      } catch (err: any) {
        console.error("Failed to load vendor profile", err);
        if (!cancelled) {
          setError(err?.message ?? "Failed to load vendor profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = profile?.business_name || "Your business name";
  const city = profile?.city || "City, State";
  const about =
    profile?.about ||
    "Tell organizers who you are, what you sell, and what makes your booth memorable.";

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Top bar */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate("/vendor/profile")}
            className="text-[11px] font-medium text-emerald-300 hover:underline"
          >
            ← Back to profile editor
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Public profile preview
          </span>
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-red-950/70 p-3 text-[11px] text-red-100">
            <p className="font-semibold">There was a problem.</p>
            <p className="mt-1 text-red-200">{error}</p>
          </div>
        )}

        {/* Public-style card */}
        <div className="rounded-3xl bg-slate-900 p-6 shadow-lg ring-1 ring-slate-800">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* Avatar / logo placeholder */}
            <div className="flex-shrink-0">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-600 text-lg font-bold text-white">
                {name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            </div>

            {/* Main content */}
            <div className="flex-1 space-y-3">
              <div>
                <h1 className="text-xl font-semibold text-white">{name}</h1>
                <p className="text-xs text-emerald-200/90">{city}</p>
                {profile?.categories?.length ? (
                  <p className="mt-1 text-[11px] text-slate-300">
                    Categories:{" "}
                    <span className="text-slate-100">
                      {profile.categories.join(", ")}
                    </span>
                  </p>
                ) : null}
              </div>

              <p className="text-xs leading-relaxed text-slate-200">{about}</p>

              {/* Checklist tags */}
              {profile?.checklist_tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.checklist_tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-emerald-700/70 bg-emerald-900/40 px-2 py-0.5 text-[10px] font-medium text-emerald-100"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-slate-400">
                  Add checklist tags in your profile to highlight food truck,
                  handmade, power requirement, etc.
                </p>
              )}

              {/* Contact / links */}
              <div className="mt-4 grid gap-3 md:grid-cols-3 text-[11px]">
                <div className="space-y-0.5">
                  <div className="text-slate-400">Contact</div>
                  {profile?.public_email ? (
                    <a
                      href={`mailto:${profile.public_email}`}
                      className="text-emerald-200 hover:underline"
                    >
                      {profile.public_email}
                    </a>
                  ) : (
                    <span className="text-slate-500">No email provided</span>
                  )}
                  {profile?.phone && (
                    <div className="text-slate-200">{profile.phone}</div>
                  )}
                </div>
                <div className="space-y-0.5">
                  <div className="text-slate-400">Website</div>
                  {profile?.website ? (
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-200 hover:underline"
                    >
                      {profile.website}
                    </a>
                  ) : (
                    <span className="text-slate-500">No website provided</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  <div className="text-slate-400">Region</div>
                  <div className="text-slate-200">{city}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-6 flex items-center justify-between gap-3 text-[10px] text-slate-400">
            <p>
              This is how your vendor profile will appear in event directories and
              organizer views (layout may vary slightly).
            </p>
            <button
              type="button"
              onClick={() => navigate("/vendor/profile")}
              className="inline-flex items-center rounded-xl border border-emerald-700 bg-slate-950 px-3 py-1.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-900/40"
            >
              Edit profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorPublicPreviewPage;
