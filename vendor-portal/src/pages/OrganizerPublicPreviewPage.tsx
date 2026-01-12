// src/pages/OrganizerPublicPreviewPage.tsx
//
// Public detail view for a single organizer.
// Route: /public/organizers/:organizerId
// Data source: GET /public/organizers/{organizerId}

import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

const OrganizerPublicPreviewPage: React.FC = () => {
  const { organizerId } = useParams<{ organizerId: string }>();
  const navigate = useNavigate();

  const [organizer, setOrganizer] = useState<PublicOrganizer | null>(null);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOrganizer = async () => {
      if (!organizerId) {
        setError("Missing organizer id.");
        setState("error");
        return;
      }

      const id = Number(organizerId);
      if (!Number.isFinite(id) || id <= 0) {
        setError("Invalid organizer id.");
        setState("error");
        return;
      }

      try {
        setState("loading");
        setError(null);

        const res = await fetch(`${API_BASE}/public/organizers/${id}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Request failed: ${res.status} ${text}`);
        }

        const data: PublicOrganizer = await res.json();
        setOrganizer(data);
        setState("loaded");
      } catch (err: any) {
        console.error("Failed to load public organizer", err);
        setError(err?.message ?? "Failed to load organizer");
        setState("error");
      }
    };

    loadOrganizer();
  }, [organizerId]);

  const handleBack = () => {
    navigate("/public/organizers");
  };

  if (state === "loading" && !organizer) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 text-xs font-medium text-indigo-600 hover:underline"
          >
            ← Back to organizers
          </button>
          <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">
            Loading organizer profile…
          </div>
        </div>
      </div>
    );
  }

  if (state === "error" || !organizer) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 text-xs font-medium text-indigo-600 hover:underline"
          >
            ← Back to organizers
          </button>
          <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700 shadow-sm">
            <p className="font-semibold">Unable to load organizer.</p>
            <p className="mt-1 text-xs text-red-600">
              {error || "Organizer not found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const initials = (organizer.business_name || "??")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 text-xs font-medium text-indigo-600 hover:underline"
        >
          ← Back to organizers
        </button>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Logo / avatar */}
            {organizer.public_logo_url ? (
              <div className="h-16 w-16 overflow-hidden rounded-full bg-slate-100">
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                  Logo
                </div>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-700">
                {initials}
              </div>
            )}

            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-900">
                {organizer.business_name || "Organizer"}
              </h1>
              <p className="truncate text-sm text-slate-600">
                {organizer.city || "City TBD"}
              </p>

              {organizer.organizer_categories &&
                organizer.organizer_categories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {organizer.organizer_categories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          </div>

          {/* Story */}
          {organizer.organizer_story && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-slate-900">
                About this organizer
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                {organizer.organizer_story}
              </p>
            </div>
          )}

          {/* Checklist tags */}
          {organizer.checklist_tags && organizer.checklist_tags.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-slate-900">
                Highlights &amp; checklist
              </h2>
              <div className="mt-2 flex flex-wrap gap-1">
                {organizer.checklist_tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Contact info */}
          <div className="mt-6 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            {organizer.public_email && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Contact email
                </div>
                <a
                  href={`mailto:${organizer.public_email}`}
                  className="text-indigo-600 hover:underline"
                >
                  {organizer.public_email}
                </a>
              </div>
            )}
            {organizer.phone && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Phone
                </div>
                <div>{organizer.phone}</div>
              </div>
            )}
            {organizer.website && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Website
                </div>
                <a
                  href={organizer.website}
                  className="text-indigo-600 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {organizer.website}
                </a>
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-500">
            Vendors and guests can reach out using the contact information
            above, or look for this organizer&apos;s events in the organizer
            views.
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrganizerPublicPreviewPage;
