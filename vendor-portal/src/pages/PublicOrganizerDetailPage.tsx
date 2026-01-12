// src/pages/PublicOrganizerDetailPage.tsx
//
// Public detail view for a single organizer.
// Route: /public/organizers/:organizerId
//
// Data source: GET /public/organizers/{organizerId}

import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet } from "../api";

type PublicOrganizerProfile = {
  profile_id: number;
  user_id: number;
  business_name: string;
  public_email: string | null;
  phone: string | null;
  city: string | null;
  website: string | null;
  organizer_story: string | null;
  checklist_tags: string[];
  organizer_categories: string[];
};

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profile: PublicOrganizerProfile };

const PublicOrganizerDetailPage: React.FC = () => {
  const { organizerId } = useParams<{ organizerId: string }>();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!organizerId) {
        setState({
          kind: "error",
          message: "Missing organizer id in URL.",
        });
        return;
      }

      try {
        const data = await apiGet<PublicOrganizerProfile>(
          `/public/organizers/${organizerId}`
        );
        if (!cancelled) {
          setState({ kind: "ready", profile: data });
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to load public organizer", err);
        const msg =
          err?.detail ??
          err?.message ??
          "Failed to load public organizer profile.";
        setState({ kind: "error", message: String(msg) });
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [organizerId]);

  const renderTags = (items: string[], label: string) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">
          {label}
        </h3>
        <div className="flex flex-wrap gap-2">
          {items.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-slate-600/70 px-3 py-1 text-xs font-medium text-slate-100 bg-slate-800/80"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    );
  };

  let content: React.ReactNode;

  if (state.kind === "loading") {
    content = (
      <div className="py-16 text-center text-slate-300">
        Loading organizer profile…
      </div>
    );
  } else if (state.kind === "error") {
    content = (
      <div className="py-16 text-center">
        <p className="text-red-400 font-medium mb-2">
          Failed to load organizer.
        </p>
        <p className="text-slate-300 text-sm mb-6">{state.message}</p>
        <Link
          to="/public/organizers"
          className="inline-flex items-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white transition"
        >
          ← Back to organizers
        </Link>
      </div>
    );
  } else {
    const { profile } = state;
    const initials =
      profile.business_name
        ?.split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "OR";

    content = (
      <div className="max-w-5xl mx-auto py-10">
        <div className="mb-6">
          <Link
            to="/public/organizers"
            className="inline-flex items-center text-sm text-slate-300 hover:text-white"
          >
            ← Back to organizers
          </Link>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl shadow-xl p-8 md:p-10 flex flex-col md:flex-row gap-8">
          {/* Avatar / logo circle */}
          <div className="flex-shrink-0">
            <div className="h-20 w-20 rounded-full bg-indigo-500/80 flex items-center justify-center text-xl font-bold text-white">
              {initials}
            </div>
          </div>

          {/* Main info */}
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1">
              {profile.business_name || "Organizer"}
            </h1>
            {profile.city && (
              <p className="text-sm text-slate-300 mb-2">{profile.city}</p>
            )}

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-200">
              {profile.public_email && (
                <div>
                  <div className="text-slate-400 text-xs uppercase tracking-wide">
                    Email
                  </div>
                  <a
                    href={`mailto:${profile.public_email}`}
                    className="hover:underline"
                  >
                    {profile.public_email}
                  </a>
                </div>
              )}

              {profile.phone && (
                <div>
                  <div className="text-slate-400 text-xs uppercase tracking-wide">
                    Phone
                  </div>
                  <div>{profile.phone}</div>
                </div>
              )}

              {profile.website && (
                <div>
                  <div className="text-slate-400 text-xs uppercase tracking-wide">
                    Website
                  </div>
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {profile.website}
                  </a>
                </div>
              )}
            </div>

            {profile.organizer_story && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-2">
                  Organizer story
                </h2>
                <p className="text-slate-200 leading-relaxed whitespace-pre-line">
                  {profile.organizer_story}
                </p>
              </div>
            )}

            {renderTags(profile.checklist_tags, "Highlights & tags")}
            {renderTags(profile.organizer_categories, "Organizer categories")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-sm font-semibold tracking-wide text-slate-100"
          >
            Event Vendor Portal
          </Link>
          <Link
            to="/public/organizers"
            className="text-xs font-medium text-slate-300 hover:text-white"
          >
            Browse organizers
          </Link>
        </div>
      </header>

      <main className="px-4">{content}</main>
    </div>
  );
};

export default PublicOrganizerDetailPage;
